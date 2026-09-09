'use client';

import { useCallback, useEffect, useState } from 'react';
import { ActionMenu, Button, Dialog, IconButton } from '@omnistudio/ui';
import { useTranslations } from 'next-intl';
import { EditorContent } from '@tiptap/react';
import type { JSONContent } from '@tiptap/core';
import { AlertTriangle, ArrowLeft, BookOpen, Loader2, Minimize2, PanelLeftOpen, PanelRightOpen, WifiOff, RotateCcw, X, MoreHorizontal, Upload, Download, History, Save, Keyboard } from 'lucide-react';
import { useEditorStore } from '@/store/editorStore';
import type { Project } from '@/store/projectStore';
import { api } from '@/lib/api';
import { scriptEditorApi, type SourceDependency, type StaleTarget } from '@/lib/scriptEditorApi';
import { documentFromOriginalText, shouldUseOriginalText } from './scriptEditorContent';
import { useEditorSetup } from './hooks/useEditorSetup';
import { useAutoSave } from './hooks/useAutoSave';
import { useDerivation } from './hooks/useDerivation';
import FormatToolbar from './toolbar/FormatToolbar';
import { usePasteHandler } from './hooks/usePasteHandler';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useContinuityCheck } from './hooks/useContinuityCheck';
import { useSceneFolding } from './hooks/useSceneFolding';
import { useViewMode } from './hooks/useViewMode';
import { useOfflineCache } from './hooks/useOfflineCache';
import { useL3Completion } from './hooks/useL3Completion';
import { PasteHintBar } from './components/PasteHintBar';
import { ShortcutHelpPanel } from './components/ShortcutHelpPanel';
import { ContinuityIndicator } from './components/ContinuityIndicator';
import RightPanelContainer from './panels';
import LeftSidebar, { type SidebarTab } from './sidebar';
import StoryboardView from './views/StoryboardView';
import ImportDialog from './dialogs/ImportDialog';
import ExportDialog from './dialogs/ExportDialog';
import SnapshotListDialog from './dialogs/SnapshotListDialog';

export interface ScriptEditorShellProps {
  mode?: 'full' | 'embedded' | 'focus';
  projectId?: string;
  projectTitle?: string;
  onChangeProject?: () => void;
  initialContent?: string | Record<string, unknown> | null;
}

export default function ScriptEditorShell({
  mode = 'full',
  projectId,
  projectTitle,
  onChangeProject,
  initialContent,
}: ScriptEditorShellProps) {
  const t = useTranslations('scriptEditor');
  const tc = useTranslations('common');
  const [wide, setWide] = useState(false);
  const [serverDocument, setServerDocument] = useState<object | null>(null);
  const [serverUpdatedAt, setServerUpdatedAt] = useState(0);
  const [sourceDependencies, setSourceDependencies] = useState<SourceDependency[]>([]);
  const [sourceStale, setSourceStale] = useState(false);
  const [sourceStaleTargets, setSourceStaleTargets] = useState<StaleTarget[]>([]);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('scenes');
  const [mobilePanel, setMobilePanel] = useState<'left' | 'right' | null>(null);
  const [dialog, setDialog] = useState<'import' | 'export' | 'snapshots' | 'leave' | null>(null);
  useEffect(() => {
    const media = window.matchMedia('(min-width: 1280px)');
    const update = () => { setWide(media.matches); setMobilePanel(null); };
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  const { editor, isReady } = useEditorSetup({ content: initialContent });
  const { showHint, analysis, applyFormatting, dismissHint } = usePasteHandler(editor);
  const { showShortcutHelp, closeShortcutHelp, toggleShortcutHelp } = useKeyboardShortcuts(editor);
  const continuityReport = useContinuityCheck(editor);
  const { enabled: foldingEnabled, isAllExpanded } = useSceneFolding(editor);
  const { mode: viewMode, setMode: setViewMode, isReadOnly, showToolbar, showSidebars } = useViewMode();
  const { hasNewerLocal, restoreFromLocal, dismissLocalRestore, isOffline, saveToLocal } = useOfflineCache(projectId, editor, serverDocument, serverUpdatedAt);
  const { save, isSaving, saveError } = useAutoSave(editor, projectId ?? null, saveToLocal);
  const { runDerivation } = useDerivation(editor);
  useL3Completion(editor, projectId ?? null);
  const [documentState, setDocumentState] = useState<'loading' | 'ready' | 'error'>(projectId ? 'loading' : 'ready');
  const [documentError, setDocumentError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [projectData, setProjectData] = useState<Project | null>(null);

  useEffect(() => {
    const store = useEditorStore.getState();
    store.setProjectId(projectId ?? null);
    store.setDirty(false);
    store.setLastSavedAt(null);
    store.setLoading(Boolean(projectId));
    store.updateDerivation({
      scenes: [],
      characters: [],
      duration: 0,
      wordCount: 0,
      confidenceScore: 0,
    });
    setProjectData(null);
    setServerDocument(null);
    setServerUpdatedAt(0);
    setSourceDependencies([]);
    setSourceStale(false);
    setSourceStaleTargets([]);

    if (!projectId) {
      setDocumentState('ready');
      setDocumentError(null);
      editor?.setEditable(true, false);
      return;
    }

    if (!editor) {
      setDocumentState('loading');
      return;
    }

    let cancelled = false;
    setDocumentState('loading');
    setDocumentError(null);
    editor.setEditable(false, false);

    const load = async () => {
      try {
        const [projectResult, documentResult] = await Promise.allSettled([
          api.getProject(projectId),
          scriptEditorApi.loadDocument(projectId),
        ]);
        const project = projectResult.status === 'fulfilled'
          ? projectResult.value as Project
          : null;
        if (cancelled) return;
        if (project) setProjectData(project);
        if (documentResult.status === 'rejected') {
          throw documentResult.reason;
        }
        const response = documentResult.value;
        if (cancelled) return;

        const rawResponse = response as unknown as Record<string, unknown>;
        const responseContent = rawResponse?.content;
        const loadedContent = responseContent && typeof responseContent === 'object' && !Array.isArray(responseContent)
          ? responseContent
          : response;
        const fallbackContent: string | JSONContent = typeof initialContent === 'string'
          ? initialContent
          : (initialContent as JSONContent | null) || { type: 'doc', content: [] };
        const loadedRecord = loadedContent && typeof loadedContent === 'object' && !Array.isArray(loadedContent)
          ? loadedContent as Record<string, unknown>
          : null;
        const persistedContent: string | JSONContent = loadedRecord && typeof loadedRecord.type === 'string'
          ? loadedRecord as JSONContent
          : fallbackContent;
        const originalText = project?.originalText || '';
        const content: string | JSONContent = originalText && shouldUseOriginalText(persistedContent, originalText)
          ? documentFromOriginalText(originalText)
          : persistedContent;

        editor.commands.setContent(content, { emitUpdate: false });
        setServerDocument(editor.getJSON());
        setServerUpdatedAt(Date.parse(String(rawResponse.updated_at || '')) || 0);
        setSourceDependencies(Array.isArray(rawResponse.source_dependencies) ? rawResponse.source_dependencies as SourceDependency[] : []);
        setSourceStale(rawResponse.stale === true);
        setSourceStaleTargets(Array.isArray(rawResponse.stale_targets) ? rawResponse.stale_targets as StaleTarget[] : []);
        runDerivation();
        editor.setEditable(true, false);
        store.setDirty(false);
        store.setLoading(false);
        setDocumentState('ready');
      } catch (error) {
        if (cancelled) return;
        editor.setEditable(false, false);
        store.setLoading(false);
        setDocumentError(error instanceof Error ? error.message : t('shell.loadDocumentFailed'));
        setDocumentState('error');
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [editor, initialContent, loadAttempt, projectId, runDerivation, t]);

  const isDirty = useEditorStore((s) => s.isDirty);
  const lastSavedAt = useEditorStore((s) => s.lastSavedAt);
  const wordCount = useEditorStore((s) => s.wordCount);
  const derivedScenes = useEditorStore((s) => s.derivedScenes);
  const currentFormat = useEditorStore((s) => s.currentFormat);
  const currentRendering = useEditorStore((s) => s.currentRendering);
  const leftCollapsed = useEditorStore((s) => s.leftSidebarCollapsed);
  const rightCollapsed = useEditorStore((s) => s.rightSidebarCollapsed);
  const toggleLeft = useEditorStore((s) => s.toggleLeftSidebar);
  const toggleRight = useEditorStore((s) => s.toggleRightSidebar);

  const showLeft = mode === 'full' && !leftCollapsed && showSidebars;
  const showRight = mode === 'full' && !rightCollapsed && showSidebars;
  const hideAllSidebars = mode === 'focus' || viewMode === 'focus';
  const hideLeftOnly = mode === 'embedded';
  const ready = documentState === 'ready';
  useEffect(() => { editor?.setEditable(ready && !isReadOnly, false); }, [editor, ready, isReadOnly]);

  useEffect(() => {
    const openSearch = () => {
      if (mode !== 'full') return;
      setViewMode('edit');
      setSidebarTab('search');
      if (wide && leftCollapsed) toggleLeft();
      if (!wide) setMobilePanel('left');
    };
    document.addEventListener('script-editor:focus-search', openSearch);
    return () => document.removeEventListener('script-editor:focus-search', openSearch);
  }, [mode, wide, leftCollapsed, toggleLeft, setViewMode]);

  const applyDocument = (content: JSONContent, persisted = false) => {
    editor?.commands.setContent(content, { emitUpdate: !persisted });
    runDerivation();
    useEditorStore.getState().setDirty(!persisted);
    if (persisted) {
      useEditorStore.getState().setLastSavedAt(new Date());
      setServerDocument(content);
      setServerUpdatedAt(Date.now());
    }
  };
  const changeProject = () => {
    if (isDirty || isSaving) setDialog('leave');
    else onChangeProject?.();
  };
  const statusText = documentState === 'loading'
    ? t('shell.loadingDocument')
    : documentState === 'error'
      ? t('shell.loadDocumentFailed')
      : isSaving
        ? t('shell.saving')
        : saveError
          ? t('shell.saveFailed', { message: saveError })
          : isDirty
            ? t('status.unsaved')
            : lastSavedAt
              ? t('status.savedAt', { time: lastSavedAt.toLocaleTimeString() })
              : projectId
                ? t('status.ready')
                : t('shell.unbound');

  const handleShotClick = useCallback((shotId: string) => {
    setViewMode('edit');
    if (editor) {
      const { doc } = editor.state;
      let targetPos: number | null = null;
      doc.descendants((node, pos) => {
        if (node.type.name === 'shotBlock' && node.attrs?.id === shotId) {
          targetPos = pos;
          return false;
        }
      });
      if (targetPos !== null) {
        editor.commands.setTextSelection(targetPos);
        editor.commands.scrollIntoView();
      }
    }
  }, [editor, setViewMode]);

  return (
    <div
      data-testid="script-editor-shell"
      className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden bg-background text-foreground"
    >
      {!hideAllSidebars ? (
        <>
          <header className="flex min-h-20 shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border-subtle px-4 py-3 sm:px-6">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              {onChangeProject && <IconButton aria-label={t('shell.changeProject')} onPress={changeProject}><ArrowLeft size={18} /></IconButton>}
              <div className="min-w-0">
                <p className="mb-1 text-xs text-text-muted">{t('shell.title')}</p>
                <h1 className="truncate text-lg font-semibold">{projectTitle || projectData?.title || t('shell.title')}</h1>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {viewMode === 'read' && <Button variant="secondary" onPress={() => setViewMode('edit')}>{t('views.edit')}</Button>}
              <Button isDisabled={!ready || isSaving} isPending={isSaving} onPress={() => void save(true)}><Save size={16} />{t('toolbar.save')}</Button>
              <ActionMenu label={t('toolbar.actions')} icon={<MoreHorizontal size={18} />} items={[
                { id: 'import', label: t('dialogs.import.title'), icon: <Upload size={16} />, isDisabled: !ready || isSaving, onAction: () => setDialog('import') },
                { id: 'export', label: t('toolbar.export'), icon: <Download size={16} />, isDisabled: !ready, onAction: () => setDialog('export') },
                { id: 'snapshots', label: t('snapshots.title'), icon: <History size={16} />, isDisabled: !ready || isSaving, onAction: () => setDialog('snapshots') },
                { id: 'shortcuts', label: t('shortcuts.title'), icon: <Keyboard size={16} />, onAction: toggleShortcutHelp },
              ]} />
            </div>
          </header>
          {showToolbar && <FormatToolbar editor={editor} viewMode={viewMode} onViewModeChange={setViewMode} />}
          <div className="flex shrink-0 items-center gap-2 border-b border-border-subtle px-4 py-2">
            {mode === 'full' && <IconButton aria-label={t('shell.outline')} aria-pressed={wide ? showLeft : mobilePanel === 'left'} onPress={() => wide ? toggleLeft() : setMobilePanel('left')}><PanelLeftOpen size={16} /></IconButton>}
            <p role={saveError ? 'alert' : undefined} aria-live="polite" className={`min-w-0 flex-1 text-xs ${saveError || documentState === 'error' ? 'text-status-failed-fg' : 'text-text-muted'}`}>{statusText}</p>
            <IconButton aria-label={t('shell.inspector')} aria-pressed={wide ? showRight : mobilePanel === 'right'} onPress={() => wide ? toggleRight() : setMobilePanel('right')}><PanelRightOpen size={16} /></IconButton>
          </div>
          {sourceStale && <div data-testid="script-source-stale" className="flex shrink-0 items-start gap-3 border-b border-status-warning-border bg-status-warning-bg px-4 py-3 text-sm text-status-warning-fg sm:px-6">
            <AlertTriangle size={17} className="mt-0.5 shrink-0" aria-hidden="true" />
            <div className="min-w-0">
              <p className="font-medium">{t('source.staleTitle')}</p>
              <p className="mt-1 leading-5">{t('source.staleBanner')} {sourceDependencies.map(item => `${item.source_title} · ${item.chapter_title} · v${item.revision_number}`).join('、')}</p>
              {sourceStaleTargets.length > 0 && <p className="mt-1 text-xs opacity-80">{t('source.staleTargets', { count: sourceStaleTargets.length })}</p>}
            </div>
          </div>}
        </>
      ) : <div className="flex shrink-0 items-center justify-end gap-3 border-b border-border-subtle px-4 py-2"><span className="text-xs text-text-muted">{t('views.exitFocusHint')}</span><Button variant="quiet" onPress={() => setViewMode('edit')} aria-label={t('views.exitFocus')}><Minimize2 size={16} />{t('views.exitFocus')}</Button></div>}

      {/* Main content area: Three-column layout */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Left Sidebar */}
        {!hideAllSidebars && !hideLeftOnly && wide && showLeft && (
          <aside className="w-[220px] shrink-0 border-r border-border-subtle bg-surface-inset overflow-hidden">
            <LeftSidebar editor={editor} tab={sidebarTab} onTabChange={setSidebarTab} onNavigate={() => setMobilePanel(null)} />
          </aside>
        )}

        {/* Editor Content Area / Storyboard View */}
        {viewMode === 'storyboard' ? (
          <main className="relative flex-1 min-w-0 overflow-hidden">
            <StoryboardView editor={editor} onShotClick={handleShotClick} />
          </main>
        ) : (
          <main aria-busy={documentState === 'loading'} className={`relative flex-1 min-w-0 overflow-y-auto ${
            viewMode === 'focus' ? 'flex items-start justify-center' : ''
          }`}>
            {/* Offline / local restore banner */}
            {isOffline && (
              <div className="sticky top-0 z-10 flex items-center gap-2 bg-status-warning-bg px-4 py-2 text-xs text-status-warning-fg border-b border-status-warning-border">
                <WifiOff size={14} />
                <span>{t('status.offlineBanner')}</span>
              </div>
            )}
            {hasNewerLocal && (
              <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 border-b border-primary/25 bg-primary/10 px-4 py-2 text-xs text-primary">
                <div className="flex items-center gap-2">
                  <RotateCcw size={14} />
                  <span>{t('status.localCacheFound')}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    onPress={restoreFromLocal}
                    className="rounded bg-primary px-2.5 py-1 text-xs font-medium text-on-accent transition-colors hover:bg-primary-hover"
                  >
                    {t('status.restore')}
                  </Button>
                  <IconButton
                    onPress={dismissLocalRestore}
                    aria-label={t('status.dismissLocalCache')}
                    className="rounded p-1 text-primary/70 transition-colors hover:bg-primary/10 hover:text-primary"
                  >
                    <X size={14} />
                  </IconButton>
                </div>
              </div>
            )}
            {/* Paste Hint Bar */}
            <PasteHintBar
              visible={showHint}
              analysis={analysis}
              onApply={applyFormatting}
              onDismiss={dismissHint}
            />
            <div
              className={`script-editor script-editor-content mx-auto w-full min-w-0 px-4 py-8 sm:px-8 sm:py-10 ${
                viewMode === 'focus' ? 'max-w-[860px]' : 'max-w-[720px]'
              }`}
              data-format={currentFormat}
              data-rendering={currentRendering}
            >
              {isReady ? (
                <div className="relative min-h-[60vh]">
                  <EditorContent
                    editor={editor}
                    className={`w-full min-w-0 prose max-w-none text-foreground focus:outline-none min-h-[60vh] ${
                      documentState !== 'ready' ? 'pointer-events-none opacity-60' : ''
                    }`}
                  />
                  {documentState === 'loading' && (
                    <div role="status" className="absolute inset-0 flex items-center justify-center bg-overlay">
                      <div className="flex items-center gap-2 rounded-lg border border-glass-border bg-surface px-4 py-3 text-sm text-foreground shadow-xl">
                        <Loader2 size={16} className="animate-spin" />
                        {t('shell.loadingDocument')}
                      </div>
                    </div>
                  )}
                  {documentState === 'error' && (
                    <div role="alert" className="absolute inset-0 flex items-center justify-center bg-overlay px-6">
                      <div className="max-w-sm rounded-xl border border-status-failed-border bg-surface p-5 text-center shadow-xl">
                        <p className="text-sm font-medium text-status-failed-fg">{t('shell.loadDocumentFailed')}</p>
                        <p className="mt-2 break-words text-xs leading-5 text-text-muted">{documentError}</p>
                        <Button
                          onPress={() => setLoadAttempt((attempt) => attempt + 1)}
                          className="mt-4"
                        >
                          {t('shell.retryLoadDocument')}
                        </Button>
                      </div>
                    </div>
                  )}
                  {documentState === 'ready' && editor?.isEmpty && (
                    <div className="pointer-events-none absolute inset-x-0 top-24 flex justify-center px-6">
                      <div className="flex max-w-sm items-start gap-3 px-4 py-3 text-left">
                        <BookOpen size={17} className="mt-0.5 shrink-0 text-primary" />
                        <div>
                          <p className="text-sm font-medium text-foreground">{t('shell.emptyDocument')}</p>
                          <p className="mt-1 text-xs leading-5 text-text-muted">{t('shell.emptyDocumentHint')}</p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex items-center justify-center h-40 text-text-muted text-sm">
                  {t('shell.loading')}
                </div>
              )}
            </div>
          </main>
        )}

        {/* Right Sidebar - Panel */}
        {!hideAllSidebars && wide && (showRight || (mode === 'embedded' && !rightCollapsed)) && (
          <aside className="w-[300px] shrink-0 border-l border-border-subtle bg-surface overflow-hidden">
            <RightPanelContainer
              editor={editor}
              mode={mode}
              projectId={projectId}
              project={projectData}
            />
          </aside>
        )}
      </div>

      {/* Status Bar */}
      {!hideAllSidebars && showToolbar && (
        <div className="flex min-h-9 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-border-subtle px-4 py-2 text-xs text-text-muted">
          <span>{t('status.wordCount', { count: wordCount })}</span>
          <span className="text-text-muted">|</span>
          <span>
            {t('status.sceneCount', { count: derivedScenes.length })}
            {foldingEnabled && (
              <span className="ml-1 text-text-muted/60">
                ({isAllExpanded ? t('status.allExpanded') : t('status.smartFolding')})
              </span>
            )}
          </span>
          <span className="text-text-muted">|</span>
          <span>
            {isOffline
              ? t('status.offlineShort')
              : isDirty
                ? t('status.unsavedDot')
                : lastSavedAt
                  ? t('status.savedAt', { time: lastSavedAt.toLocaleTimeString() })
                  : t('status.ready')}
          </span>
          <span className="text-text-muted">|</span>
          <ContinuityIndicator report={continuityReport} />
          <span className="ml-auto text-text-muted/60">
            {t(`formats.${currentFormat}`)} · {t(`renderings.${currentRendering}`)}
          </span>
        </div>
      )}

      {mobilePanel && <Dialog isOpen onOpenChange={open => { if (!open) setMobilePanel(null); }} title={t(mobilePanel === 'left' ? 'shell.outline' : 'shell.inspector')} closeLabel={tc('close')} className="max-w-lg">
        <div className="h-[min(60dvh,600px)] min-h-0">{mobilePanel === 'left' ? <LeftSidebar editor={editor} tab={sidebarTab} onTabChange={setSidebarTab} onNavigate={() => setMobilePanel(null)} /> : <RightPanelContainer editor={editor} mode={mode} projectId={projectId} project={projectData} />}</div>
      </Dialog>}
      {projectId && dialog === 'import' && <ImportDialog open onClose={() => setDialog(null)} projectId={projectId} onImportSuccess={applyDocument} />}
      {projectId && dialog === 'export' && <ExportDialog open onClose={() => setDialog(null)} projectId={projectId} editor={editor} />}
      {projectId && dialog === 'snapshots' && <SnapshotListDialog open onClose={() => setDialog(null)} projectId={projectId} onRestore={content => applyDocument(content, true)} />}
      <Dialog isOpen={dialog === 'leave'} onOpenChange={open => { if (!open) setDialog(null); }} isDismissable={!isSaving} title={t('shell.unsavedTitle')} closeLabel={tc('close')} footer={<><Button variant="quiet" isDisabled={isSaving} onPress={() => setDialog(null)}>{tc('cancel')}</Button><Button variant="secondary" isDisabled={isSaving} onPress={() => { setDialog(null); onChangeProject?.(); }}>{t('shell.discardAndLeave')}</Button><Button isPending={isSaving} isDisabled={isSaving} onPress={async () => { if (await save(false)) { setDialog(null); onChangeProject?.(); } }}>{t('shell.saveAndLeave')}</Button></>}>
        <p className="text-sm text-text-secondary">{t('shell.unsavedHint')}</p>
        {saveError && <p role="alert" className="mt-3 text-sm text-status-failed-fg">{statusText}</p>}
      </Dialog>
      {/* Shortcut Help Panel */}
      <ShortcutHelpPanel open={showShortcutHelp} onClose={closeShortcutHelp} />
    </div>
  );
}
