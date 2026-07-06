import { useEffect, useCallback, useState } from 'react';
import { Editor } from '@tiptap/react';
import { useEditorStore } from '@/store/editorStore';

/**
 * 全局快捷键注册 Hook
 *
 * 已在其他地方实现的快捷键（不重复注册）：
 * - Tab/Shift+Tab (Keymap extension)
 * - Cmd+S (useAutoSave)
 * - Cmd+Enter (Keymap extension)
 * - Cmd+Z/Cmd+Shift+Z (Tiptap History)
 * - Enter (Keymap extension)
 *
 * 本 Hook 新增注册：
 * - Cmd+Shift+E: 切换场景折叠/展开（Phase 1.4 实现，此处占位 console.log）
 * - Cmd+Shift+F: 聚焦到左侧栏搜索面板（dispatch 自定义事件）
 * - Cmd+/: 在当前位置插入 Note 节点
 * - Cmd+D: 插入 DualDialogue 结构
 * - Escape: 退出 focus 模式（如果在 focus 模式中）
 * - Cmd+?: 打开快捷键帮助面板
 */
export function useKeyboardShortcuts(editor: Editor | null) {
  const [showShortcutHelp, setShowShortcutHelp] = useState(false);
  const viewMode = useEditorStore((s) => s.viewMode);
  const setViewMode = useEditorStore((s) => s.setViewMode);

  const toggleShortcutHelp = useCallback(() => {
    setShowShortcutHelp((prev) => !prev);
  }, []);

  const closeShortcutHelp = useCallback(() => {
    setShowShortcutHelp(false);
  }, []);

  useEffect(() => {
    if (!editor) return;

    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;

      // Cmd+Shift+E: 切换场景折叠/展开
      if (mod && e.shiftKey && e.key === 'E') {
        e.preventDefault();
        // Phase 1.4 实现，此处占位
        console.log('[ScriptEditor] Toggle scene collapse — placeholder for Phase 1.4');
        return;
      }

      // Cmd+Shift+F: 聚焦到左侧栏搜索面板
      if (mod && e.shiftKey && e.key === 'F') {
        e.preventDefault();
        document.dispatchEvent(new CustomEvent('script-editor:focus-search'));
        return;
      }

      // Cmd+/: 插入 Note 节点
      if (mod && e.key === '/') {
        e.preventDefault();
        // 尝试插入 note 节点，如果 schema 中不存在则 fallback 到 paragraph
        try {
          const nodeType = editor.schema.nodes.note;
          if (nodeType) {
            editor.chain().focus().setNode('note').run();
          } else {
            // note 节点尚未在 schema 注册时，插入普通段落并加前缀
            editor.chain().focus().insertContent({ type: 'paragraph', content: [{ type: 'text', text: '【批注】' }] }).run();
          }
        } catch {
          editor.chain().focus().insertContent({ type: 'paragraph', content: [{ type: 'text', text: '【批注】' }] }).run();
        }
        return;
      }

      // Cmd+D: 插入 DualDialogue 结构
      if (mod && !e.shiftKey && e.key === 'd') {
        e.preventDefault();
        // 插入双人对话结构：两个连续的 characterCue + dialogue
        try {
          editor
            .chain()
            .focus()
            .insertContent([
              { type: 'characterCue', content: [{ type: 'text', text: '角色A' }] },
              { type: 'dialogue', content: [{ type: 'text', text: '' }] },
              { type: 'characterCue', content: [{ type: 'text', text: '角色B' }] },
              { type: 'dialogue', content: [{ type: 'text', text: '' }] },
            ])
            .run();
        } catch {
          // 如果节点类型不存在，使用 paragraph fallback
          editor
            .chain()
            .focus()
            .insertContent([
              { type: 'paragraph', content: [{ type: 'text', text: '【角色A】' }] },
              { type: 'paragraph', content: [{ type: 'text', text: '（对白）' }] },
              { type: 'paragraph', content: [{ type: 'text', text: '【角色B】' }] },
              { type: 'paragraph', content: [{ type: 'text', text: '（对白）' }] },
            ])
            .run();
        }
        return;
      }

      // Escape: 退出 focus 模式
      if (e.key === 'Escape' && !mod && !e.shiftKey) {
        if (viewMode === 'focus') {
          e.preventDefault();
          setViewMode('edit');
          return;
        }
        // 如果快捷键帮助面板打开，关闭它
        if (showShortcutHelp) {
          e.preventDefault();
          closeShortcutHelp();
          return;
        }
      }

      // Cmd+? (Cmd+Shift+/): 打开快捷键帮助面板
      if (mod && e.shiftKey && e.key === '?') {
        e.preventDefault();
        toggleShortcutHelp();
        return;
      }
    };

    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [editor, viewMode, setViewMode, showShortcutHelp, closeShortcutHelp, toggleShortcutHelp]);

  return { showShortcutHelp, toggleShortcutHelp, closeShortcutHelp };
}
