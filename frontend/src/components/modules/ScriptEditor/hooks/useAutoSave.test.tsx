// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { scriptEditorApi } from '@/lib/scriptEditorApi';
import { useEditorStore } from '@/store/editorStore';
import { useAutoSave } from './useAutoSave';

vi.mock('@/lib/scriptEditorApi', () => ({ scriptEditorApi: { saveDocument: vi.fn() } }));
let editor: Editor;
beforeEach(() => {
  vi.resetAllMocks();
  editor = new Editor({ extensions: [StarterKit], content: '<p>First draft</p>' });
  useEditorStore.setState({ projectId: 'project-a', isDirty: true, isLoading: false, lastSavedAt: null });
});
afterEach(() => { editor.destroy(); vi.useRealTimers(); vi.restoreAllMocks(); });

it('keeps edits made during a save dirty and persists them on the next save', async () => {
  let finish!: () => void;
  vi.mocked(scriptEditorApi.saveDocument).mockImplementationOnce(() => new Promise(resolve => {
    finish = () => resolve({ project_id: 'project-a', content: {}, updated_at: '' });
  })).mockResolvedValue({ project_id: 'project-a', content: {}, updated_at: '' });
  const { result } = renderHook(() => useAutoSave(editor, 'project-a'));
  let saving!: Promise<unknown>;
  act(() => { saving = result.current.save(); });
  act(() => { editor.commands.setContent('<p>Second draft</p>'); });
  await act(async () => { finish(); await saving; });
  expect(useEditorStore.getState().isDirty).toBe(true);
  await act(async () => { await result.current.save(); });
  expect(scriptEditorApi.saveDocument).toHaveBeenLastCalledWith('project-a', expect.objectContaining({content: [expect.objectContaining({content: [{ type: 'text', text: 'Second draft' }]})]}), false);
  expect(useEditorStore.getState().isDirty).toBe(false);
});

it('does not let an old project response reset the next project save', async () => {
  const completions: (() => void)[] = [];
  vi.mocked(scriptEditorApi.saveDocument).mockImplementation(id => new Promise(resolve => {
    completions.push(() => resolve({ project_id: id, content: {}, updated_at: '' }));
  }));
  const { result, rerender } = renderHook(({ id }) => useAutoSave(editor, id), { initialProps: { id: 'project-a' } });
  act(() => { void result.current.save(); });
  act(() => { useEditorStore.setState({ projectId: 'project-b', isDirty: true, lastSavedAt: null }); });
  rerender({ id: 'project-b' });
  act(() => { void result.current.save(); });
  await act(async () => completions[0]());
  expect(result.current.isSaving).toBe(true);
  expect(useEditorStore.getState().isDirty).toBe(true);
  expect(useEditorStore.getState().lastSavedAt).toBeNull();
  await act(async () => completions[1]());
  expect(result.current.isSaving).toBe(false);
  expect(useEditorStore.getState().isDirty).toBe(false);
});

it('retries failed autosaves and never saves a loading document', async () => {
  vi.useFakeTimers();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.mocked(scriptEditorApi.saveDocument).mockRejectedValueOnce(new Error('Offline')).mockResolvedValue({ project_id: 'project-a', content: {}, updated_at: '' });
  useEditorStore.setState({ isLoading: true });
  const { result } = renderHook(() => useAutoSave(editor, 'project-a'));
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
  expect(scriptEditorApi.saveDocument).not.toHaveBeenCalled();
  act(() => useEditorStore.setState({ isLoading: false }));
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
  expect(result.current.saveError).toBe('Offline');
  expect(useEditorStore.getState().isDirty).toBe(true);
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
  expect(result.current.saveError).toBeNull();
  expect(useEditorStore.getState().isDirty).toBe(false);
});
