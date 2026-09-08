import { useEffect, useRef, useCallback, useState } from 'react';
import { Editor } from '@tiptap/react';
import { scriptEditorApi } from '@/lib/scriptEditorApi';
import { useEditorStore } from '@/store/editorStore';

const AUTOSAVE_INTERVAL_MS = 30_000; // 30 seconds

/**
 * 自动保存 Hook
 * - 30s 周期自动保存（仅当 isDirty 时）
 * - Cmd+S / Ctrl+S 手动保存 + 创建快照
 * - beforeunload 事件拦截（离开页面前提醒保存）
 */
export function useAutoSave(
  editor: Editor | null,
  projectId: string | null,
  saveToLocal?: (content: object, wordCount: number) => Promise<void> | void,
) {
  const { setDirty, setLastSavedAt } = useEditorStore();
  const isSavingRef = useRef(false);
  const contextRef = useRef(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    contextRef.current += 1;
    isSavingRef.current = false;
    setIsSaving(false);
    setSaveError(null);
    return () => { contextRef.current += 1; };
  }, [editor, projectId]);

  // 核心保存逻辑
  const save = useCallback(
    async (createSnapshot = false) => {
      const store = useEditorStore.getState();
      if (!editor || editor.isDestroyed || !projectId || store.isLoading || store.projectId !== projectId || isSavingRef.current) return false;

      const context = contextRef.current;
      const savedDocument = editor.state.doc;
      const content = editor.getJSON();
      isSavingRef.current = true;
      setIsSaving(true);
      setSaveError(null);

      try {
        await scriptEditorApi.saveDocument(projectId, content, createSnapshot);
        if (context !== contextRef.current || editor.isDestroyed || useEditorStore.getState().projectId !== projectId) return false;
        const unchanged = editor.state.doc.eq(savedDocument);
        setDirty(!unchanged);
        setLastSavedAt(new Date());
        await saveToLocal?.(editor.getJSON(), editor.getText().length);
        return context === contextRef.current && !editor.isDestroyed && editor.state.doc.eq(savedDocument);
      } catch (err) {
        if (context !== contextRef.current) return false;
        console.error('[useAutoSave] Save failed:', err);
        setSaveError(err instanceof Error ? err.message : 'Save failed');
        return false;
      } finally {
        if (context === contextRef.current) {
          isSavingRef.current = false;
          setIsSaving(false);
        }
      }
    },
    [editor, projectId, saveToLocal, setDirty, setLastSavedAt]
  );

  // 30s 周期自动保存
  useEffect(() => {
    if (!editor || !projectId) return;
    intervalRef.current = setInterval(() => {
      if (useEditorStore.getState().isDirty) {
        save(false);
      }
    }, AUTOSAVE_INTERVAL_MS);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [editor, projectId, save]);

  // Cmd+S / Ctrl+S 手动保存（创建快照）
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        save(true); // 手动保存时创建快照
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [save]);

  // beforeunload 拦截
  useEffect(() => {
    if (!editor || !projectId) return;
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (useEditorStore.getState().isDirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [editor, projectId]);

  return { save, isSaving, saveError };
}
