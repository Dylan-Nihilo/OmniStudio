"use client";

import { useState } from "react";
import { ArrowUpRight, AudioLines, FileText, Film, ImageIcon, Plus, RefreshCw, Search, Layers, FileUp, MoreHorizontal } from "lucide-react";
import { useTranslations } from "next-intl";
import type { Project, Series } from "@/store/projectStore";
import { useAuthStore } from "@/store/authStore";
import { useSettingsStore } from "@/store/settingsStore";
import { useOnline } from "@/lib/useOnline";
import { productionProgress, projectHref, recentProjects } from "@/lib/workspaceOverview";
import { ActionMenu, Button, IconButton, LoadingState, Skeleton, EmptyState } from "@omnistudio/ui";
import ProjectCard, { deriveCover, type ProjectCardProps } from "@/components/project/ProjectCard";
import styles from "./WorkspaceOverview.module.css";

interface Props extends Omit<ProjectCardProps, "project" | "variant"> {
  projects: Project[];
  series: Series[];
  loading: boolean;
  error: boolean;
  onRefresh: () => void;
  onCreate: () => void;
  onCreateSeries: () => void;
  onImport: () => void;
}

export default function WorkspaceOverview({ projects, series, loading, error, onRefresh, onCreate, onCreateSeries, onImport, onDelete, onArchive, onRestore, onRename, onConvert }: Props) {
  const t = useTranslations("workspaceOverview");
  const user = useAuthStore((state) => state.user);
  const locale = useSettingsStore((state) => state.locale);
  const online = useOnline();
  const ordered = recentProjects(projects);
  const featured = ordered[0];
  const progress = featured ? productionProgress(featured) : null;
  const cover = featured && deriveCover(featured);
  const [failedCover, setFailedCover] = useState<string>();
  const queuedProjects = ordered.filter((project) => productionProgress(project).queued > 0);
  const queued = queuedProjects.reduce((count, project) => count + productionProgress(project).queued, 0);
  const date = new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", { month: "long", day: "numeric", weekday: "long" }).format(new Date());
  const featuredSeries = series.find((item) => item.id === featured?.series_id);
  const rows = progress ? [
    { icon: FileText, label: t("script"), value: progress.script ? t("written") : t("notStarted") },
    { icon: ImageIcon, label: t("storyboard"), value: t("shots", { count: progress.images, total: progress.total }) },
    { icon: Film, label: t("video"), value: t("ready", { count: progress.videos }) },
    { icon: AudioLines, label: t("audio"), value: t("ready", { count: progress.audio }) },
  ] : [];

  return (
    <div className={styles.page} aria-busy={loading}>
      <header className={styles.header}>
        <div className={styles.intro}>
          <p className={styles.eyebrow}>{date}</p>
          <h1>{t("greeting", { name: user?.display_name || user?.username || t("creator") })}</h1>
          <p className={styles.subtitle}>{t("subtitle")}</p>
        </div>
        <div className={styles.actions}>
          <IconButton className={styles.iconButton} onPress={onRefresh} isPending={loading} isDisabled={!online} aria-label={t("refresh")}>{!loading && <RefreshCw size={18} />}</IconButton>
          <a className={styles.iconButton} href="#/workspace/projects" aria-label={t("search")} title={t("search")}><Search size={20} /></a>
          <Button onPress={onCreate} isDisabled={!online}><Plus size={18} />{t("newProject")}</Button>
          {featured && <ActionMenu label={t("moreActions")} icon={<MoreHorizontal size={18} />} items={[
            { id: "series", label: t("newSeries"), icon: <Layers size={16} />, isDisabled: !online, onAction: onCreateSeries },
            { id: "import", label: t("import"), icon: <FileUp size={16} />, isDisabled: !online, onAction: onImport },
          ]} />}
        </div>
      </header>

      {error && <div className={styles.error} role="alert"><span>{t("loadFailed")}</span><Button variant="quiet" onPress={onRefresh} isPending={loading} isDisabled={!online}>{t("retry")}</Button></div>}
      {loading && !featured ? <div className={styles.loading}>
        <LoadingState label={t("loading")} inline />
        <div className={styles.production}><Skeleton className={styles.hero} /><div className={styles.skeletonRows}>{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} style={{ height: 48 }} />)}</div></div>
        <div className={styles.cards}>{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} style={{ aspectRatio: '16 / 9', borderRadius: 16 }} />)}</div>
      </div> : featured && progress ? <>
        <section className={styles.continue} aria-labelledby="continue-title">
          <h2 id="continue-title" className={styles.sectionLabel}>{t("continue")}</h2>
          <div className={styles.production}>
            <a className={styles.hero} href={projectHref(featured)}>
              {cover && cover !== failedCover && <img src={cover} alt="" onError={() => setFailedCover(cover)} />}
              <div className={styles.scrim} />
              <div className={styles.heroCopy}>
                <p>{featuredSeries?.title || t("standalone")}{featured.episode_number ? ` / EP.${String(featured.episode_number).padStart(2, "0")}` : ""}</p>
                <h3>{featured.title}</h3>
                <span>{t("shotCount", { count: progress.total })} · {t("videoReady", { count: progress.videos })}</span>
              </div>
              <span className={styles.heroArrow}><ArrowUpRight size={22} aria-hidden="true" /></span>
            </a>
            <div className={styles.progress}>
              <h2>{t("progress")}</h2>
              <dl>{rows.map(({ icon: Icon, label, value }) => <div className={styles.progressRow} key={label}><dt><Icon size={17} aria-hidden="true" />{label}</dt><dd>{value}</dd></div>)}</dl>
              <a className={styles.textLink} href={projectHref(featured)}>{t("openProject")}<ArrowUpRight size={15} /></a>
            </div>
          </div>
        </section>
        <section className={styles.recent} aria-labelledby="recent-title">
          <div className={styles.sectionHeader}><h2 id="recent-title">{t("recent")}</h2><a className={styles.textLink} href="#/workspace/projects">{t("viewAll")}<ArrowUpRight size={14} /></a></div>
          <div className={styles.cards}>{(ordered.length > 1 ? ordered.slice(1, 4) : ordered).map((project) => <ProjectCard key={project.id} project={project} variant="editorial" onDelete={onDelete} onArchive={onArchive} onRestore={onRestore} onRename={onRename} onConvert={onConvert} />)}</div>
        </section>
      </> : !error && <EmptyState className={styles.empty} title={t("emptyTitle")} description={t("emptyBody")} media={<Film size={32} aria-hidden="true" />} action={
        <div className={styles.emptyActions}><Button onPress={onCreate} isDisabled={!online}><Plus size={18} />{t("newProject")}</Button><Button variant="secondary" onPress={onCreateSeries} isDisabled={!online}><Layers size={18} />{t("newSeries")}</Button><Button variant="secondary" onPress={onImport} isDisabled={!online}><FileUp size={18} />{t("import")}</Button></div>
      } />}
      <footer className={styles.queue}>
        <div><span className={styles.queueLabel}><span className={queued ? styles.activeDot : styles.dot} />{t("queue")}</span><p role="status">{loading && !featured ? t("loading") : error ? t("queueUnavailable") : queued ? t("queued", { count: queued }) : t("queueEmpty")}</p></div>
        {queuedProjects[0] && <a className={styles.iconButton} href={projectHref(queuedProjects[0])} aria-label={t("viewQueue")} title={t("viewQueue")}><ArrowUpRight size={20} /></a>}
      </footer>
    </div>
  );
}
