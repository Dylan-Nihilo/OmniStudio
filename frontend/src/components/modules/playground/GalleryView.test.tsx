// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import GalleryView from './GalleryView';
import { usePlaygroundStore, type PlaygroundGeneration } from './usePlaygroundStore';

vi.mock('next-intl', () => ({ useTranslations: () => (key: string, values?: { count: number }) => values ? `${key} ${values.count}` : key }));
vi.mock('./ResultCard', () => ({ default: () => <div>media</div> }));
vi.mock('@/lib/utils', () => ({ getAssetUrl: (path: string) => path }));
const generation: PlaygroundGeneration = { id: 'job', mode: 't2i', model_id: 'model', prompt: 'Sea', input_media: [], parameters: {}, batch_size: 2, status: 'completed', created_at: '2026-09-05', outputs: [{ id: 'a', media_path: 'a.png', media_type: 'image', saved_to_library: false }, { id: 'b', media_path: 'b.png', media_type: 'image', saved_to_library: false }] };
beforeEach(() => usePlaygroundStore.setState({ mode: 't2i', inputMedia: [] }));
it('opens and references the selected output of a batch', () => {
  const open = vi.fn();
  render(<GalleryView generations={[generation]} onOpenDetail={open} />);
  fireEvent.click(screen.getByRole('button', { name: 'gallery.candidate 2' }));
  expect(screen.getByRole('button', { name: 'gallery.candidate 2' })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(screen.getAllByRole('button', { name: 'gallery.viewDetail' })[1]);
  expect(open).toHaveBeenCalledWith(generation, 'b');
  fireEvent.click(screen.getByRole('button', { name: 'gallery.useCandidate' }));
  expect(usePlaygroundStore.getState().inputMedia).toEqual(['b.png']);
  expect(usePlaygroundStore.getState().mode).toBe('i2i');
});
it('keeps prompt keys local and scopes arrow navigation to task history', () => {
  const open = vi.fn();
  render(<><textarea aria-label="Prompt" /><GalleryView generations={[generation, { ...generation, id: 'other', prompt: 'Moon' }]} onOpenDetail={open} /></>);
  const prompt = screen.getByRole('textbox', { name: 'Prompt' });
  prompt.focus();
  fireEvent.keyDown(prompt, { key: 'ArrowRight' });
  fireEvent.keyDown(prompt, { key: 'Enter' });
  expect(open).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Sea' })).toHaveAttribute('aria-pressed', 'true');
  const task = screen.getByRole('button', { name: 'Sea' });
  task.focus();
  fireEvent.keyDown(task, { key: 'ArrowRight' });
  expect(screen.getByRole('button', { name: 'Moon' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('button', { name: 'Moon' })).toHaveFocus();
});
