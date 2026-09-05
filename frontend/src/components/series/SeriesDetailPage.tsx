"use client";

import { useEffect, useId, useState } from "react";
import dynamic from "next/dynamic";
import { ChevronRight, Film, Image as ImageIcon, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button, Dialog, EmptyState, LoadingState, NavigationMenu, PageTransition, StatusBadge, TextAreaField, TextField } from "@omnistudio/ui";
import { api } from "@/lib/api";
import { productionProgress } from "@/lib/workspaceOverview";
import type { Series, Project } from "@/store/projectStore";
import AssetCard from "@/components/common/AssetCard";
import AppShell from "@/components/layout/AppShell";
import { deriveCover, deriveStatus } from "@/components/project/ProjectCard";
import { useOnline } from "@/lib/useOnline";
import styles from "./SeriesDetailPage.module.css";

const SeriesModelSettingsModal = dynamic(() => import("./SeriesModelSettingsModal"), { ssr: false });
const SeriesPromptConfigModal = dynamic(() => import("./SeriesPromptConfigModal"), { ssr: false });
const ImportAssetsDialog = dynamic(() => import("./ImportAssetsDialog"), { ssr: false });
const SeriesArtDirectionPanel = dynamic(() => import("./SeriesArtDirectionPanel"), { ssr: false });
type Section = "episodes" | "characters" | "scenes" | "props" | "art_direction";

export default function SeriesDetailPage({ seriesId }: { seriesId: string }) {
  const t = useTranslations("seriesOverview");
  const ts = useTranslations("series");
  const tc = useTranslations("common");
  const online = useOnline();
  const [series, setSeries] = useState<Series | null>(null);
  const [seriesList, setSeriesList] = useState<Series[]>([]);
  const [episodes, setEpisodes] = useState<Project[]>([]);
  const [section, setSection] = useState<Section>("episodes");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [reload, setReload] = useState(0);
  const [dialog, setDialog] = useState<"edit" | "episode" | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [settings, setSettings] = useState<"model" | "prompt" | "import" | null>(null);
  const formId = useId();
  const refresh = () => setReload(value => value + 1);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(false);
    Promise.all([api.getSeries(seriesId), api.getSeriesEpisodes(seriesId)])
      .then(([data, items]) => { if (!cancelled) { setSeries(data); setEpisodes(items); } })
      .catch(() => { if (!cancelled) setLoadError(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    api.listSeries().then(items => { if (!cancelled) setSeriesList(items); }).catch(() => {});
    return () => { cancelled = true; };
  }, [seriesId, reload]);

  const openDialog = (value: "edit" | "episode") => {
    setTitle(value === "edit" ? series?.title || "" : "");
    setDescription(series?.description || "");
    setSaveError(false);
    setDialog(value);
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!series || !title.trim() || saving) return;
    setSaving(true);
    setSaveError(false);
    try {
      if (dialog === "edit") {
        await api.updateSeries(seriesId, { title: title.trim(), description: description.trim() });
        setSeries({ ...series, title: title.trim(), description: description.trim() });
        setSeriesList(items => items.map(item => item.id === seriesId ? { ...item, title: title.trim() } : item));
      } else {
        const nextNumber = Math.max(0, ...episodes.map(episode => episode.episode_number || 0)) + 1;
        const episode = await api.createEpisodeForSeries(seriesId, title.trim(), nextNumber, series.workflow_mode || "i2v_legacy");
        setEpisodes(items => [...items, episode]);
        setSeries({ ...series, episode_ids: [...series.episode_ids, episode.id] });
      }
      setDialog(null);
    } catch { setSaveError(true); }
    finally { setSaving(false); }
  };

  const ordered = [...episodes].sort((a, b) => (a.episode_number || 0) - (b.episode_number || 0));
  const cover = ordered.map(deriveCover).find(Boolean);
  const shotCount = episodes.reduce((sum, episode) => sum + (episode.frames || []).length, 0);
  const videoCount = episodes.reduce((sum, episode) => sum + productionProgress(episode).videos, 0);
  const allSeries = series ? [series, ...seriesList.filter(item => item.id !== series.id)] : seriesList;
  const sections: Section[] = ["episodes", "characters", "scenes", "props", "art_direction"];
  const assets = series && (section === "characters" || section === "scenes" || section === "props") ? series[section] || [] : null;
  const context = <div className={styles.context}>
    <div className={styles.contextHeading}><p>{t("eyebrow")}</p><h2>{t("title")}</h2></div>
    <NavigationMenu aria-label={t("mySeries")} currentId={seriesId} className={styles.seriesNav} items={allSeries.map(item => ({
      id: item.id, href: `#/series/${item.id}`, label: item.title,
      icon: item.id === seriesId && cover ? <img src={cover} alt="" /> : <Film size={22} />,
    }))} />
    <Button variant="quiet" className={styles.newSeries} onPress={() => { window.location.hash = "#/new-series"; }} isDisabled={!online}><Plus size={16} />{t("newSeries")}</Button>
  </div>;

  return <main className={styles.root}>
    <AppShell activeTab="editor" onTabChange={() => {}} context={context} transitionKey={seriesId}>
      {loading && !series ? <LoadingState label={tc("loading")} /> : !series ? <EmptyState title={t("loadFailed")} description={ts("notFound")} action={<><Button onPress={refresh} isDisabled={!online}>{t("retry")}</Button><a href="#/workspace">{ts("backToHome")}</a></>} /> : <div className={styles.page} aria-busy={loading}>
        {loadError && <div className={styles.error} role="alert">{t("loadFailed")}<Button variant="quiet" onPress={refresh} isDisabled={!online}>{t("retry")}</Button></div>}
        <header className={styles.hero}>
          {cover && <img className={styles.heroImage} src={cover} alt="" />}
          <div className={styles.heroCopy}><p>{t("title")} / {series.workflow_mode === "i2v_legacy" ? "I2V" : "R2V"}</p><h1>{series.title}</h1>{series.description && <p className={styles.description}>{series.description}</p>}<span>{t("episodeCount", { count: episodes.length })}</span></div>
          <Button variant="secondary" className={styles.editButton} onPress={() => openDialog("edit")} isDisabled={!online}>{t("editSeries")}</Button>
        </header>
        <div className={styles.body}>
          <div className={styles.sectionHeader}><div><h2>{t(section)}</h2><p>{t("summary", { episodes: episodes.length, shots: shotCount, videos: videoCount })}</p></div><Button onPress={() => openDialog("episode")} isDisabled={!online || loading || loadError}><Plus size={16} />{t("newEpisode")}</Button></div>
          <nav className={styles.tools} aria-label={t("seriesTools")}>
            {sections.map(item => <Button key={item} variant="quiet" aria-pressed={section === item} onPress={() => setSection(item)}>{t(item)}</Button>)}
            <details><summary>{t("moreSettings")}</summary><div className={styles.settingsMenu}><Button variant="quiet" onPress={() => setSettings("model")}>{ts("genSettings")}</Button><Button variant="quiet" onPress={() => setSettings("prompt")}>{ts("promptConfig")}</Button><Button variant="quiet" onPress={() => setSettings("import")}>{ts("importAssets")}</Button></div></details>
          </nav>
          <PageTransition transitionKey={section}>
            {section === "episodes" ? ordered.length ? <ol className={styles.episodes}>{ordered.map(episode => {
              const thumbnail = deriveCover(episode);
              const status = deriveStatus(episode);
              const progress = productionProgress(episode);
              return <li key={episode.id}><a className={styles.episode} href={`#/series/${seriesId}/episode/${episode.id}`}>
                <div className={styles.thumbnail}>{thumbnail ? <img src={thumbnail} alt="" loading="lazy" /> : <Film size={28} />}</div>
                <div className={styles.episodeCopy}><p>{t("episode", { number: episode.episode_number || 0 })}</p><h3>{episode.title}</h3><span>{episode.originalText || (episode as Project & { original_text?: string }).original_text || t("emptyScript")}</span></div>
                <div className={styles.episodeMeta}><span>{t("shotProgress", { ready: progress.images, total: progress.total })}</span><StatusBadge tone={status === "completed" ? "success" : status === "processing" ? "info" : "neutral"}>{t(status)}</StatusBadge></div><ChevronRight size={18} />
              </a></li>;
            })}</ol> : <EmptyState title={ts("noEpisodes")} description={t("emptyEpisodes")} media={<Film size={30} />} /> : section === "art_direction" ? <SeriesArtDirectionPanel seriesId={seriesId} onSaved={refresh} /> : assets?.length ? <><p className={styles.assetHint}>{ts("sharedAssetsEditHint")}</p><div className={styles.assets}>{assets.map(asset => <AssetCard key={asset.id} asset={asset} type={section as "characters" | "scenes" | "props"} />)}</div></> : <EmptyState title={ts("noAssets", { label: t(section) })} description={ts("assetsSharedHint")} media={<ImageIcon size={28} />} />}
          </PageTransition>
        </div>
      </div>}
    </AppShell>
    <Dialog isOpen={dialog !== null} onOpenChange={open => { if (!open && !saving) setDialog(null); }} isDismissable={!saving} title={t(dialog === "edit" ? "editSeries" : "newEpisode")} closeLabel={tc("close")} footer={<><Button variant="secondary" onPress={() => setDialog(null)} isDisabled={saving}>{tc("cancel")}</Button><Button type="submit" form={formId} isPending={saving} isDisabled={!online || !title.trim()}>{tc("save")}</Button></>}>
      <form id={formId} className={styles.form} onSubmit={save}><TextField autoFocus label={t("name")} value={title} onChange={setTitle} isRequired isDisabled={saving} />{dialog === "edit" && <TextAreaField label={t("description")} value={description} onChange={setDescription} isDisabled={saving} rows={3} />}{saveError && <p role="alert" className={styles.error}>{t("saveFailed")}</p>}</form>
    </Dialog>
    <SeriesModelSettingsModal isOpen={settings === "model"} onClose={() => setSettings(null)} seriesId={seriesId} onSaved={refresh} />
    <SeriesPromptConfigModal isOpen={settings === "prompt"} onClose={() => setSettings(null)} seriesId={seriesId} onSaved={refresh} />
    <ImportAssetsDialog isOpen={settings === "import"} onClose={() => setSettings(null)} seriesId={seriesId} onImported={refresh} />
  </main>;
}
