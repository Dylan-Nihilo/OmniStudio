'use client';

import { EditorContent } from '@tiptap/react';
import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from 'lucide-react';
import { useEditorStore } from '@/store/editorStore';
import { useEditorSetup } from './hooks/useEditorSetup';

export interface ScriptEditorShellProps {
  mode?: 'full' | 'embedded' | 'focus';
  projectId?: string;
  initialContent?: string | Record<string, unknown> | null;
}

export default function ScriptEditorShell({
  mode = 'full',
  projectId,
  initialContent,
}: ScriptEditorShellProps) {
  const { editor, isReady } = useEditorSetup({ content: initialContent });

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

  const showLeft = mode === 'full' && !leftCollapsed;
  const showRight = mode === 'full' && !rightCollapsed;
  const hideAllSidebars = mode === 'focus';
  const hideLeftOnly = mode === 'embedded';

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-[#050508]">
      {/* Top Toolbar */}
      {!hideAllSidebars && (
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-white/10 px-4">
          <div className="flex items-center gap-3">
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
              剧本编辑器
            </span>
            {projectId && (
              <span className="text-xs text-text-muted">{projectId}</span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-text-muted">
              {isDirty ? '未保存' : lastSavedAt ? `已保存 ${lastSavedAt.toLocaleTimeString()}` : ''}
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

      {/* Main content area: Three-column layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Sidebar - Scene Navigation */}
        {!hideAllSidebars && !hideLeftOnly && showLeft && (
          <aside className="w-[260px] shrink-0 border-r border-white/10 bg-white/[0.02] backdrop-blur-xl overflow-y-auto">
            <div className="p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-3">
                场景导航
              </h3>
              {derivedScenes.length > 0 ? (
                <ul className="space-y-1">
                  {derivedScenes.map((scene) => (
                    <li
                      key={scene.id}
                      className="text-sm text-text-secondary hover:text-foreground cursor-pointer px-2 py-1.5 rounded hover:bg-white/5 transition-colors"
                    >
                      {scene.title || `场景 ${scene.number ?? '?'}`}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-text-muted italic">暂无场景</p>
              )}
            </div>
          </aside>
        )}

        {/* Editor Content Area */}
        <main className="flex-1 min-w-0 overflow-y-auto">
          <div
            className="script-editor-content mx-auto max-w-[720px] px-8 py-10"
            data-format={currentFormat}
            data-rendering={currentRendering}
          >
            {isReady ? (
              <EditorContent
                editor={editor}
                className="prose prose-invert max-w-none focus:outline-none min-h-[60vh]"
              />
            ) : (
              <div className="flex items-center justify-center h-40 text-text-muted text-sm">
                编辑器加载中...
              </div>
            )}
          </div>
        </main>

        {/* Right Sidebar - Panel */}
        {!hideAllSidebars && showRight && (
          <aside className="w-[320px] shrink-0 border-l border-white/10 bg-white/[0.02] backdrop-blur-xl overflow-y-auto">
            <div className="p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-3">
                面板
              </h3>
              <p className="text-xs text-text-muted italic">
                选中编辑器内容以查看相关面板
              </p>
            </div>
          </aside>
        )}
      </div>

      {/* Status Bar */}
      {!hideAllSidebars && (
        <div className="flex h-8 shrink-0 items-center gap-4 border-t border-white/10 px-4 text-xs text-text-muted">
          <span>{wordCount} 字</span>
          <span className="text-white/20">|</span>
          <span>{derivedScenes.length} 个场景</span>
          <span className="text-white/20">|</span>
          <span>
            {isDirty
              ? '● 未保存'
              : lastSavedAt
                ? `已保存 ${lastSavedAt.toLocaleTimeString()}`
                : '就绪'}
          </span>
          <span className="ml-auto text-text-muted/60">
            {currentFormat} / {currentRendering}
          </span>
        </div>
      )}
    </div>
  );
}
