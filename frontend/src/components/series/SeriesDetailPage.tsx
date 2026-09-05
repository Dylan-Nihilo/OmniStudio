"use client";

import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { motion, AnimatePresence } from "framer-motion";
import { Image as ImageIcon, Play, ChevronRight } from "lucide-react";
import { api } from "@/lib/api";
import type { Series, Character, Scene, Prop, Project } from "@/store/projectStore";
import AssetCard from "@/components/common/AssetCard";
import { useTranslations } from "next-intl";
import SeriesSidebar, { type SidebarItem } from "./SeriesSidebar";

const SeriesModelSettingsModal = dynamic(() => import("./SeriesModelSettingsModal"), { ssr: false });
const SeriesPromptConfigModal = dynamic(() => import("./SeriesPromptConfigModal"), { ssr: false });
const ImportAssetsDialog = dynamic(() => import("./ImportAssetsDialog"), { ssr: false });
const SeriesArtDirectionPanel = dynamic(() => import("./SeriesArtDirectionPanel"), { ssr: false });

interface SeriesDetailPageProps {
  seriesId: string;
}

type AssetTab = "characters" | "scenes" | "props";

export default function SeriesDetailPage({ seriesId }: SeriesDetailPageProps) {
  const [series, setSeries] = useState<Series | null>(null);
  const [episodes, setEpisodes] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeItem, setActiveItem] = useState<SidebarItem>({ kind: "asset", tab: "characters" });
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [showAddEpisode, setShowAddEpisode] = useState(false);
  const [newEpisodeTitle, setNewEpisodeTitle] = useState("");
  const [isCreatingEpisode, setIsCreatingEpisode] = useState(false);
  const [showModelSettings, setShowModelSettings] = useState(false);
  const [showPromptConfig, setShowPromptConfig] = useState(false);
  const [showImportAssets, setShowImportAssets] = useState(false);

  const t = useTranslations("series");
  const tc = useTranslations("common");

  const ASSET_LABELS: Record<AssetTab, string> = {
    characters: t("characterLabel"),
    scenes: t("sceneLabel"),
    props: t("propLabel"),
  };

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const [seriesData, episodesData] = await Promise.all([
          api.getSeries(seriesId),
          api.getSeriesEpisodes(seriesId),
        ]);
        setSeries(seriesData);
        setEpisodes(episodesData);
        setEditTitle(seriesData.title);
      } catch (error) {
        console.error("Failed to fetch series data:", error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [seriesId]);

  const handleBackToHome = () => {
    window.location.hash = "";
  };

  const handleTitleSave = async () => {
    if (!editTitle.trim() || !series) return;
    try {
      await api.updateSeries(seriesId, { title: editTitle.trim() });
      setSeries({ ...series, title: editTitle.trim() });
    } catch (error) {
      console.error("Failed to update series title:", error);
      setEditTitle(series.title);
    }
    setIsEditingTitle(false);
  };

  const handleTitleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleTitleSave();
    if (e.key === "Escape") {
      setEditTitle(series?.title || "");
      setIsEditingTitle(false);
    }
  };

  const handleAddEpisode = async () => {
    if (!newEpisodeTitle.trim()) return;
    setIsCreatingEpisode(true);
    try {
      const nextEpNum = episodes.length + 1;
      const workflowMode = series?.workflow_mode || "i2v_legacy";
      await api.createEpisodeForSeries(seriesId, newEpisodeTitle.trim(), nextEpNum, workflowMode);
      const updatedEpisodes = await api.getSeriesEpisodes(seriesId);
      setEpisodes(updatedEpisodes);
      setNewEpisodeTitle("");
      setShowAddEpisode(false);
    } catch (error) {
      console.error("Failed to add episode:", error);
    } finally {
      setIsCreatingEpisode(false);
    }
  };

  const handleAddEpisodeKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleAddEpisode();
    if (e.key === "Escape") setShowAddEpisode(false);
  };

  const handleMoveEpisode = async (episodeId: string, direction: "up" | "down") => {
    const ordered = [...episodes].sort((a, b) => (a.episode_number || 0) - (b.episode_number || 0));
    const currentIndex = ordered.findIndex((episode) => episode.id === episodeId);
    const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= ordered.length) return;
    [ordered[currentIndex], ordered[targetIndex]] = [ordered[targetIndex], ordered[currentIndex]];
    try {
      await api.reorderSeriesEpisodes(seriesId, ordered.map((episode) => episode.id));
      await refreshSeriesData();
    } catch (error: any) {
      window.alert(error?.response?.data?.detail || "Episode 排序失败");
    }
  };

  const handleToggleEpisodeArchive = async (episode: Project) => {
    if (!episode.archived && !window.confirm(`归档「${episode.title}」？归档不会删除脚本、素材或分镜。`)) return;
    try {
      if (episode.archived) {
        await api.restoreSeriesEpisode(seriesId, episode.id);
      } else {
        await api.archiveSeriesEpisode(seriesId, episode.id);
      }
      await refreshSeriesData();
    } catch (error: any) {
      window.alert(error?.response?.data?.detail || "Episode 状态更新失败");
    }
  };

  const handleOpenEpisode = (episodeId: string) => {
    window.location.hash = `#/series/${seriesId}/episode/${episodeId}`;
  };

  const refreshSeriesData = async () => {
    try {
      const [seriesData, episodesData] = await Promise.all([
        api.getSeries(seriesId),
        api.getSeriesEpisodes(seriesId),
      ]);
      setSeries(seriesData);
      setEpisodes(episodesData);
    } catch (error) {
      console.error("Failed to refresh series data:", error);
    }
  };

  // ── Loading ──
  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="text-text-secondary">{tc("loading")}</div>
      </div>
    );
  }

  // ── Error ──
  if (!series) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="text-center">
          <p className="text-text-secondary mb-4">{t("notFound")}</p>
          <a href="#/" className="text-primary hover:underline">{t("backToHome")}</a>
        </div>
      </div>
    );
  }

  // ── Derive content ──
  const getAssets = (tab: AssetTab): (Character | Scene | Prop)[] => {
    if (tab === "characters") return series.characters || [];
    if (tab === "scenes") return series.scenes || [];
    return series.props || [];
  };

  const selectedEpisode =
    activeItem.kind === "episode"
      ? episodes.find((ep) => ep.id === activeItem.episodeId)
      : null;

  return (
    <main className="flex h-screen w-screen bg-background overflow-hidden">
      {/* ── Sidebar ── */}
      <SeriesSidebar
        series={series}
        episodes={episodes}
        activeItem={activeItem}
        onItemChange={setActiveItem}
        onBack={handleBackToHome}
        isEditingTitle={isEditingTitle}
        editTitle={editTitle}
        onEditTitleChange={setEditTitle}
        onTitleDoubleClick={() => setIsEditingTitle(true)}
        onTitleSave={handleTitleSave}
        onTitleKeyDown={handleTitleKeyDown}
        showAddEpisode={showAddEpisode}
        newEpisodeTitle={newEpisodeTitle}
        isCreatingEpisode={isCreatingEpisode}
        onShowAddEpisode={setShowAddEpisode}
        onNewEpisodeTitleChange={setNewEpisodeTitle}
        onAddEpisode={handleAddEpisode}
        onAddEpisodeKeyDown={handleAddEpisodeKeyDown}
        onMoveEpisode={handleMoveEpisode}
        onToggleEpisodeArchive={handleToggleEpisodeArchive}
        onOpenModelSettings={() => setShowModelSettings(true)}
        onOpenPromptConfig={() => setShowPromptConfig(true)}
        onOpenImportAssets={() => setShowImportAssets(true)}
      />

      {/* ── Content Area ── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <AnimatePresence mode="wait">
          {activeItem.kind === "art_direction" ? (
            <SeriesArtDirectionPanel
              key="art-direction"
              seriesId={seriesId}
              onSaved={refreshSeriesData}
            />
          ) : activeItem.kind === "asset" ? (
            <AssetContentPanel
              key={`asset-${activeItem.tab}`}
              tab={activeItem.tab}
              assets={getAssets(activeItem.tab)}
              label={ASSET_LABELS[activeItem.tab]}
            />
          ) : selectedEpisode ? (
            <EpisodeContentPanel
              key={`episode-${selectedEpisode.id}`}
              episode={selectedEpisode}
              seriesId={seriesId}
              onOpenEditor={() => handleOpenEpisode(selectedEpisode.id)}
            />
          ) : null}
        </AnimatePresence>
      </div>

      {/* ── Modals ── */}
      <SeriesModelSettingsModal
        isOpen={showModelSettings}
        onClose={() => setShowModelSettings(false)}
        seriesId={seriesId}
        onSaved={refreshSeriesData}
      />
      <SeriesPromptConfigModal
        isOpen={showPromptConfig}
        onClose={() => setShowPromptConfig(false)}
        seriesId={seriesId}
        onSaved={refreshSeriesData}
      />
      <ImportAssetsDialog
        isOpen={showImportAssets}
        onClose={() => setShowImportAssets(false)}
        seriesId={seriesId}
        onImported={refreshSeriesData}
      />
    </main>
  );
}

// ── Shared animation config ──

const contentTransition = {
  duration: 0.25,
  ease: [0.25, 1, 0.5, 1] as const, // ease-out-quart
};

// ── Asset Content Panel ──

function AssetContentPanel({
  tab,
  assets,
  label,
}: {
  tab: AssetTab;
  assets: (Character | Scene | Prop)[];
  label: string;
}) {
  const t = useTranslations("series");

  return (
    <motion.div
      initial={{ opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -16 }}
      transition={contentTransition}
      className="flex-1 flex flex-col overflow-hidden"
    >
      {/* Header */}
      <div className="px-8 pt-6 pb-4">
        <h2 className="text-xl font-display font-bold text-foreground">
          {label}
          <span className="text-sm font-normal text-text-secondary ml-2">
            {t("itemCount", { count: assets.length })}
          </span>
        </h2>
        <p className="text-xs text-text-muted mt-1">
          {t("sharedAssetsEditHint")}
        </p>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto px-8 pb-8">
        {assets.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-text-secondary">
            <motion.div
              animate={{ y: [0, -6, 0] }}
              transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
              className="w-16 h-16 rounded-2xl bg-glass border border-glass-border flex items-center justify-center mb-4"
            >
              <ImageIcon size={28} className="text-text-muted" />
            </motion.div>
            <p className="text-sm font-medium">{t("noAssets", { label })}</p>
            <p className="text-xs text-text-muted mt-1">{t("assetsSharedHint")}</p>
          </div>
        ) : (
          <motion.div
            className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"
            initial="hidden"
            animate="visible"
            variants={{
              visible: { transition: { staggerChildren: 0.04 } },
            }}
          >
            {assets.map((asset) => (
              <motion.div
                key={asset.id}
                variants={{
                  hidden: { opacity: 0, y: 16, scale: 0.97 },
                  visible: {
                    opacity: 1,
                    y: 0,
                    scale: 1,
                    transition: { duration: 0.3, ease: [0.25, 1, 0.5, 1] },
                  },
                }}
              >
                <AssetCard asset={asset} type={tab} />
              </motion.div>
            ))}
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}

// ── Episode Content Panel ──

function EpisodeContentPanel({
  episode,
  seriesId,
  onOpenEditor,
}: {
  episode: Project;
  seriesId: string;
  onOpenEditor: () => void;
}) {
  const t = useTranslations("series");

  const frames = episode.frames || [];
  const characters = episode.characters || [];
  const scenes = episode.scenes || [];
  const originalText = episode.originalText || "";

  return (
    <motion.div
      initial={{ opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -16 }}
      transition={contentTransition}
      className="flex-1 flex flex-col overflow-hidden"
    >
      {/* Header */}
      <div className="px-8 pt-6 pb-4 flex items-start justify-between border-b border-glass-border">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <span className="text-xs bg-primary/20 text-primary px-2.5 py-1 rounded-lg font-mono font-bold">
              EP{episode.episode_number || "?"}
            </span>
            <h2 className="text-xl font-display font-bold text-foreground">
              {episode.title}
            </h2>
          </div>
          <p className="text-xs text-text-secondary">
            {episode.workflow_mode === "r2v" ? "R2V" : "I2V Legacy"} · {t("frameCount", { count: frames.length })}
          </p>
        </div>
        <motion.button
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.97 }}
          onClick={onOpenEditor}
          className="flex items-center gap-2 bg-primary hover:bg-primary/90 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors shadow-lg shadow-primary/20 hover:shadow-primary/30"
        >
          <Play size={14} />
          {t("enterEditor")}
          <ChevronRight size={14} />
        </motion.button>
      </div>

      {/* Episode Overview */}
      <div className="flex-1 overflow-y-auto px-8 py-6 space-y-6">
        {/* Script Summary */}
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-foreground">{t("scriptSummary")}</h3>
          {originalText ? (
            <p className="text-xs text-text-secondary leading-relaxed line-clamp-4 bg-surface rounded-lg p-3 border border-glass-border">
              {originalText.slice(0, 300)}{originalText.length > 300 ? "..." : ""}
            </p>
          ) : (
            <p className="text-xs text-text-muted italic">{t("noScript")}</p>
          )}
        </div>

        {/* Storyboard Overview */}
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-foreground">{t("storyboardOverview")}</h3>
          {frames.length === 0 ? (
            <div className="flex items-center gap-3 bg-surface rounded-lg p-4 border border-glass-border">
              <div className="w-10 h-10 rounded-lg bg-glass border border-glass-border flex items-center justify-center">
                <Play size={16} className="text-text-muted" />
              </div>
              <div>
                <p className="text-xs font-medium text-text-secondary">{t("noFrames")}</p>
                <p className="text-[0.6875rem] text-text-muted">{t("startCreating")}</p>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-4 lg:grid-cols-6 gap-2">
              {frames.slice(0, 12).map((frame, i) => (
                <div
                  key={frame.id}
                  className="aspect-video bg-surface rounded-lg border border-glass-border overflow-hidden cursor-pointer hover:border-primary/50 transition-colors"
                  onClick={onOpenEditor}
                >
                  {frame.rendered_image_url ? (
                    <img
                      src={frame.rendered_image_url}
                      alt={`#${i + 1}`}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-[0.625rem] text-text-muted font-mono">
                      #{i + 1}
                    </div>
                  )}
                </div>
              ))}
              {frames.length > 12 && (
                <div className="aspect-video bg-surface rounded-lg border border-glass-border flex items-center justify-center text-xs text-text-muted">
                  +{frames.length - 12}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Characters & Scenes count */}
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-surface rounded-lg p-3 border border-glass-border text-center">
            <p className="text-lg font-bold text-foreground">{characters.length}</p>
            <p className="text-[0.6875rem] text-text-muted">{t("characters")}</p>
          </div>
          <div className="bg-surface rounded-lg p-3 border border-glass-border text-center">
            <p className="text-lg font-bold text-foreground">{scenes.length}</p>
            <p className="text-[0.6875rem] text-text-muted">{t("scenes")}</p>
          </div>
          <div className="bg-surface rounded-lg p-3 border border-glass-border text-center">
            <p className="text-lg font-bold text-foreground">{frames.length}</p>
            <p className="text-[0.6875rem] text-text-muted">{t("storyboardFrames")}</p>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
