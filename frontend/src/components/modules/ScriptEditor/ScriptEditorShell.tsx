'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { EditorContent } from '@tiptap/react';
import type { JSONContent } from '@tiptap/core';
import { ArrowLeft, BookOpen, Loader2, Minimize2, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, WifiOff, RotateCcw, X } from 'lucide-react';
import { useEditorStore } from '@/store/editorStore';
import type { Project } from '@/store/projectStore';
import { api } from '@/lib/api';
import { scriptEditorApi } from '@/lib/scriptEditorApi';
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
import LeftSidebar from './sidebar';
import StoryboardView from './views/StoryboardView';

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
  const { editor, isReady } = useEditorSetup({ content: initialContent });
  const { showHint, analysis, applyFormatting, dismissHint } = usePasteHandler(editor);
  const { showShortcutHelp, closeShortcutHelp } = useKeyboardShortcuts(editor);
  const continuityReport = useContinuityCheck(editor);
  const { enabled: foldingEnabled, isAllExpanded, totalScenes: foldingTotal } = useSceneFolding(editor);
  const { mode: viewMode, setMode: setViewMode, isReadOnly, showToolbar, showSidebars } = useViewMode();
  const { hasNewerLocal, restoreFromLocal, dismissLocalRestore, isOffline, saveToLocal } = useOfflineCache(projectId, editor);
  const { isSaving, saveError } = useAutoSave(editor, projectId ?? null, saveToLocal);
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

    if (!projectId) {
      setDocumentState('ready');
      setDocumentError(null);
      editor?.setEditable(true);
      return;
    }

    if (!editor) {
      setDocumentState('loading');
      return;
    }

    let cancelled = false;
    setDocumentState('loading');
    setDocumentError(null);
    editor.setEditable(false);

    const load = async () => {
      try {
        const [projectResult, documentResult] = await Promise.allSettled([
          api.getProject(projectId),
          scriptEditorApi.loadDocument(projectId),
        ]);
        const project = projectResult.status === 'fulfilled'
          ? projectResult.value as Project
          : null;
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
        runDerivation();
        editor.setEditable(true);
        store.setDirty(false);
        store.setLoading(false);
        setDocumentState('ready');
      } catch (error) {
        if (cancelled) return;
        editor.setEditable(false);
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
      className="flex h-full w-full flex-col overflow-hidden bg-background text-foreground"
    >
      {/* Format Toolbar */}
      {!hideAllSidebars && showToolbar && (
        <FormatToolbar editor={editor} viewMode={viewMode} onViewModeChange={setViewMode} />
      )}

      {/* Top Toolbar */}
      {!hideAllSidebars && showToolbar && (
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-glass-border px-4">
          <div className="flex items-center gap-3">
            {onChangeProject && (
              <button
                type="button"
                onClick={onChangeProject}
                className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-text-muted transition-colors hover:bg-white/5 hover:text-foreground"
                aria-label={t('shell.changeProject')}
                title={t('shell.changeProject')}
              >
                <ArrowLeft size={14} />
                {t('shell.changeProject')}
              </button>
            )}
            {mode === 'full' && (
              <button
                type="button"
                onClick={toggleLeft}
                className="text-text-muted hover:text-foreground transition-colors"
                aria-label="Toggle left sidebar"
              >
                {leftCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
              </button>
            )}
            <span className="text-sm font-medium text-foreground">
              {projectTitle || t('shell.title')}
            </span>
            {projectId && !projectTitle && <span className="text-xs text-text-muted">{projectId}</span>}
          </div>
          <div className="flex items-center gap-3">
            <span className={`max-w-[360px] truncate text-xs ${saveError || documentState === 'error' ? 'text-red-300' : 'text-text-muted'}`}>
              {statusText}
            </span>
            {mode === 'full' && (
              <button
                type="button"
                onClick={toggleRight}
                className="text-text-muted hover:text-foreground transition-colors"
                aria-label="Toggle right sidebar"
              >
                {rightCollapsed ? <PanelRightOpen size={16} /> : <PanelRightClose size={16} />}
              </button>
            )}
          </div>
        </div>
      )}

      {hideAllSidebars && (
        <div className="fixed right-4 top-4 z-40 flex items-center gap-2 rounded-lg border border-glass-border bg-surface/95 px-2 py-1.5 text-xs text-text-muted shadow-lg backdrop-blur-xl">
          <button
            type="button"
            onClick={() => setViewMode('edit')}
            aria-label={t('views.exitFocus')}
            title={t('views.exitFocus')}
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 font-medium text-foreground transition-colors hover:bg-hover-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
          >
            <Minimize2 size={14} aria-hidden="true" />
            <span>{t('views.exitFocus')}</span>
          </button>
          <span aria-hidden="true" className="h-4 w-px bg-glass-border" />
          <span className="pr-1 whitespace-nowrap">{t('views.exitFocusHint')}</span>
        </div>
      )}

      {/* Main content area: Three-column layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Sidebar */}
        {!hideAllSidebars && !hideLeftOnly && showLeft && (
          <aside className="w-[260px] shrink-0 border-r border-glass-border bg-glass backdrop-blur-xl overflow-hidden">
            <LeftSidebar editor={editor} />
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
              <div className="sticky top-0 z-10 flex items-center gap-2 bg-amber-900/30 px-4 py-2 text-xs text-amber-200 border-b border-amber-700/30">
                <WifiOff size={14} />
                <span>{t('status.offlineBanner')}</span>
              </div>
            )}
            {hasNewerLocal && (
              <div className="sticky top-0 z-10 flex items-center justify-between border-b border-primary/25 bg-primary/10 px-4 py-2 text-xs text-primary">
                <div className="flex items-center gap-2">
                  <RotateCcw size={14} />
                  <span>{t('status.localCacheFound')}</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={restoreFromLocal}
                    className="rounded bg-primary px-2.5 py-1 text-xs font-medium text-on-accent transition-colors hover:bg-primary-hover"
                  >
                    {t('status.restore')}
                  </button>
                  <button
                    type="button"
                    onClick={dismissLocalRestore}
                    aria-label={t('status.dismissLocalCache')}
                    title={t('status.dismissLocalCache')}
                    className="rounded p-1 text-primary/70 transition-colors hover:bg-primary/10 hover:text-primary"
                  >
                    <X size={14} />
                  </button>
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
              className={`script-editor script-editor-content mx-auto w-full min-w-0 px-8 py-10 ${
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
                      isReadOnly || documentState !== 'ready' ? 'pointer-events-none opacity-60' : ''
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
                        <button
                          type="button"
                          onClick={() => setLoadAttempt((attempt) => attempt + 1)}
                          className="mt-4 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-indigo-500"
                        >
                          {t('shell.retryLoadDocument')}
                        </button>
                      </div>
                    </div>
                  )}
                  {documentState === 'ready' && editor?.isEmpty && (
                    <div className="pointer-events-none absolute inset-x-0 top-24 flex justify-center px-6">
                      <div className="flex max-w-sm items-start gap-3 rounded-xl border border-glass-border bg-surface px-4 py-3 text-left shadow-lg">
                        <BookOpen size={17} className="mt-0.5 shrink-0 text-indigo-300" />
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
        {!hideAllSidebars && (showRight || mode === 'embedded') && (
          <aside className="w-[320px] shrink-0 border-l border-glass-border bg-glass backdrop-blur-xl overflow-hidden">
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
        <div className="flex h-8 shrink-0 items-center gap-4 border-t border-glass-border px-4 text-xs text-text-muted">
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
            {currentFormat} / {currentRendering}
          </span>
        </div>
      )}

      {/* Shortcut Help Panel */}
      <ShortcutHelpPanel open={showShortcutHelp} onClose={closeShortcutHelp} />
    </div>
  );
}
