"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { Extension, type JSONContent } from '@tiptap/core';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import { closeHistory } from '@tiptap/pm/history';
import type { Node as DocumentNode } from '@tiptap/pm/model';
import { moveScriptParagraph, type TextRange } from '@/lib/scriptWriting';
import styles from './ScriptWritingEditor.module.css';

export interface ScriptEditorHandle {
  replace: (text: string, selection?: TextRange) => void;
  focus: (selection?: TextRange) => void;
  undo: () => void;
  redo: () => void;
  move: (direction: -1 | 1) => void;
}
interface Props {
  value: string;
  readOnly: boolean;
  label: string;
  placeholder: string;
  highlights: TextRange[];
  onChange: (text: string) => void;
  onSelection: (range: TextRange) => void;
  onHistory: (state: { undo: boolean; redo: boolean }) => void;
  onSave: () => void;
  onAI: () => void;
  onFind: () => void;
}

function documentFromText(text: string): JSONContent {
  return { type: 'doc', content: text.split('\n').map(line => ({ type: 'paragraph',
    ...(line ? { content: [{ type: 'text', text: line }] } : {}) })) };
}
function documentText(doc: DocumentNode): string {
  const lines: string[] = [];
  doc.forEach(node => lines.push(node.textContent));
  return lines.join('\n');
}
function textOffset(doc: DocumentNode, position: number): number {
  let offset = 0;
  let found = false;
  doc.forEach((node, start) => {
    if (found) return;
    if (position <= start + node.nodeSize - 1) {
      offset += Math.max(0, Math.min(node.textContent.length, position - start - 1));
      found = true;
    } else offset += node.textContent.length + 1;
  });
  return Math.min(documentText(doc).length, offset);
}
function documentPosition(doc: DocumentNode, offset: number): number {
  let remaining = Math.max(0, offset);
  let result = doc.content.size - 1;
  let found = false;
  doc.forEach((node, start) => {
    if (found) return;
    if (remaining <= node.textContent.length) { result = start + 1 + remaining; found = true; }
    else remaining -= node.textContent.length + 1;
  });
  return result;
}
function selectionRange(state: EditorState): TextRange {
  return { start: textOffset(state.doc, state.selection.from), end: textOffset(state.doc, state.selection.to) };
}

const ScriptTextEditor = forwardRef<ScriptEditorHandle, Props>(function ScriptTextEditor(props, ref) {
  const latest = useRef(props);
  latest.current = props;
  const highlights = useRef(props.highlights);
  highlights.current = props.highlights;
  const decorationsKey = useRef(new PluginKey('script-writing-decorations'));
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ heading: false, blockquote: false, bulletList: false, orderedList: false,
        listItem: false, listKeymap: false, codeBlock: false, horizontalRule: false, hardBreak: false,
        bold: false, italic: false, strike: false, underline: false, code: false, link: false,
        trailingNode: false, undoRedo: { depth: 200 } }),
      Placeholder.configure({ placeholder: () => latest.current.placeholder }),
      Extension.create({
        name: 'scriptLineDecorations',
        addProseMirrorPlugins() {
          return [new Plugin({ key: decorationsKey.current, props: {
            decorations(state) {
              const items: Decoration[] = [];
              state.doc.forEach((node, pos, index) => items.push(Decoration.node(pos, pos + node.nodeSize,
                { 'data-line-number': String(index + 1).padStart(3, '0') })));
              for (const range of highlights.current) {
                const from = documentPosition(state.doc, range.start), to = documentPosition(state.doc, range.end);
                if (to > from) items.push(Decoration.inline(from, to, { class: styles.highlight }));
              }
              return DecorationSet.create(state.doc, items);
            },
          } })];
        },
      }),
    ],
    content: documentFromText(props.value),
    editable: !props.readOnly,
    editorProps: {
      attributes: { role: 'textbox', 'aria-label': props.label, 'aria-multiline': 'true', tabindex: '0', spellcheck: 'false', class: styles.prose },
      handleKeyDown(_view, event) {
        if (event.isComposing) return false;
        const mod = event.metaKey || event.ctrlKey;
        if (mod && event.key.toLowerCase() === 's') { event.preventDefault(); latest.current.onSave(); return true; }
        if (mod && event.key.toLowerCase() === 'k') { event.preventDefault(); latest.current.onAI(); return true; }
        if (mod && event.key.toLowerCase() === 'f') { event.preventDefault(); latest.current.onFind(); return true; }
        if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown') && !latest.current.readOnly) {
          event.preventDefault(); move(event.key === 'ArrowUp' ? -1 : 1); return true;
        }
        return false;
      },
      handlePaste(view: EditorView, event: ClipboardEvent) {
        if (latest.current.readOnly) return true;
        const pasted = event.clipboardData?.getData('text/plain');
        if (!pasted) return false;
        const range = selectionRange(view.state), text = documentText(view.state.doc);
        const plain = pasted.replace(/\r\n?/g, '\n');
        replace(text.slice(0, range.start) + plain + text.slice(range.end),
          { start: range.start + plain.length, end: range.start + plain.length });
        return true;
      },
    },
    onUpdate: ({ editor }) => latest.current.onChange(documentText(editor.state.doc)),
    onSelectionUpdate: ({ editor }) => latest.current.onSelection(selectionRange(editor.state)),
    onTransaction: ({ editor }) => latest.current.onHistory({ undo: editor.can().undo(), redo: editor.can().redo() }),
    onBlur: () => latest.current.onSave(),
  });

  function focus(range?: TextRange) {
    if (!editor) return;
    if (range) editor.commands.setTextSelection({ from: documentPosition(editor.state.doc, range.start), to: documentPosition(editor.state.doc, range.end) });
    editor.commands.focus();
    editor.commands.scrollIntoView();
  }
  function replace(text: string, range?: TextRange) {
    if (!editor || latest.current.readOnly) return;
    editor.view.dispatch(closeHistory(editor.state.tr));
    editor.commands.setContent(documentFromText(text));
    editor.view.dispatch(closeHistory(editor.state.tr));
    focus(range);
  }
  function move(direction: -1 | 1) {
    if (!editor || latest.current.readOnly) return;
    const result = moveScriptParagraph(documentText(editor.state.doc), selectionRange(editor.state), direction);
    if (result) replace(result.text, result.range);
  }
  useImperativeHandle(ref, () => ({ replace, focus, move,
    undo: () => { if (!latest.current.readOnly) editor?.chain().focus().undo().run(); },
    redo: () => { if (!latest.current.readOnly) editor?.chain().focus().redo().run(); },
  }));
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    if (documentText(editor.state.doc) !== props.value) editor.commands.setContent(documentFromText(props.value), { emitUpdate: false });
  }, [editor, props.value]);
  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!props.readOnly);
    editor.view.dom.setAttribute('aria-readonly', String(props.readOnly));
  }, [editor, props.readOnly]);
  useEffect(() => { if (editor && !editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(decorationsKey.current, true)); }, [editor, props.highlights]);
  return <EditorContent editor={editor} className={styles.editorContent} />;
});
export default ScriptTextEditor;
