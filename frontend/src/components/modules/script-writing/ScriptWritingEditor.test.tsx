import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ScriptWritingEditor from './ScriptWritingEditor';
import { api } from '@/lib/api';

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@/lib/api', () => ({ api: { previewScriptWriting: vi.fn(), checkScriptContinuity: vi.fn() } }));
vi.mock('./ScriptTextEditor', async () => {
  const { forwardRef, useImperativeHandle } = await import('react');
  return { default: forwardRef(function Stub(props: any, ref: any) {
    useImperativeHandle(ref, () => ({ replace: props.onChange, focus: vi.fn(), undo: vi.fn(), redo: vi.fn(), move: vi.fn() }));
    return <textarea aria-label="scriptEditor" value={props.value} readOnly={props.readOnly} onChange={event => props.onChange(event.target.value)} onSelect={event => props.onSelection({ start: event.currentTarget.selectionStart, end: event.currentTarget.selectionEnd })} onKeyDown={event => { if (event.key === 'k' && event.ctrlKey) props.onAI(); }} />;
  }) };
});
function Harness({ projectId = 'p', initial = '开场\n结尾', readOnly = false }: { projectId?: string; initial?: string; readOnly?: boolean }) {
  const [value, setValue] = useState(initial);
  return <ScriptWritingEditor projectId={projectId} value={value} onChange={setValue} onSave={() => {}} readOnly={readOnly} footer={null} outline={<p>Outline</p>} reference={<p>References</p>} />;
}
beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { vi.useRealTimers(); });
const suggestion = { original: '开场\n结尾', replacement: '新的开场\n结尾', summary: '调整开场', scope: 'document', selection: null, source_fingerprint: 'hash' };

it('reviews a whole-script suggestion before applying and supports writing from an idea', async () => {
  vi.mocked(api.previewScriptWriting).mockResolvedValueOnce(suggestion as never);
  render(<Harness />);
  fireEvent.change(screen.getByRole('textbox', { name: 'instruction' }), { target: { value: '加强开场悬念' } });
  fireEvent.click(screen.getByRole('button', { name: 'generate' }));
  await screen.findByRole('textbox', { name: 'replacement' });
  expect(screen.getByRole('textbox', { name: 'scriptEditor' })).toHaveValue('开场\n结尾');
  fireEvent.click(screen.getByRole('button', { name: 'accept' }));
  expect(screen.getByRole('textbox', { name: 'scriptEditor' })).toHaveValue('新的开场\n结尾');
});

it('never overwrites typing that happened while the model was running', async () => {
  let complete!: (value: unknown) => void;
  vi.mocked(api.previewScriptWriting).mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }) as never);
  render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: 'generate' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'scriptEditor' }), { target: { value: '更新的开场\n结尾' } });
  await act(async () => complete(suggestion));
  expect(screen.getByRole('button', { name: 'accept' })).toBeDisabled();
  expect(screen.getByRole('alert')).toHaveTextContent('stalePreview');
  expect(screen.getByRole('textbox', { name: 'scriptEditor' })).toHaveValue('更新的开场\n结尾');
});

it('captures inline selection for Ctrl K rather than rewriting the entire script', async () => {
  vi.mocked(api.previewScriptWriting).mockResolvedValueOnce({ ...suggestion, scope: 'selection', original: '开', selection: { start: 0, end: 1 }, replacement: '雨夜开' } as never);
  render(<Harness />);
  const editor = screen.getByRole('textbox', { name: 'scriptEditor' }) as HTMLTextAreaElement;
  editor.setSelectionRange(0, 1); fireEvent.select(editor); fireEvent.keyDown(editor, { key: 'k', ctrlKey: true });
  fireEvent.click(screen.getByRole('button', { name: 'generate' }));
  await waitFor(() => expect(api.previewScriptWriting).toHaveBeenCalled());
  expect(vi.mocked(api.previewScriptWriting).mock.calls[0][1]).toMatchObject({ scope: 'selection', selection: { start: 0, end: 1 } });
  fireEvent.click(await screen.findByRole('button', { name: 'accept' }));
  expect(editor).toHaveValue('雨夜开场\n结尾');
});

it('pairs continuity evidence and marks it stale after new edits', async () => {
  vi.mocked(api.checkScriptContinuity).mockResolvedValueOnce({ source_fingerprint: 'hash', issues: [{ quote: '开场', related_quote: '结尾', category: 'timeline', severity: 'warning', message: '前后时间冲突', suggestion: '修改结尾的时间' }] });
  render(<Harness />);
  fireEvent.click(screen.getByRole('tab', { name: 'continuityTab' }));
  fireEvent.click(screen.getByRole('button', { name: 'check' }));
  await screen.findByText('前后时间冲突');
  fireEvent.change(screen.getByRole('textbox', { name: 'scriptEditor' }), { target: { value: '新开场\n结尾' } });
  expect(screen.getByText('staleReport')).toBeVisible();
  expect(screen.getByRole('button', { name: 'reviseIssue' })).toBeDisabled();
  expect(api.checkScriptContinuity).toHaveBeenCalledTimes(1);
});

it('keeps undo history mounted when switching the script to outline and back', () => {
  render(<Harness />);
  const editor = screen.getByRole('textbox', { name: 'scriptEditor' });
  fireEvent.click(screen.getByRole('tab', { name: 'outline' }));
  fireEvent.click(screen.getByRole('tab', { name: 'script' }));
  expect(screen.getByRole('textbox', { name: 'scriptEditor' })).toBe(editor);
});
it('generates a complete first draft from only an idea', async () => {
  vi.mocked(api.previewScriptWriting).mockResolvedValueOnce({ ...suggestion, original: '', replacement: '夜，破亭。\n少年收剑。' } as never);
  render(<Harness initial="" />);
  expect(screen.getByRole('button', { name: 'generate' })).toBeDisabled();
  fireEvent.change(screen.getByRole('textbox', { name: 'instruction' }), { target: { value: '写一个师徒和解的故事' } });
  fireEvent.click(screen.getByRole('button', { name: 'generate' }));
  fireEvent.click(await screen.findByRole('button', { name: 'accept' }));
  expect(screen.getByRole('textbox', { name: 'scriptEditor' })).toHaveValue('夜，破亭。\n少年收剑。');
  expect(vi.mocked(api.previewScriptWriting).mock.calls[0][1]).toMatchObject({ text: '', scope: 'document', instruction: '写一个师徒和解的故事' });
});
it('checks after an opted-in pause and does not silently run checks before opt-in', async () => {
  vi.useFakeTimers();
  vi.mocked(api.checkScriptContinuity).mockResolvedValue({ source_fingerprint: 'hash', issues: [] });
  render(<Harness />);
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(api.checkScriptContinuity).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('tab', { name: 'continuityTab' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'automatic' }));
  await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
  expect(api.checkScriptContinuity).toHaveBeenCalledTimes(1);
  fireEvent.change(screen.getByRole('textbox', { name: 'scriptEditor' }), { target: { value: '变化后的开场\n结尾' } });
  await act(async () => { await vi.advanceTimersByTimeAsync(3999); });
  expect(api.checkScriptContinuity).toHaveBeenCalledTimes(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(api.checkScriptContinuity).toHaveBeenCalledTimes(2);
  expect(vi.mocked(api.checkScriptContinuity).mock.calls[1][1]).toBe('变化后的开场\n结尾');
});
