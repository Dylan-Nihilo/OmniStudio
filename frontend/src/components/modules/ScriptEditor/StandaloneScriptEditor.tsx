'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, ArrowLeft, BookOpen, FolderOpen, Loader2, Plus, RefreshCw, Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { api } from '@/lib/api';
import { useProjectStore } from '@/store/projectStore';
import ScriptEditorShell from './ScriptEditorShell';

const LAST_PROJECT_STORAGE_KEY = 'omni_studio.script-editor.last-project';

function rememberLastProject(projectId: string) {
  try {
    window.localStorage.setItem(LAST_PROJECT_STORAGE_KEY, projectId);
  } catch {
    // Local storage can be unavailable in private or restricted contexts.
  }
}

export default function StandaloneScriptEditor() {
  const t = useTranslations('scriptEditor');
  const projects = useProjectStore((state) => state.projects);
  const setProjects = useProjectStore((state) => state.setProjects);
  const createProject = useProjectStore((state) => state.createProject);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [newProjectTitle, setNewProjectTitle] = useState('');
  const [isLoadingProjects, setIsLoadingProjects] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadProjects = async () => {
    setIsLoadingProjects(true);
    setLoadError(null);
    try {
      const latestProjects = await api.getProjects();
      setProjects(latestProjects);
      try {
        const lastProjectId = window.localStorage.getItem(LAST_PROJECT_STORAGE_KEY);
        if (lastProjectId && latestProjects.some((project) => project.id === lastProjectId)) {
          setSelectedProjectId(lastProjectId);
        }
      } catch {
        // Keep the picker usable when local storage is unavailable.
      }
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : t('standalone.loadProjectsFailed'));
    } finally {
      setIsLoadingProjects(false);
    }
  };

  useEffect(() => {
    void loadProjects();
    // Loading is intentionally scoped to this route mount. The project store
    // remains the shared source for the picker and the rest of the workspace.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredProjects = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return projects;
    return projects.filter((project) => project.title.toLowerCase().includes(query));
  }, [projects, searchQuery]);

  const selectedProject = projects.find((project) => project.id === selectedProjectId);

  const handleCreateProject = async () => {
    const title = newProjectTitle.trim();
    if (!title || isCreating) return;

    setIsCreating(true);
    setLoadError(null);
    try {
      await createProject(title, '', true, 'r2v');
      const createdProject = useProjectStore.getState().currentProject;
      if (createdProject) {
        rememberLastProject(createdProject.id);
        setSelectedProjectId(createdProject.id);
        setNewProjectTitle('');
      }
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : t('standalone.createProjectFailed'));
    } finally {
      setIsCreating(false);
    }
  };

  if (selectedProjectId && selectedProject) {
    return (
      <ScriptEditorShell
        mode="full"
        projectId={selectedProject.id}
        projectTitle={selectedProject.title}
        onChangeProject={() => setSelectedProjectId(null)}
      />
    );
  }

  return (
    <main className="flex h-full min-h-0 w-full items-center justify-center overflow-y-auto bg-background px-6 py-10 text-foreground">
      <section className="w-full max-w-3xl rounded-2xl border border-glass-border bg-surface p-6 shadow-2xl sm:p-8">
        <div className="flex items-start gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
            <BookOpen size={21} />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-semibold text-foreground">{t('standalone.emptyTitle')}</h1>
            <p className="mt-1 text-sm leading-6 text-text-secondary">{t('standalone.emptyDescription')}</p>
          </div>
          <button
            type="button"
            onClick={() => { window.location.hash = '#/'; }}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-text-secondary transition-colors hover:bg-hover-bg hover:text-foreground"
          >
            <ArrowLeft size={14} />
            {t('standalone.backToWorkspace')}
          </button>
        </div>

        <div className="mt-7 grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
          <div>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-medium text-foreground">{t('standalone.selectProject')}</h2>
              <button
                type="button"
                onClick={() => void loadProjects()}
                disabled={isLoadingProjects}
                className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-text-secondary transition-colors hover:bg-hover-bg hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                title={t('standalone.refreshProjects')}
              >
                <RefreshCw size={13} className={isLoadingProjects ? 'animate-spin' : ''} />
                {t('standalone.refreshProjects')}
              </button>
            </div>

            <div className="relative mb-3">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
              <input
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder={t('standalone.searchProjects')}
                className="w-full rounded-lg border border-glass-border bg-input-bg px-9 py-2.5 text-sm text-foreground outline-none transition-colors placeholder:text-text-muted focus:border-primary"
              />
            </div>

            <div className="max-h-64 space-y-1 overflow-y-auto rounded-xl border border-glass-border bg-surface-inset p-2">
              {isLoadingProjects ? (
                <div className="flex items-center justify-center gap-2 py-10 text-sm text-text-muted">
                  <Loader2 size={16} className="animate-spin" />
                  {t('standalone.loadingProjects')}
                </div>
              ) : filteredProjects.length > 0 ? (
                filteredProjects.map((project) => (
                  <button
                    key={project.id}
                    type="button"
                    onClick={() => {
                      rememberLastProject(project.id);
                      setSelectedProjectId(project.id);
                    }}
                    className="flex w-full items-center gap-3 rounded-lg border border-transparent px-3 py-3 text-left transition-colors hover:border-primary/30 hover:bg-primary/10"
                  >
                    <FolderOpen size={16} className="shrink-0 text-primary" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-foreground">{project.title}</span>
                      <span className="mt-0.5 block text-xs text-text-muted">
                        {t('standalone.projectStats', { scenes: project.scenes?.length || 0, characters: project.characters?.length || 0 })}
                      </span>
                    </span>
                  </button>
                ))
              ) : (
                <p className="py-10 text-center text-sm text-text-muted">
                  {searchQuery ? t('standalone.noMatchingProjects') : t('standalone.noProjects')}
                </p>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-glass-border bg-glass p-4">
            <h2 className="text-sm font-medium text-foreground">{t('standalone.createProject')}</h2>
            <p className="mt-1 text-xs leading-5 text-text-muted">{t('standalone.createDescription')}</p>
            <label className="mt-4 block text-xs text-text-secondary" htmlFor="standalone-project-title">
              {t('standalone.projectTitle')}
            </label>
            <input
              id="standalone-project-title"
              value={newProjectTitle}
              onChange={(event) => setNewProjectTitle(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') void handleCreateProject(); }}
              placeholder={t('standalone.projectTitlePlaceholder')}
              className="mt-2 w-full rounded-lg border border-glass-border bg-input-bg px-3 py-2.5 text-sm text-foreground outline-none transition-colors placeholder:text-text-muted focus:border-primary"
            />
            <button
              type="button"
              onClick={() => void handleCreateProject()}
              disabled={!newProjectTitle.trim() || isCreating}
              className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2.5 text-sm font-medium text-on-accent transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isCreating ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
              {isCreating ? t('standalone.creatingProject') : t('standalone.createAndOpen')}
            </button>
          </div>
        </div>

        {loadError && (
          <div role="alert" className="mt-5 flex items-start gap-2 rounded-lg border border-status-failed-border bg-status-failed-bg px-3 py-2.5 text-xs text-status-failed-fg">
            <AlertCircle size={15} className="mt-0.5 shrink-0 text-status-failed-fg" />
            <span>{t('standalone.loadError', { message: loadError })}</span>
          </div>
        )}
      </section>
    </main>
  );
}
