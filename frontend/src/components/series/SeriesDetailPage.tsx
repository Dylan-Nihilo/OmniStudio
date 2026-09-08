"use client";

import { useEffect, useId, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { ChevronRight, Film, Image as ImageIcon, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { ActionMenu, Button, Dialog, EmptyState, LoadingState, NavigationMenu, PageTransition, StatusBadge, TextAreaField, TextField } from "@omnistudio/ui";
import { api } from "@/lib/api";
import { productionProgress } from "@/lib/workspaceOverview";
import type { Series, Project } from "@/store/projectStore";
import AssetCard from "@/components/common/AssetCard";
import ActionDialog, { type ActionDialogProps } from "@/components/shared/ActionDialog";
import { toast } from "@/store/toastStore";
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

  const tp = useTranslations("project");
  const [action, setAction] = useState<ActionDialogProps | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const mutation = useRef(false);
  const actionRequest = useRef(0);
  useEffect(() => { actionRequest.current += 1; setAction(null); }, [seriesId]);
  const perform = async (operation: () => Promise<unknown>) => {
    if (mutation.current) return;
    mutation.current = true; setActionBusy(true);
    try { await operation(); refresh(); }
    catch { toast.error(tp("actionFailed")); }
    finally { mutation.current = false; setActionBusy(false); }
  };
  const moveEpisode = (episode: Project, direction: number) => {
    const order = [...episodes].sort((a,b) => (a.episode_number || 0) - (b.episode_number || 0));
    const from = order.findIndex(item => item.id === episode.id), to = from + direction;
    if (from < 0 || to < 0 || to >= order.length) return;
    [order[from], order[to]] = [order[to], order[from]];
    void perform(() => api.reorderSeriesEpisodes(seriesId, order.map(item => item.id)));
  };
  const closeAction = () => { actionRequest.current += 1; setAction(null); };
  const toggleEpisodeArchive = (episode: Project) => {
    closeAction();
    if (episode.archived) { void perform(() => api.restoreSeriesEpisode(seriesId, episode.id)); return; }
    setAction({title:tp("archive"), description:t("archiveEpisodeHint", {title:episode.title}), onClose:closeAction,
      onConfirm:async () => { await api.archiveSeriesEpisode(seriesId, episode.id); refresh(); }});
  };
  const toggleSeriesArchive = async () => {
    if (!series) return;
    closeAction();
    if (series.archived) { void perform(() => api.restoreSeries(seriesId)); return; }
    const request = ++actionRequest.current;
    try {
      const preview = await api.getSeriesArchiveImpact(seriesId);
      if (request !== actionRequest.current) return;
      setAction({title:tp("archive"), description:preview.message + "\n\n" + tp("retainedCounts", preview.impact), onClose:closeAction,
        onConfirm:async () => { await api.archiveSeries(seriesId); refresh(); }});
    } catch { if (request === actionRequest.current) toast.error(tp("actionFailed")); }
  };
  const promoteDefaults = async (episode: Project) => {
    const request = ++actionRequest.current;
    try {
      const preview = await api.previewEpisodeDefaultPromotion(seriesId, episode.id);
      if (request !== actionRequest.current) return;
      const labels: Record<string,string> = {model_settings:ts("genSettings"), prompt_config:ts("promptConfig"), art_direction:t("art_direction"), workflow_mode:t("workflow"), default_generation_mode:t("generationMode")};
      const changes = Object.keys(preview.changes).map(key => labels[key] || key).join("、");
      setAction({title:t("promoteDefaults"), description:t("promoteHint", {title:episode.title, changes:changes || t("noDefaultChanges")}), onClose:closeAction,
        onConfirm:async () => { await api.promoteEpisodeDefaults(seriesId, episode.id, preview.sections); refresh(); toast.success(t("defaultsPromoted")); }});
    } catch { if (request === actionRequest.current) toast.error(tp("actionFailed")); }
  };

  const openDialog = (value: "edit" | "episode") => {
    closeAction();
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
          <div className={styles.heroCopy}><p>{t("title")} / {series.workflow_mode === "i2v_legacy" ? "I2V" : "R2V"}</p><h1>{series.title}</h1>{series.archived && <StatusBadge>{tp("archived")}</StatusBadge>}{series.description && <p className={styles.description}>{series.description}</p>}<span>{t("episodeCount", { count: episodes.length })}</span></div>
          <Button variant="secondary" className={styles.editButton} onPress={() => openDialog("edit")} isDisabled={!online}>{t("editSeries")}</Button>
        </header>
        <div className={styles.body}>
          <div className={styles.sectionHeader}><div><h2>{t(section)}</h2><p>{t("summary", { episodes: episodes.length, shots: shotCount, videos: videoCount })}</p></div><Button onPress={() => openDialog("episode")} isDisabled={!online || loading || loadError}><Plus size={16} />{t("newEpisode")}</Button></div>
          <nav className={styles.tools} aria-label={t("seriesTools")}>
            {sections.map(item => <Button key={item} variant="quiet" aria-pressed={section === item} onPress={() => setSection(item)}>{t(item)}</Button>)}
            <ActionMenu label={t("moreSettings")} className={styles.moreSettings} items={[
              { id: "archive", label: tp(series.archived ? "restore" : "archive"), isDisabled: !online || actionBusy, onAction: () => { void toggleSeriesArchive(); } },
              { id: "model", label: ts("genSettings"), isDisabled: !online, onAction: () => { closeAction(); setSettings("model"); } },
              { id: "prompt", label: ts("promptConfig"), isDisabled: !online, onAction: () => { closeAction(); setSettings("prompt"); } },
              { id: "import", label: ts("importAssets"), isDisabled: !online, onAction: () => { closeAction(); setSettings("import"); } },
            ]} />
          </nav>
          <PageTransition transitionKey={section}>
            {section === "episodes" ? ordered.length ? <ol className={styles.episodes}>{ordered.map((episode, index) => {
              const thumbnail = deriveCover(episode);
              const status = deriveStatus(episode);
              const progress = productionProgress(episode);
              return <li key={episode.id} className={styles.episodeRow}><a className={styles.episode} href={`#/series/${seriesId}/episode/${episode.id}`}>
                <div className={styles.thumbnail}>{thumbnail ? <img src={thumbnail} alt="" loading="lazy" /> : <Film size={28} />}</div>
                <div className={styles.episodeCopy}><p>{t("episode", { number: episode.episode_number || 0 })}</p><h3>{episode.title}</h3><span>{episode.originalText || (episode as Project & { original_text?: string }).original_text || t("emptyScript")}</span></div>
                <div className={styles.episodeMeta}><span>{t("shotProgress", { ready: progress.images, total: progress.total })}</span><StatusBadge tone={status === "completed" ? "success" : status === "processing" ? "info" : "neutral"}>{episode.archived ? tp("archived") : t(status)}</StatusBadge></div><ChevronRight size={18} />
              </a><ActionMenu label={t("episodeActions", {number:episode.episode_number || index + 1})} items={[
                {id:"up", label:t("moveUp"), isDisabled:!online || loading || loadError || actionBusy || index === 0, onAction:() => moveEpisode(episode, -1)},
                {id:"down", label:t("moveDown"), isDisabled:!online || loading || loadError || actionBusy || index === ordered.length - 1, onAction:() => moveEpisode(episode, 1)},
                {id:"archive", label:tp(episode.archived ? "restore" : "archive"), isDisabled:!online || loading || loadError || actionBusy, onAction:() => toggleEpisodeArchive(episode)},
                {id:"defaults", label:t("promoteDefaults"), isDisabled:!online || loading || loadError || actionBusy, onAction:() => { void promoteDefaults(episode); }},
              ]} /></li>;
            })}</ol> : <EmptyState title={ts("noEpisodes")} description={t("emptyEpisodes")} media={<Film size={30} />} /> : section === "art_direction" ? <SeriesArtDirectionPanel seriesId={seriesId} onSaved={refresh} /> : assets?.length ? <><p className={styles.assetHint}>{ts("sharedAssetsEditHint")}</p><div className={styles.assets}>{assets.map(asset => <AssetCard key={asset.id} asset={asset} type={section as "characters" | "scenes" | "props"} />)}</div></> : <EmptyState title={ts("noAssets", { label: t(section) })} description={ts("assetsSharedHint")} media={<ImageIcon size={28} />} />}
          </PageTransition>
        </div>
      </div>}
    </AppShell>
    {action && <ActionDialog {...action} />}
    <Dialog isOpen={dialog !== null} onOpenChange={open => { if (!open && !saving) setDialog(null); }} isDismissable={!saving} title={t(dialog === "edit" ? "editSeries" : "newEpisode")} closeLabel={tc("close")} footer={<><Button variant="secondary" onPress={() => setDialog(null)} isDisabled={saving}>{tc("cancel")}</Button><Button type="submit" form={formId} isPending={saving} isDisabled={!online || !title.trim()}>{tc("save")}</Button></>}>
      <form id={formId} className={styles.form} onSubmit={save}><TextField autoFocus label={t("name")} value={title} onChange={setTitle} isRequired isDisabled={saving} />{dialog === "edit" && <TextAreaField label={t("description")} value={description} onChange={setDescription} isDisabled={saving} rows={3} />}{saveError && <p role="alert" className={styles.error}>{t("saveFailed")}</p>}</form>
    </Dialog>
    <SeriesModelSettingsModal isOpen={settings === "model"} onClose={() => setSettings(null)} seriesId={seriesId} onSaved={refresh} />
    <SeriesPromptConfigModal isOpen={settings === "prompt"} onClose={() => setSettings(null)} seriesId={seriesId} onSaved={refresh} />
    <ImportAssetsDialog isOpen={settings === "import"} onClose={() => setSettings(null)} seriesId={seriesId} onImported={refresh} />
  </main>;
}
