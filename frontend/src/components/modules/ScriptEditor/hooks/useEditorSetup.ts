'use client';

import { useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import CharacterCount from '@tiptap/extension-character-count';
import History from '@tiptap/extension-history';
import { useEditorStore } from '@/store/editorStore';
import { scriptExtensions } from '../extensions';

interface UseEditorSetupOptions {
  /** Initial document content (Tiptap JSON or HTML string) */
  content?: string | Record<string, unknown> | null;
  /** Whether the editor should be immediately editable */
  editable?: boolean;
}

/**
 * Editor lifecycle management hook.
 *
 * Responsibilities:
 * - Creates and configures the Tiptap Editor instance
 * - Registers all script extensions (SceneHeading, Action, CharacterCue, Dialogue, Transition)
 * - Integrates StarterKit (with custom heading/paragraph disabled)
 * - Adds Placeholder, CharacterCount, History extensions
 * - Binds onUpdate → marks isDirty in editorStore
 * - Binds onSelectionUpdate → reserved for right panel switching
 * - Cleans up editor on unmount
 */
export function useEditorSetup(options: UseEditorSetupOptions = {}) {
  const { content = '', editable = true } = options;

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // Disable defaults that conflict with our custom nodes
        heading: false,
        paragraph: false,
      }),
      ...scriptExtensions,
      Placeholder.configure({
        placeholder: ({ node }) => {
          if (node.type.name === 'sceneHeading') {
            return 'INT./EXT. 场景 - 时间';
          }
          return '开始输入...';
        },
      }),
      CharacterCount,
      History.configure({
        depth: 200,
      }),
    ],
    content: content || '',
    editable,
    onUpdate: ({ editor }) => {
      const store = useEditorStore.getState();
      store.setDirty(true);
      // Update word count derivation
      const text = editor.state.doc.textContent;
      store.updateDerivation({ wordCount: text.length });
    },
    onSelectionUpdate: ({ editor: _editor }) => {
      // Reserved for right panel context switching
      // Will inspect current node type and update activeRightPanel
    },
  });

  const isReady = !!editor && !editor.isDestroyed;

  return { editor, isReady };
}
