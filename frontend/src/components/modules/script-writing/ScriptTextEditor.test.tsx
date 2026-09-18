// @vitest-environment jsdom
import { createRef, useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, expect, it, vi } from 'vitest';
import ScriptTextEditor, { type ScriptEditorHandle } from './ScriptTextEditor';

beforeAll(() => {
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  document.elementFromPoint = () => null;
  window.scrollBy = () => undefined;
});

it('preserves plain text and Unicode selections, moves paragraphs, and undoes an AI replacement', async () => {
  const handle = createRef<ScriptEditorHandle>();
  const selection = vi.fn();
  function Harness() {
    const [value, setValue] = useState('甲😀乙\n\n尾声');
    return <><ScriptTextEditor ref={handle} value={value} readOnly={false} label="Script" placeholder="Idea" highlights={[]}
      onChange={setValue} onSelection={selection} onHistory={() => {}} onSave={() => {}} onAI={() => {}} onFind={() => {}} /><output aria-label="Source">{value}</output></>;
  }
  render(<Harness />);
  await screen.findByRole('textbox', { name: 'Script' });
  act(() => handle.current!.focus({ start: 1, end: 3 }));
  expect(selection).toHaveBeenLastCalledWith({ start: 1, end: 3 });
  act(() => handle.current!.replace('甲雨夜乙\n\n尾声', { start: 1, end: 3 }));
  expect(screen.getByLabelText('Source')).toHaveTextContent('甲雨夜乙');
  act(() => handle.current!.undo());
  await waitFor(() => expect(screen.getByLabelText('Source').textContent).toBe('甲😀乙\n\n尾声'));
  act(() => handle.current!.redo());
  expect(screen.getByLabelText('Source').textContent).toBe('甲雨夜乙\n\n尾声');
  act(() => handle.current!.focus({ start: 6, end: 8 }));
  fireEvent.keyDown(screen.getByRole('textbox', { name: 'Script' }), { altKey: true, key: 'ArrowUp' });
  expect(screen.getByLabelText('Source').textContent).toBe('甲雨夜乙\n尾声\n');
});

it('supports multiline paste and prevents mutation when the editor is read-only', async () => {
  const change = vi.fn();
  const props = { value: '', readOnly: false, label: 'Script', placeholder: 'Idea', highlights: [],
    onChange: change, onSelection: vi.fn(), onHistory: vi.fn(), onSave: vi.fn(), onAI: vi.fn(), onFind: vi.fn() };
  const view = render(<ScriptTextEditor {...props} />);
  const editor = await screen.findByRole('textbox', { name: 'Script' });
  fireEvent.paste(editor, { clipboardData: { getData: () => '  开场\r\n\r\n结尾😀' } });
  expect(change).toHaveBeenLastCalledWith('  开场\n\n结尾😀');
  view.rerender(<ScriptTextEditor {...props} value="Saved" readOnly />);
  change.mockClear();
  fireEvent.paste(editor, { clipboardData: { getData: () => 'Overwrite' } });
  expect(change).not.toHaveBeenCalled();
  expect(editor).toHaveAttribute('contenteditable', 'false');
});
