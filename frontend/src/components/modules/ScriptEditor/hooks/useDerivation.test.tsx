import { act, renderHook } from '@testing-library/react';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { expect, it } from 'vitest';
import { useEditorStore } from '@/store/editorStore';
import { useDerivation } from './useDerivation';

it('counts text once across paragraphs, nested blocks and marked text after edits', () => {
  const editor = new Editor({
    extensions: [StarterKit],
    content: '<p>末班<strong>信号</strong></p><blockquote><p>林澈</p></blockquote>',
  });
  const hook = renderHook(() => useDerivation(editor));
  try {
    expect(useEditorStore.getState().wordCount).toBe(6);
    act(() => {
      editor.commands.setContent('<p>阿岚：车到了。</p>');
      hook.result.current.runDerivation();
    });
    expect(useEditorStore.getState().wordCount).toBe(7);
  } finally {
    hook.unmount();
    editor.destroy();
  }
});
