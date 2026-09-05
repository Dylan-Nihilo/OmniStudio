import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import ScriptProcessor from './ScriptProcessor';
import { useProjectStore } from '@/store/projectStore';
import { useEditLeaseStore } from '@/store/editLeaseStore';
import { api } from '@/lib/api';

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@/lib/api', () => ({ api: { updateScriptText: vi.fn(), extractPreview: vi.fn() } }));
vi.mock('./PreviousEpisodeSummary', () => ({ default: () => <p>Previous episode</p> }));
vi.mock('./ReconcileModal', () => ({ default: () => null }));
const project = { id: 'script-one', title: 'Episode one', originalText: 'Opening scene', characters: [], scenes: [], props: [], frames: [] };
beforeEach(() => {
  vi.clearAllMocks();
  useProjectStore.setState({ currentProject: { ...project } as never, projects: [], isAnalyzing: false, pendingExtraction: null, pendingExtractionScript: null });
  useEditLeaseStore.setState({ status: 'editing', scriptId: project.id, token: 'lease', revision: '1', clientInstanceId: 'tab' });
});
it('saves the captured draft and revision without claiming later typing was saved', async () => {
  let finish!: (value: unknown) => void;
  vi.mocked(api.updateScriptText).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }) as never);
  render(<ScriptProcessor />);
  const editor = screen.getByRole('textbox', { name: 'scriptEditor' });
  fireEvent.change(editor, { target: { value: 'First edit' } });
  fireEvent.blur(editor);
  expect(api.updateScriptText).toHaveBeenCalledWith(project.id, 'First edit', '1', 'lease', 'tab');
  fireEvent.change(editor, { target: { value: 'Later edit' } });
  await act(async () => finish({ _revision: '2' }));
  expect(editor).toHaveValue('Later edit');
  expect(screen.getByRole('status')).toHaveTextContent('unsaved');
  vi.mocked(api.updateScriptText).mockResolvedValueOnce({ _revision: '3' } as never);
  fireEvent.click(screen.getByRole('button', { name: 'save' }));
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('saved'));
  expect(api.updateScriptText).toHaveBeenLastCalledWith(project.id, 'Later edit', '2', 'lease', 'tab');
});
it('retains the text and exposes save failures for retry', async () => {
  vi.mocked(api.updateScriptText).mockRejectedValueOnce(new Error('offline'));
  render(<ScriptProcessor />);
  const editor = screen.getByRole('textbox', { name: 'scriptEditor' });
  fireEvent.change(editor, { target: { value: 'Keep this draft' } });
  fireEvent.blur(editor);
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('saveFailed'));
  expect(editor).toHaveValue('Keep this draft');
  expect(screen.getByRole('button', { name: 'save' })).toBeEnabled();
});
it('preserves extraction confirmation and prevents editing without a lease', async () => {
  const preview = { characters: [{ name: 'A' }], scenes: [], props: [] };
  vi.mocked(api.extractPreview).mockResolvedValueOnce(preview);
  const view = render(<ScriptProcessor />);
  fireEvent.click(screen.getByRole('button', { name: 'analyze' }));
  await waitFor(() => expect(useProjectStore.getState().pendingExtraction).toEqual(preview));
  expect(useProjectStore.getState().pendingExtractionScript).toBe(project.originalText);
  view.unmount();
  useEditLeaseStore.setState({ status: 'locked' });
  render(<ScriptProcessor />);
  expect(screen.getByRole('textbox', { name: 'scriptEditor' })).toHaveAttribute('readonly');
  expect(screen.getByRole('button', { name: 'analyze' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'import' })).toBeDisabled();
});
it('does not attach an old extraction to a newly selected project', async () => {
  let finish!: (value: unknown) => void;
  vi.mocked(api.extractPreview).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }) as never);
  render(<ScriptProcessor />);
  fireEvent.click(screen.getByRole('button', { name: 'analyze' }));
  act(() => useProjectStore.setState({ currentProject: { ...project, id: 'script-two' } as never }));
  await act(async () => finish({ characters: [{ name: 'Old cast' }], scenes: [], props: [] }));
  expect(useProjectStore.getState().pendingExtraction).toBeNull();
});
