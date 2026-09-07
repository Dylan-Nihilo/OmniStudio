// @vitest-environment happy-dom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import DetailPanel from './DetailPanel';
import { usePlaygroundStore, type PlaygroundGeneration } from './usePlaygroundStore';
const { save, remove } = vi.hoisted(() => ({ save: vi.fn(), remove: vi.fn() }));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@/lib/api', () => ({ playgroundApi: { saveToLibrary: save, deleteGeneration: remove } }));
vi.mock('@/lib/apiClient', () => ({ apiStreamRequest: vi.fn() }));
vi.mock('@/lib/utils', () => ({ getAssetUrl: (path: string) => path }));
const generation: PlaygroundGeneration = { id: 'job', mode: 't2i', model_id: 'model', prompt: 'Sea', input_media: [], parameters: {}, batch_size: 2, status: 'completed', created_at: '2026-09-05', outputs: [{ id: 'a', media_path: 'a.png', media_type: 'image', saved_to_library: true }, { id: 'b', media_path: 'b.png', media_type: 'image', saved_to_library: false }] };
beforeEach(() => { vi.resetAllMocks(); usePlaygroundStore.setState({ history: [generation], activeGenerationIds: [] }); });
afterEach(() => vi.restoreAllMocks());
it('uses a dialog and saves the focused output independently of the first output', async () => {
  save.mockResolvedValue({ ok: true });
  render(<DetailPanel generation={generation} allGenerations={[generation]} focusOutputId="b" onClose={vi.fn()} onNavigate={vi.fn()} />);
  expect(screen.getByRole('dialog', { name: 'detail.title' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'detail.saveToLibrary' }));
  await waitFor(() => expect(save).toHaveBeenCalledWith('job', 'b'));
  await waitFor(() => expect(screen.getByRole('button', { name: 'card.saved' })).toBeDisabled());
  expect(usePlaygroundStore.getState().history[0].outputs.every(output => output.saved_to_library)).toBe(true);
});
it('removes a deleted task from visible history after the server accepts deletion', async () => {
  let finish!: () => void;
  remove.mockReturnValue(new Promise<void>(resolve => { finish = resolve; }));
  const close = vi.fn();
  render(<DetailPanel generation={generation} allGenerations={[generation]} onClose={close} onNavigate={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: /^(Delete|card.delete)$/ }));
  expect(remove).toHaveBeenCalledWith('job');
  expect(usePlaygroundStore.getState().history).toEqual([generation]);
  expect(close).not.toHaveBeenCalled();
  await act(async () => finish());
  await waitFor(() => expect(close).toHaveBeenCalled());
  expect(usePlaygroundStore.getState().history).toEqual([]);
});

it('keeps an unsuccessful save retryable and prevents dismissal while saving', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  let rejectSave!: (reason: Error) => void;
  save.mockReturnValueOnce(new Promise<void>((_, reject) => { rejectSave = reject; }));
  const close = vi.fn();
  render(<DetailPanel generation={generation} allGenerations={[generation]} focusOutputId="b" onClose={close} onNavigate={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'detail.saveToLibrary' }));
  expect(screen.getByRole('button', { name: 'detail.saving' })).toHaveAttribute('aria-disabled', 'true');
  expect(screen.getByRole('button', { name: 'close' })).toBeDisabled();
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  expect(close).not.toHaveBeenCalled();
  await act(async () => rejectSave(new Error('network failure')));
  expect(screen.getByRole('alert')).toHaveTextContent('detail.saveFailed');
  expect(usePlaygroundStore.getState().history).toEqual([generation]);
  save.mockResolvedValueOnce({ ok: true });
  fireEvent.click(screen.getByRole('button', { name: 'detail.saveToLibrary' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'card.saved' })).toBeDisabled());
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(save).toHaveBeenCalledTimes(2);
});

it('keeps the detail and history when deletion fails', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  remove.mockRejectedValueOnce(new Error('network failure'));
  const close = vi.fn();
  render(<DetailPanel generation={generation} allGenerations={[generation]} onClose={close} onNavigate={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'card.delete' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('detail.deleteFailed');
  expect(usePlaygroundStore.getState().history).toEqual([generation]);
  expect(close).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'card.delete' })).toBeEnabled();
});

it('leaves arrow keys to video controls and dismisses with Escape', async () => {
  const videoGeneration: PlaygroundGeneration = { ...generation, outputs: [{ ...generation.outputs[0], media_type: 'video', media_path: 'movie.mp4' }] };
  const previous = { ...generation, id: 'older' };
  usePlaygroundStore.setState({ history: [videoGeneration, previous] });
  const navigate = vi.fn();
  const close = vi.fn();
  render(<DetailPanel generation={videoGeneration} allGenerations={[videoGeneration, previous]} onClose={close} onNavigate={navigate} />);
  const video = screen.getByRole('dialog').querySelector('video')!;
  fireEvent.keyDown(video, { key: 'ArrowLeft' });
  expect(navigate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'detail.previous' }));
  expect(navigate).toHaveBeenCalledWith(previous);
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
});
