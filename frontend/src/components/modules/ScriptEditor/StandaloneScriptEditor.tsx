'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, ArrowLeft, FolderOpen, Plus, RefreshCw } from 'lucide-react';
import { Button, IconButton, LoadingState, TextField } from '@omnistudio/ui';
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

  const requestRef = useRef(0);

  const loadProjects = async (reopenLast = false) => {
    const request = ++requestRef.current;
    setIsLoadingProjects(true);
    setLoadError(null);
    try {
      const latestProjects = await api.getProjects();
      if (request !== requestRef.current) return;
      setProjects(latestProjects);
      try {
        const lastProjectId = window.localStorage.getItem(LAST_PROJECT_STORAGE_KEY);
        if (reopenLast && lastProjectId && latestProjects.some((project) => project.id === lastProjectId)) {
          setSelectedProjectId(lastProjectId);
        }
      } catch {
        // Keep the picker usable when local storage is unavailable.
      }
    } catch (error) {
      if (request === requestRef.current) setLoadError(error instanceof Error ? error.message : t('standalone.loadProjectsFailed'));
    } finally {
      if (request === requestRef.current) setIsLoadingProjects(false);
    }
  };

  useEffect(() => {
    void loadProjects(true);
    return () => { requestRef.current += 1; };
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
    <div className="flex h-full min-h-0 w-full flex-col bg-background text-foreground">
      <header className="flex min-h-20 shrink-0 items-center justify-between gap-4 border-b border-border-subtle px-4 py-4 sm:px-8">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold">{t('shell.title')}</h1>
          <p className="mt-1 text-sm text-text-muted">{t('standalone.emptyDescription')}</p>
        </div>
        <IconButton aria-label={t('standalone.backToWorkspace')} isDisabled={isCreating} onPress={() => { window.location.hash = '#/workspace'; }}>
          <ArrowLeft size={18} />
        </IconButton>
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto px-4 py-8 sm:px-8">
        <div className="mx-auto grid w-full max-w-6xl gap-10 lg:grid-cols-[minmax(0,1.6fr)_minmax(260px,1fr)]">
          <section className="min-w-0" aria-label={t('standalone.selectProject')}>
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-lg font-medium">{t('standalone.selectProject')}</h2>
              <IconButton aria-label={t('standalone.refreshProjects')} onPress={() => void loadProjects()} isDisabled={isLoadingProjects || isCreating}>
                <RefreshCw size={16} className={isLoadingProjects ? 'animate-spin' : ''} />
              </IconButton>
            </div>
            <TextField label={t('standalone.searchProjects')} type="search" value={searchQuery} onChange={setSearchQuery} placeholder={t('standalone.searchProjects')} className="mb-4 [&_label]:sr-only" />
            {isLoadingProjects && <LoadingState label={t('standalone.loadingProjects')} />}
            <div className="divide-y divide-border-subtle border-y border-border-subtle">
              {filteredProjects.map(project => (
                <Button key={project.id} variant="quiet" isDisabled={isCreating} className="h-auto w-full justify-start gap-3 rounded-none px-2 py-4 text-left whitespace-normal" onPress={() => {
                  rememberLastProject(project.id);
                  setSelectedProjectId(project.id);
                }}>
                  <FolderOpen size={18} className="shrink-0 text-primary" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{project.title}</span>
                    <span className="mt-1 block text-xs font-normal text-text-muted">{t('standalone.projectStats', { scenes: project.scenes?.length || 0, characters: project.characters?.length || 0 })}</span>
                  </span>
                </Button>
              ))}
              {!isLoadingProjects && filteredProjects.length === 0 && <p className="py-10 text-sm text-text-muted">{searchQuery ? t('standalone.noMatchingProjects') : t('standalone.noProjects')}</p>}
            </div>
          </section>
          <form className="min-w-0 border-t border-border-subtle pt-6 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-8" onSubmit={event => { event.preventDefault(); void handleCreateProject(); }}>
            <h2 className="text-lg font-medium">{t('standalone.createProject')}</h2>
            <p className="mt-2 mb-6 text-sm leading-6 text-text-muted">{t('standalone.createDescription')}</p>
            <TextField label={t('standalone.projectTitle')} value={newProjectTitle} onChange={setNewProjectTitle} isDisabled={isCreating} placeholder={t('standalone.projectTitlePlaceholder')} />
            <Button type="submit" className="mt-4 w-full" isDisabled={!newProjectTitle.trim() || isCreating} isPending={isCreating}>
              <Plus size={16} />
              {isCreating ? t('standalone.creatingProject') : t('standalone.createAndOpen')}
            </Button>
          </form>
          {loadError && <div role="alert" className="flex items-start gap-2 text-sm text-status-failed-fg lg:col-span-2"><AlertCircle size={16} className="mt-0.5 shrink-0" /><span>{loadError}</span></div>}
        </div>
      </main>
    </div>
  );
}
