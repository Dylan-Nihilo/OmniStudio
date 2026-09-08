"use client";

import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import {
  Plus, RefreshCw, Library, FileUp, ChevronDown, FileText,
  Film, Sparkles, Search, Clock, MoreVertical,
} from "lucide-react";
import { useProjectStore, Project } from "@/store/projectStore";
import { toast } from "@/store/toastStore";
import { useOnline } from "@/lib/useOnline";
import { ActionMenu, Button, TextField } from "@omnistudio/ui";
import { Dropdown, Label } from "@heroui/react";
import ProjectCard, { deriveStatus, deriveCover, type DerivedStatus } from "@/components/project/ProjectCard";
import CreateSeriesDialog from "@/components/series/CreateSeriesDialog";
import CreateProjectDialog from "@/components/project/CreateProjectDialog";
import EnvConfigDialog from "@/components/project/EnvConfigDialog";
import CreativeCanvas from "@/components/canvas/CreativeCanvas";
import AppShell from "@/components/layout/AppShell";
import PlaygroundModeSelector from "@/components/modules/playground/ModeSelector";
import WorkspaceOverview from "@/components/workspace/WorkspaceOverview";
import { useAuthStore } from "@/store/authStore";
import type { WorkspaceSection } from "@/components/workspace/WorkspaceNavigation";
import ModuleErrorBoundary from "@/components/layout/ModuleErrorBoundary";
import type { GlobalTab } from "@/components/layout/GlobalSidebar";
import dynamic from "next/dynamic";
import { api } from "@/lib/api";
import { useTranslations } from "next-intl";
import TauriMenuListener from "@/components/layout/TauriMenuListener";
import AuthGate from "@/components/auth/AuthGate";
import EnvConfigChecker from "@/components/EnvConfigChecker";
import { isWorkspaceRoute } from "@/lib/workspaceSync";
import { withChunkLoadRecovery } from "@/lib/chunkLoadRecovery";
import { isAuthenticationRecoveryError } from "@/lib/apiClient";
import EpisodeEditLeaseGuard from "@/components/collaboration/EpisodeEditLeaseGuard";
import ActionDialog, { type ActionDialogProps } from "@/components/shared/ActionDialog";
import TaskCenter from "@/components/tasks/TaskCenter";
import type { TaskObjectRef } from "@/components/tasks/taskCenterModel";

const ProjectClient = dynamic(() => withChunkLoadRecovery(() => import("@/components/project/ProjectClient")), { ssr: false });
const SeriesDetailPage = dynamic(() => withChunkLoadRecovery(() => import("@/components/series/SeriesDetailPage")), { ssr: false });
const ImportFileDialog = dynamic(() => withChunkLoadRecovery(() => import("@/components/series/ImportFileDialog")), { ssr: false });
const SettingsPage = dynamic(() => withChunkLoadRecovery(() => import("@/components/settings/SettingsPage")), { ssr: false });
const AssetLibraryPage = dynamic(() => withChunkLoadRecovery(() => import("@/components/library/AssetLibraryPage")), { ssr: false });
const PlaygroundPage = dynamic(() => withChunkLoadRecovery(() => import("@/components/modules/playground/PlaygroundPage")), { ssr: false });
const ScriptEditorShell = dynamic(() => withChunkLoadRecovery(() => import("@/components/modules/ScriptEditor/ScriptEditorShell")), { ssr: false });
const StandaloneScriptEditor = dynamic(() => withChunkLoadRecovery(() => import("@/components/modules/ScriptEditor/StandaloneScriptEditor")), { ssr: false });

// ── New Project Tile (Line B dashed add card) ──
function NewProjectTile({ onClick, episode = false }: { onClick: () => void; episode?: boolean }) {
  const t = useTranslations("workspace");
  return (
    <button
      onClick={onClick}
      className="atelier-new-tile group flex flex-col items-center justify-center gap-3.5 rounded-2xl border-[1.5px] border-dashed border-border bg-transparent cursor-pointer min-h-[240px] text-text-secondary hover:text-foreground hover:border-primary transition-all"
    >
      <span className="w-[54px] h-[54px] rounded-full grid place-items-center bg-surface shadow-sm group-hover:text-primary transition-all">
        <Plus size={24} />
      </span>
      <span className="text-[0.9375rem] font-semibold">{episode ? t("newEpisode") : t("newProject")}</span>
      <span className="font-mono text-[0.59375rem] uppercase tracking-wider text-text-muted">
        {t("fromScript") || "从脚本开始"}
      </span>
    </button>
  );
}

// localStorage key for the workspace gallery/list view preference.
const WS_VIEW_KEY = "omni_studio_workspace_view";

// deriveCover is imported from ProjectCard (single source of truth).

// ── Project Row (Line B list-view item) ──
function ProjectRow({ project, crumb, onArchive, onRestore, onRename, onConvert }: { project: Project; crumb: string; onArchive: (project: Project) => void; onRestore: (project: Project) => void; onRename: (project: Project) => void; onConvert?: (project: Project) => void }) {
  const t = useTranslations("project");
  const cover = deriveCover(project);
  const status = deriveStatus(project);
  const frameCount = project.frames?.length || 0;
  const sceneCount = project.scenes?.length || 0;

  const open = () => { window.location.hash = `#/project/${project.id}`; };

  const badge = {
    completed: { label: t("statusCompleted"), cls: "text-status-completed-fg bg-status-completed-bg border-status-completed-border" },
    processing: { label: t("statusProcessing"), cls: "text-status-processing-fg bg-status-processing-bg border-status-processing-border" },
    pending: { label: t("statusDraft"), cls: "text-status-pending-fg bg-status-pending-bg border-status-pending-border" },
  }[status];

  return (
    <div
      onClick={open}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        // Only activate from the row itself — nested controls (⋯) handle their own keys.
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          if (e.key === " ") e.preventDefault();
          open();
        }
      }}
      className="group glass-panel flex items-center gap-4 rounded-xl border border-glass-border px-3 py-2.5 cursor-pointer hover:bg-hover-bg transition-colors"
    >
      {/* Thumbnail */}
      <div className="relative w-[68px] aspect-[16/10] flex-shrink-0 rounded-lg overflow-hidden bg-surface-inset">
        {cover ? (
          <img src={cover} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full grid place-items-center text-text-muted">
            <FileText size={16} />
          </div>
        )}
      </div>

      {/* Name + series/episode crumb */}
      <div className="flex-1 min-w-0">
        <h3 className="font-display atelier-display text-[1rem] font-semibold leading-tight tracking-tight text-foreground truncate">
          {project.title}
        </h3>
        {crumb && (
          <div className="font-mono text-[0.59375rem] uppercase tracking-wider text-text-muted mt-0.5 truncate">
            {crumb}
          </div>
        )}
      </div>

      {/* Status badge */}
      <span className={`atelier-badge hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[0.59375rem] font-mono font-semibold uppercase tracking-wider flex-shrink-0 ${badge.cls}`}>
        <span className="w-[5px] h-[5px] rounded-full bg-current" />
        {badge.label}
      </span>

      {/* Shot count / duration */}
      <div className="hidden md:flex items-center gap-3 font-mono text-[0.625rem] text-text-secondary flex-shrink-0">
        <span className="inline-flex items-center gap-1">
          <Film size={11} className="text-text-muted" />
          {t("shotCount", { count: frameCount })}
        </span>
        <span className="inline-flex items-center gap-1">
          <Clock size={11} className="text-text-muted" />
          {sceneCount}
        </span>
      </div>

      <div onClick={event => event.stopPropagation()}><ActionMenu label={t("moreActions")} icon={<MoreVertical size={16} />} items={[
        {id:"rename", label:t("rename"), onAction:() => onRename(project)},
        ...(!project.series_id && onConvert ? [{id:"convert", label:t("convertToSeries"), onAction:() => onConvert(project)}] : []),
        {id:"archive", label:t(project.archived ? "restore" : "archive"), onAction:() => project.archived ? onRestore(project) : onArchive(project)},
      ]} /></div>
    </div>
  );
}

// ── Episode Breadcrumb Wrapper ──
function EpisodeBreadcrumbWrapper({ seriesId, episodeId }: { seriesId: string; episodeId: string }) {
  const [seriesTitle, setSeriesTitle] = useState<string>("");
  const [episodeNumber, setEpisodeNumber] = useState<number | null>(null);
  const t = useTranslations("workspace");

  useEffect(() => {
    const fetchInfo = async () => {
      try {
        const series = await api.getSeries(seriesId);
        setSeriesTitle(series.title || "");
        const episodes = await api.getSeriesEpisodes(seriesId);
        const ep = episodes.find((e: Project) => e.id === episodeId);
        if (ep) {
          setEpisodeNumber(ep.episode_number ?? null);
        }
      } catch (error) {
        // Breadcrumb series-info is cosmetic (degrades to generic labels);
        // log only — no user-facing toast to avoid noise on this path.
        console.error("Failed to fetch series info for breadcrumb:", error);
      }
    };
    fetchInfo();
  }, [seriesId, episodeId]);

  const segments = [
    { label: "Omni Studio", hash: "#/" },
    { label: seriesTitle || t("series"), hash: `#/series/${seriesId}` },
    { label: episodeNumber != null ? t("episodeNum", { number: episodeNumber }) : t("episodeLabel") },
  ];

  return (
    <EpisodeEditLeaseGuard scriptId={episodeId}>
      <ProjectClient id={episodeId} breadcrumbSegments={segments} />
    </EpisodeEditLeaseGuard>
  );
}

// ── Main Component ──
function AuthenticatedHome() {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [dialogSeries, setDialogSeries] = useState<{ id: string; title: string } | null>(null);
  const [isSeriesDialogOpen, setIsSeriesDialogOpen] = useState(false);
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [isSyncing, setIsSyncing] = useState(true);
  const [syncError, setSyncError] = useState(false);
  const syncRequest = useRef(0);
  const activeWorkspaceId = useAuthStore((state) => state.activeWorkspace?.id);
  const [currentView, setCurrentView] = useState<'home' | 'project' | 'series' | 'series-episode' | 'library' | 'settings' | 'playground' | 'tasks' | 'studio/editor' | 'project-editor'>('home');
  const [activeTab, setActiveTab] = useState<GlobalTab>("workspace");
  const [workspaceSection, setWorkspaceSection] = useState<WorkspaceSection>("overview");
  const [wsSearch, setWsSearch] = useState("");
  const online = useOnline();
  const [wsStatus, setWsStatus] = useState<DerivedStatus | "all" | "archived">("all");
  const [viewMode, setViewMode] = useState<"gallery" | "list">("gallery");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [seriesId, setSeriesId] = useState<string | null>(null);
  const [episodeId, setEpisodeId] = useState<string | null>(null);
  const [seriesEpisodes, setSeriesEpisodes] = useState<Record<string, Project[]>>({});
  const episodesWorkspace = useRef(activeWorkspaceId);
  const [episodesLoading, setEpisodesLoading] = useState(false);
  const [episodesError, setEpisodesError] = useState(false);
  const projects = useProjectStore((state) => state.projects);
  const seriesList = useProjectStore((state) => state.seriesList);
  const fetchSeriesList = useProjectStore((state) => state.fetchSeriesList);
  const t = useTranslations("workspace");
  const tc = useTranslations("common");
  const activeWorkspace = useAuthStore((state) => state.activeWorkspace);

  const tp = useTranslations("project");
  const [projectAction, setProjectAction] = useState<ActionDialogProps | null>(null);
  const actionRequest = useRef(0);
  useEffect(() => { actionRequest.current += 1; setProjectAction(null); }, [activeWorkspaceId]);

  const prepareProjectAction = async (project: Project, kind: "rename" | "archive" | "purge" | "convert") => {
    const request = ++actionRequest.current;
    const current = () => request === actionRequest.current && activeWorkspaceId === useAuthStore.getState().activeWorkspace?.id;
    const close = () => setProjectAction(null);
    try {
      let action: ActionDialogProps;
      if (kind === "rename") {
        action = {title:tp("rename"), fieldLabel:tp("titleLabel"), initialValue:project.title, onClose:close,
          onConfirm:async title => { await api.updateProject(project.id, {title}); await syncAll(); }};
      } else if (kind === "convert") {
        const preview = await api.previewProjectToSeries(project.id);
        action = {title:tp("convertToSeries"), fieldLabel:tp("seriesTitle"), initialValue:project.title,
          description:tp("conversionImpact", {episode_count:preview.episode_count, characters:preview.characters, scenes:preview.scenes, shots:preview.shots, video_tasks:preview.video_tasks}), onClose:close,
          onConfirm:async title => { await api.convertProjectToSeries(project.id, title); await syncAll(); }};
      } else {
        const preview = kind === "purge" ? await api.getProjectPurgeImpact(project.id) : await api.getProjectArchiveImpact(project.id);
        action = {title:tp(kind), description:preview.message + "\n\n" + tp("retainedCounts", preview.impact) + (kind === "purge" ? "\n\n" + tp("purgeWarning") : ""), danger:kind === "purge", onClose:close,
          onConfirm:async () => {
            if (kind === "archive") { await api.archiveProject(project.id); await syncAll(); return; }
            if (!("confirmation_token" in preview) || typeof preview.confirmation_token !== "string") throw new Error(tp("actionFailed"));
            const submitted = await api.purgeProject(project.id, preview.confirmation_token);
            let job = await api.getPurgeJob(submitted.job_id);
            for (let attempt = 0; attempt < 20 && (job.status === "pending" || job.status === "processing"); attempt += 1) {
              await new Promise(resolve => window.setTimeout(resolve, 250));
              job = await api.getPurgeJob(submitted.job_id);
            }
            if (job.status === "failed") throw new Error(job.error_message || tp("actionFailed"));
            await syncAll();
            if (job.status !== "succeeded") { toast.info(tp("purgePending")); return; }
            toast.success(tp("purgeComplete", {deleted:Number(job.report?.media?.deleted ?? 0), shared:Number(job.report?.media?.skipped_shared ?? 0), failed:Number(job.report?.media?.failed ?? 0)}));
          }};
      }
      if (current()) setProjectAction(action);
    } catch { if (current()) toast.error(tp("actionFailed")); }
  };
  const renameProject = (project: Project) => { void prepareProjectAction(project, "rename"); };
  const archiveProject = (project: Project) => { void prepareProjectAction(project, "archive"); };
  const permanentlyDeleteProject = (project: Project) => { void prepareProjectAction(project, "purge"); };
  const convertProject = (project: Project) => { void prepareProjectAction(project, "convert"); };
  const restoreProject = async (project: Project) => {
    try { await api.restoreProject(project.id); await syncAll(); }
    catch { toast.error(tp("actionFailed")); }
  };

  // Hydrate the persisted gallery/list view preference (client-only to avoid
  // an SSR/CSR mismatch — default stays "gallery" on first paint).
  useEffect(() => {
    try {
      const saved = localStorage.getItem(WS_VIEW_KEY);
      if (saved === "gallery" || saved === "list") setViewMode(saved);
    } catch {
      /* localStorage unavailable — keep default */
    }
  }, []);

  // Ignore responses from a previous workspace or superseded series list.
  useEffect(() => {
    let cancelled = false;
    if (episodesWorkspace.current !== activeWorkspaceId || !seriesList.length) setSeriesEpisodes({});
    episodesWorkspace.current = activeWorkspaceId;
    setEpisodesError(false);
    setEpisodesLoading(seriesList.length > 0);
    if (seriesList.length) {
      Promise.all(seriesList.map(async (series) => [series.id, await api.getSeriesEpisodes(series.id)] as const))
        .then((entries) => { if (!cancelled) setSeriesEpisodes(Object.fromEntries(entries)); })
        .catch((error) => {
          if (cancelled || isAuthenticationRecoveryError(error)) return;
          setEpisodesError(true);
          toast.error(t("toastEpisodesLoadFailed"));
        })
        .finally(() => { if (!cancelled) setEpisodesLoading(false); });
    }
    return () => { cancelled = true; };
  }, [seriesList, activeWorkspaceId, t]);

  const syncAll = async () => {
    const request = ++syncRequest.current;
    const workspaceId = useAuthStore.getState().activeWorkspace?.id;
    const isCurrent = () => request === syncRequest.current && workspaceId === useAuthStore.getState().activeWorkspace?.id;
    setIsSyncing(true);
    setSyncError(false);
    try {
      const [backendProjects, backendSeries] = await Promise.all([api.getProjects(), api.listSeries()]);
      if (isCurrent()) useProjectStore.setState({ projects: backendProjects ?? [], seriesList: backendSeries ?? [] });
    } catch (error) {
      if (isCurrent() && !isAuthenticationRecoveryError(error)) {
        setSyncError(true);
        toast.error(t("toastProjectsSyncFailed"));
      }
    } finally {
      if (isCurrent()) setIsSyncing(false);
    }
  };

  // 监听 hash 变化
  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash;
      // Match #/series/{id}/episode/{eid} first (more specific)
      const seriesEpisodeMatch = hash.match(/^#\/series\/([^/#]+)\/episode\/([^/#]+)(?:#[^/]+)?$/);
      if (seriesEpisodeMatch) {
        setSeriesId(seriesEpisodeMatch[1]);
        setEpisodeId(seriesEpisodeMatch[2]);
        setProjectId(null);
        setCurrentView('series-episode');
        return;
      }
      // Match #/series/{id}
      const seriesMatch = hash.match(/^#\/series\/([^/]+)$/);
      if (seriesMatch) {
        setSeriesId(seriesMatch[1]);
        setEpisodeId(null);
        setProjectId(null);
        setCurrentView('series');
        return;
      }
      if (hash === '#/studio/editor') {
        setCurrentView('studio/editor');
        setActiveTab('editor' as GlobalTab);
        setProjectId(null);
        setSeriesId(null);
        setEpisodeId(null);
        return;
      }
      // Match #/project/{id}/editor
      const projectEditorMatch = hash.match(/^#\/project\/([^/]+)\/editor$/);
      if (projectEditorMatch) {
        setProjectId(projectEditorMatch[1]);
        setSeriesId(null);
        setEpisodeId(null);
        setCurrentView('project-editor');
        return;
      }
      if (hash.startsWith('#/project/')) {
        const id = hash.replace('#/project/', '').split('#')[0];
        setProjectId(id);
        setSeriesId(null);
        setEpisodeId(null);
        setCurrentView('project');
        return;
      }
      if (hash === '#/library') {
        setCurrentView('library');
        setActiveTab('library');
        setProjectId(null);
        setSeriesId(null);
        setEpisodeId(null);
        return;
      }
      if (hash === '#/settings') {
        setCurrentView('settings');
        setActiveTab('settings');
        setProjectId(null);
        setSeriesId(null);
        setEpisodeId(null);
        return;
      }
      if (hash === '#/playground') {
        setCurrentView('playground');
        setActiveTab('playground');
        setProjectId(null);
        setSeriesId(null);
        setEpisodeId(null);
        return;
      }
      if (hash === '#/tasks') {
        setCurrentView('tasks');
        setActiveTab('tasks');
        setProjectId(null);
        setSeriesId(null);
        setEpisodeId(null);
        return;
      }
      // Menu action: open new project dialog then land on workspace
      if (hash === '#/new-project' || hash === '#/new-series') {
        setCurrentView('home');
        setActiveTab('workspace');
        setProjectId(null);
        setSeriesId(null);
        setEpisodeId(null);
        if (hash === '#/new-series') { setIsSeriesDialogOpen(true); setWorkspaceSection('series'); }
        else setIsDialogOpen(true);
        void syncAll();
        // Clean URL without triggering another hashchange
        history.replaceState(null, '', '#/');
        return;
      }
      const section = hash.split("/")[2];
      setWorkspaceSection(section === "projects" || section === "series" || section === "drafts" ? section : "overview");
      setWsStatus(section === "drafts" ? "pending" : "all");
      // Default: workspace
      if (isWorkspaceRoute(hash)) {
        void syncAll();
      }
      setCurrentView('home');
      setActiveTab('workspace');
      setProjectId(null);
      setSeriesId(null);
      setEpisodeId(null);
    };

    handleHashChange();
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  // 项目详情页 — 全屏，无 GlobalSidebar
  if (currentView === 'project' && projectId) {
    return (
      <EpisodeEditLeaseGuard scriptId={projectId}>
        <ProjectClient id={projectId} />
      </EpisodeEditLeaseGuard>
    );
  }

  // 系列集数编辑 — 全屏，BreadcrumbBar 内嵌在 ProjectClient
  if (currentView === 'series-episode' && seriesId && episodeId) {
    return <EpisodeBreadcrumbWrapper seriesId={seriesId} episodeId={episodeId} />;
  }

  // 系列详情页 — 全屏，自带 BreadcrumbBar
  if (currentView === 'series' && seriesId) {
    return <SeriesDetailPage key={seriesId} seriesId={seriesId} />;
  }

  if (currentView === 'library') {
    return <main className="h-[100dvh] w-full"><ModuleErrorBoundary moduleName="资产库"><AssetLibraryPage key={activeWorkspaceId} /></ModuleErrorBoundary></main>;
  }

  // Filter standalone projects (not belonging to any series)
  const standaloneProjects = workspaceSection === "series" ? [] : projects.filter((p) => !p.series_id);

  const totalCount = seriesList.length + standaloneProjects.length;

  const handleTabChange = (tab: GlobalTab) => {
    setActiveTab(tab);
  };

  // Persisted gallery/list switch for the workspace.
  const changeViewMode = (mode: "gallery" | "list") => {
    setViewMode(mode);
    try { localStorage.setItem(WS_VIEW_KEY, mode); } catch { /* localStorage unavailable */ }
  };

  // Determine content based on activeTab
  const renderContent = () => {
    if (currentView === 'settings') {
      return <SettingsPage key={activeWorkspaceId} />;
    }
    if (currentView === 'playground') {
      return <PlaygroundPage />;
    }
    if (currentView === 'tasks') {
      const openTaskObject = (ref: TaskObjectRef) => {
        const target = ref.episodeId || ref.projectId;
        if (target) window.location.hash = `#/project/${target}`;
      };
      return <TaskCenter key={activeWorkspace?.id} workspaceId={activeWorkspace?.id ?? "default"} onOpenObject={openTaskObject} onClose={() => { window.location.hash = "#/"; }} />;
    }
    if (currentView === 'studio/editor') {
      return <StandaloneScriptEditor />;
    }
    if (currentView === 'project-editor' && projectId) {
      return <ScriptEditorShell mode="embedded" projectId={projectId} />;
    }

    // Workspace view — Line B skeleton
    const wsAllProjects: Project[] = [...seriesList.flatMap((series) => seriesEpisodes[series.id] || []), ...standaloneProjects];
    if (workspaceSection === "overview") {
      return <WorkspaceOverview projects={wsAllProjects.filter(project => !project.archived && !seriesList.some(series => series.id === project.series_id && series.archived))} series={seriesList.filter(series => !series.archived)}
        loading={isSyncing || episodesLoading} error={syncError || episodesError}
        onRefresh={syncAll} onCreate={() => setIsDialogOpen(true)}
        onCreateSeries={() => setIsSeriesDialogOpen(true)} onImport={() => setIsImportDialogOpen(true)}
        onDelete={permanentlyDeleteProject} onArchive={archiveProject} onRestore={restoreProject} onRename={renameProject} onConvert={convertProject} />;
    }
    const archivedSeriesEpisodeIds = new Set(seriesList.filter(series => series.archived).flatMap(series => (seriesEpisodes[series.id] || []).map(episode => episode.id)));
    const wsStatusCounts: Record<"all" | DerivedStatus | "archived", number> = {
      all: wsAllProjects.filter(project => !project.archived && !archivedSeriesEpisodeIds.has(project.id)).length,
      completed: 0,
      processing: 0,
      pending: 0,
      archived: 0,
    };
    for (const p of wsAllProjects) {
      if (p.archived || archivedSeriesEpisodeIds.has(p.id)) wsStatusCounts.archived++;
      else wsStatusCounts[deriveStatus(p)]++;
    }
    const wsQuery = wsSearch.trim().toLowerCase();
    const wsFiltering = wsStatus !== "all" || wsQuery.length > 0;
    const wsMatch = (p: Project, seriesTitleMatched = false, parentArchived = false) => {
      const archived = p.archived || parentArchived;
      if (wsStatus === "archived" ? !archived : archived || (wsStatus !== "all" && deriveStatus(p) !== wsStatus)) return false;
      // A matching series title keeps the whole series' episodes visible (search at group level).
      if (wsQuery && !seriesTitleMatched && !p.title.toLowerCase().includes(wsQuery)) return false;
      return true;
    };
    const wsStatusPills: { id: "all" | DerivedStatus | "archived"; label: string; count: number }[] = [
      { id: "all", label: t("filterAll"), count: wsStatusCounts.all },
      { id: "completed", label: t("filterCompleted"), count: wsStatusCounts.completed },
      { id: "processing", label: t("filterProcessing"), count: wsStatusCounts.processing },
      { id: "pending", label: t("filterDraft"), count: wsStatusCounts.pending },
      { id: "archived", label: "已归档", count: wsStatusCounts.archived },
    ];
    // Precompute filtered groups once — single source of truth for the grid render
    // and the filtered-empty count below (avoids the two diverging).
    const wsSeriesGroups = seriesList.map((s) => {
      const seriesTitleMatched = wsQuery.length > 0 && s.title.toLowerCase().includes(wsQuery);
      const eps = [...(seriesEpisodes[s.id] || [])]
        .sort((a, b) => (a.episode_number || 0) - (b.episode_number || 0))
        .filter((ep) => wsMatch(ep, seriesTitleMatched, Boolean(s.archived)));
      return { s, eps };
    });
    const wsVisibleStandalone = standaloneProjects.filter((p) => wsMatch(p));
    const wsVisibleCount =
      wsVisibleStandalone.length + wsSeriesGroups.reduce((n, g) => n + g.eps.length, 0);
    return (
      <div className="flex flex-col h-full overflow-hidden">
        {/* Page header — eyebrow + Fraunces title + actions */}
        <header className="px-4 md:px-7 pt-5 md:pt-6 pb-3 flex flex-col md:flex-row md:items-end gap-3 md:gap-5">
          <div className="flex-1 min-w-0">
            <div className="font-mono text-[0.625rem] font-medium uppercase tracking-[0.2em] text-text-muted">
              WORKSPACE · <span className="text-primary font-semibold">{t("gallery") || "画廊"}</span>
            </div>
            <h1 className="text-[1.625rem] md:text-[2.125rem] font-display atelier-display font-semibold text-foreground leading-tight tracking-tight mt-1">
              {t("title")}
            </h1>
          </div>
          <div className="flex items-center flex-wrap gap-2.5 md:pb-1">
            <Button variant="secondary" onPress={() => void syncAll()} isPending={isSyncing} isDisabled={!online} aria-description={!online ? tc("offlineTooltip") : undefined}>
              <RefreshCw size={14} />{tc("sync")}
            </Button>
            <Button variant="secondary" onPress={() => setIsImportDialogOpen(true)} isDisabled={!online} aria-description={!online ? tc("offlineTooltip") : undefined}>
              <FileUp size={14} />{t("importFile")}
            </Button>
            <Dropdown>
              <Button isDisabled={!online} aria-description={!online ? tc("offlineTooltip") : undefined}><Plus size={14} />{t("new")}<ChevronDown size={12} /></Button>
              <Dropdown.Popover placement="bottom end">
                <Dropdown.Menu aria-label={t("new")}>
                  <Dropdown.Item id="series" textValue={t("newSeries")} onAction={() => setIsSeriesDialogOpen(true)}><Library size={16} /><Label>{t("newSeries")}</Label></Dropdown.Item>
                  <Dropdown.Item id="project" textValue={t("newProject")} onAction={() => setIsDialogOpen(true)}><FileText size={16} /><Label>{t("newProject")}</Label></Dropdown.Item>
                  <Dropdown.Item id="playground" textValue="Playground" onAction={() => { window.location.hash = "#/playground"; }}><Sparkles size={16} /><Label>Playground</Label></Dropdown.Item>
                </Dropdown.Menu>
              </Dropdown.Popover>
            </Dropdown>
          </div>
        </header>

        <div className="px-4 md:px-7 pb-2 flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap gap-1" role="group" aria-label={t("statusFilterAria")}>
            {wsStatusPills.map(pill => <Button key={pill.id} variant={wsStatus === pill.id ? "secondary" : "quiet"} aria-pressed={wsStatus === pill.id} onPress={() => setWsStatus(pill.id)}>
              {pill.label}<span className="font-mono text-xs text-text-muted">{pill.count}</span>
            </Button>)}
          </div>
          <TextField label={t("searchPlaceholder")} type="search" value={wsSearch} onChange={setWsSearch} placeholder={t("searchPlaceholder")}
            className="min-w-44 max-w-[340px] flex-1 [&>label]:sr-only" />
          <div className="ml-auto flex gap-1" role="group" aria-label={`${t("gallery")} / ${t("list")}`}>
            <Button variant={viewMode === "gallery" ? "secondary" : "quiet"} aria-pressed={viewMode === "gallery"} onPress={() => changeViewMode("gallery")}>{t("gallery")}</Button>
            <Button variant={viewMode === "list" ? "secondary" : "quiet"} aria-pressed={viewMode === "list"} onPress={() => changeViewMode("list")}>{t("list")}</Button>
          </div>
        </div>

        {/* Scrollable content area */}
        <div className="flex-1 overflow-y-auto px-7 pb-10 pt-3">
          {totalCount === 0 ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex flex-col items-center justify-center py-16"
            >
              <div className="glass-panel atelier-card p-10 rounded-2xl border border-glass-border text-center max-w-[620px] w-full relative overflow-hidden">
                <div className="relative z-[1] flex flex-col items-center gap-4">
                  <div className="font-mono text-[0.625rem] uppercase tracking-[0.22em] text-text-muted">
                    STORIES, RENDERED ALIVE.
                  </div>
                  <p className="text-[2.125rem] font-display atelier-display font-medium italic leading-[1.25] tracking-tight text-foreground">
                    {t("emptyQuote") || "\u201c每一座城市，都藏着一个还没被讲出来的故事。\u201d"}
                  </p>
                  <p className="text-[0.9375rem] text-text-secondary max-w-[440px]">
                    {t("emptyHint")}
                  </p>
                  <div className="flex gap-3 mt-2">
                    <button
                      onClick={() => setIsSeriesDialogOpen(true)}
                      className="bg-primary hover:bg-primary/90 text-on-accent px-5 py-2.5 rounded-[10px] font-semibold flex items-center gap-2 transition-all text-[0.8125rem] shadow-[var(--glow-primary)]"
                    >
                      <Plus size={14} />
                      {t("createSeries")}
                    </button>
                    <button
                      onClick={() => setIsDialogOpen(true)}
                      className="glass-button flex items-center gap-2 text-[0.8125rem] font-semibold"
                    >
                      <FileText size={14} />
                      {t("createProject")}
                    </button>
                  </div>
                </div>
              </div>
              <button
                onClick={syncAll}
                disabled={isSyncing}
                className="mt-5 glass-button flex items-center gap-2 text-[0.8125rem] font-semibold disabled:opacity-50"
              >
                <RefreshCw size={14} className={isSyncing ? "animate-spin" : ""} />
                {t("syncFromBackend")}
              </button>
            </motion.div>
          ) : wsFiltering && wsVisibleCount === 0 ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex flex-col items-center justify-center py-20 text-text-muted"
            >
              <Search size={48} className="mb-3 opacity-60" />
              <p className="text-[0.9375rem] font-display atelier-display text-foreground">{t("noMatchTitle")}</p>
              <p className="text-[0.75rem] text-text-muted mt-1">{tc("noMatchHint")}</p>
              <button
                onClick={() => { setWsStatus("all"); setWsSearch(""); }}
                className="mt-4 glass-button text-[0.8125rem] font-semibold"
              >
                {tc("clearFilters")}
              </button>
            </motion.div>
          ) : (
            <div className="flex flex-col gap-2">
              {/* Per-series groups — Line B editorial gallery */}
              {wsSeriesGroups.map(({ s, eps }) => {
                if (eps.length === 0 && wsFiltering) return null;
                return (
                  <section key={`grp-${s.id}`} aria-label={s.title}>
                    <div className="flex items-baseline gap-3 mt-4 mb-4 mx-0.5">
                      <button
                        onClick={() => { window.location.hash = `#/series/${s.id}`; }}
                        className="font-display atelier-display text-[1.5rem] font-semibold tracking-tight text-foreground hover:text-primary transition-colors"
                      >
                        {s.title}
                      </button>
                      {s.archived && <span className="rounded bg-surface-inset px-1.5 py-0.5 text-[0.625rem] text-text-muted">项目已归档</span>}
                      <span className="font-mono text-[0.625rem] uppercase tracking-wider text-text-muted">
                        {t("series")} · {t("frames", { count: eps.length })}
                      </span>
                      <span className="atelier-group-line h-px flex-1 bg-glass-border" />
                    </div>
                    {viewMode === "list" ? (
                      <div className="flex flex-col gap-1.5">
                        {eps.map((ep, i) => (
                          <div
                            key={`ep-${ep.id}`}
                            className="atelier-reveal"
                            style={{ animationDelay: `${Math.min(i * 60, 300)}ms` }}
                          >
                            <ProjectRow
                              project={ep}
                              crumb={`${s.title}${ep.episode_number ? ` · EP.${String(ep.episode_number).padStart(2, "0")}` : ""}`}
                              onArchive={archiveProject}
                              onRestore={restoreProject}
                              onRename={renameProject}
                              onConvert={convertProject}
                            />
                          </div>
                        ))}
                        {!wsFiltering && (
                          <button
                            onClick={() => { setDialogSeries({ id: s.id, title: s.title }); setIsDialogOpen(true); }}
                            className="group flex items-center gap-3 rounded-xl border border-dashed border-border bg-transparent px-3 py-2.5 text-text-secondary hover:text-foreground hover:border-primary transition-colors"
                          >
                            <span className="w-8 h-8 rounded-lg grid place-items-center bg-surface group-hover:text-primary transition-colors flex-shrink-0">
                              <Plus size={15} />
                            </span>
                            <span className="text-[0.8125rem] font-semibold">{t("newEpisode")}</span>
                          </button>
                        )}
                      </div>
                    ) : (
                      <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-8">
                        {eps.map((ep, i) => (
                          <div
                            key={`ep-${ep.id}`}
                            className="atelier-reveal"
                            style={{ animationDelay: `${Math.min(i * 60, 300)}ms` }}
                          >
                            <ProjectCard variant="editorial" project={ep} onDelete={permanentlyDeleteProject} onArchive={archiveProject} onRestore={restoreProject} onRename={renameProject} onConvert={convertProject} />
                          </div>
                        ))}
                        {!wsFiltering && <NewProjectTile episode onClick={() => { setDialogSeries({ id: s.id, title: s.title }); setIsDialogOpen(true); }} />}
                      </div>
                    )}
                  </section>
                );
              })}

              {/* Standalone projects group */}
              {(() => {
                if (standaloneProjects.length === 0) return null;
                const sp = wsVisibleStandalone;
                if (sp.length === 0 && wsFiltering) return null;
                return (
                <section aria-label={t("standaloneGroup") || "独立项目"}>
                  <div className="flex items-baseline gap-3 mt-6 mb-4 mx-0.5">
                    <span className="font-display atelier-display text-[1.5rem] font-semibold tracking-tight text-foreground">
                      {t("standaloneGroup") || "独立项目"}
                    </span>
                    <span className="font-mono text-[0.625rem] uppercase tracking-wider text-text-muted">
                      {t("frames", { count: sp.length })}
                    </span>
                    <span className="atelier-group-line h-px flex-1 bg-glass-border" />
                  </div>
                  {viewMode === "list" ? (
                    <div className="flex flex-col gap-1.5">
                      {sp.map((p, i) => (
                        <div
                          key={`p-${p.id}`}
                          className="atelier-reveal"
                          style={{ animationDelay: `${Math.min(i * 60, 300)}ms` }}
                        >
                          <ProjectRow project={p} crumb="" onArchive={archiveProject} onRestore={restoreProject} onRename={renameProject} onConvert={convertProject} />
                        </div>
                      ))}
                      {!wsFiltering && (
                        <button
                          onClick={() => setIsDialogOpen(true)}
                          className="group flex items-center gap-3 rounded-xl border border-dashed border-border bg-transparent px-3 py-2.5 text-text-secondary hover:text-foreground hover:border-primary transition-colors"
                        >
                          <span className="w-8 h-8 rounded-lg grid place-items-center bg-surface group-hover:text-primary transition-colors flex-shrink-0">
                            <Plus size={15} />
                          </span>
                          <span className="text-[0.8125rem] font-semibold">{t("newProject")}</span>
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-8">
                      {sp.map((p, i) => (
                        <div
                          key={`p-${p.id}`}
                          className="atelier-reveal"
                          style={{ animationDelay: `${Math.min(i * 60, 300)}ms` }}
                        >
                          <ProjectCard variant="editorial" project={p} onDelete={permanentlyDeleteProject} onArchive={archiveProject} onRestore={restoreProject} onRename={renameProject} onConvert={convertProject} />
                        </div>
                      ))}
                      {!wsFiltering && <NewProjectTile onClick={() => setIsDialogOpen(true)} />}
                    </div>
                  )}
                </section>
                );
              })()}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <main className="relative h-[100dvh] w-full bg-background flex flex-col">
      {/* Background Canvas */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <CreativeCanvas />
      </div>

      {/* Atelier atmosphere overlays — inert on non-atelier themes.
          Mounted at page level so bloom/grain cover workspace, playground, library, etc.
          SettingsPage also mounts its own copies (harmless duplicates). */}
      <div className="atelier-page-bloom" aria-hidden="true" />
      <div className="atelier-page-grain" aria-hidden="true" />

      {/* AppShell with GlobalSidebar + content */}
      <div className="relative z-10 min-h-0 flex-1 overflow-hidden">
        <AppShell transitionKey={`${currentView}/${workspaceSection}`} activeTab={activeTab} onTabChange={handleTabChange} workspaceSection={workspaceSection} context={activeTab === "playground" ? <PlaygroundModeSelector /> : undefined}>
          <ModuleErrorBoundary key={currentView} moduleName={currentView === "playground" ? "创作台" : currentView === "settings" ? "设置" : currentView === "tasks" ? "任务中心" : "工作区"}>
            {renderContent()}
          </ModuleErrorBoundary>
        </AppShell>
      </div>

      {projectAction && <ActionDialog {...projectAction} />}

      {/* Create Project Dialog */}
      <CreateProjectDialog
        isOpen={isDialogOpen}
        seriesId={dialogSeries?.id}
        seriesTitle={dialogSeries?.title}
        onClose={() => { setIsDialogOpen(false); setDialogSeries(null); }}
      />

      {/* Create Series Dialog */}
      <CreateSeriesDialog
        isOpen={isSeriesDialogOpen}
        onClose={() => setIsSeriesDialogOpen(false)}
      />

      {/* Environment Configuration Dialog (kept for EnvConfigChecker) */}
      <EnvConfigDialog
        isOpen={false}
        onClose={() => {}}
        isRequired={false}
      />

      {/* Import File Dialog */}
      <ImportFileDialog
        isOpen={isImportDialogOpen}
        onClose={() => setIsImportDialogOpen(false)}
        onSuccess={() => fetchSeriesList()}
      />

      {/* Tauri native menu event listener */}
      <TauriMenuListener onNewProject={() => setIsDialogOpen(true)} />
    </main>
  );
}

export default function Home() {
  return (
    <AuthGate>
      <EnvConfigChecker />
      <AuthenticatedHome />
    </AuthGate>
  );
}
