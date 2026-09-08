import { expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithIntl } from '@/test/renderWithIntl';
const toggleStar = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({api:{toggleProjectStarred:toggleStar}}));
import ProjectCard, { deriveStatus } from './ProjectCard';
import type { Project } from '@/store/projectStore';

it('derives generation from active work, not from existing images or failed tasks', () => {
  const draft = { frames: [{ image_url: '/shot.png' }], video_tasks: [] } as unknown as Project;
  expect(deriveStatus(draft)).toBe('pending');
  expect(deriveStatus({ ...draft, video_tasks: [{ status: 'processing' }] })).toBe('processing');
  expect(deriveStatus({ ...draft, video_tasks: [{ status: 'pending' }] })).toBe('processing');
  expect(deriveStatus({ ...draft, video_tasks: [{ status: 'failed' }, { status: 'cancelled' }] })).toBe('pending');
  expect(deriveStatus({ ...draft, frames: [{ status: 'processing' }] })).toBe('processing');
  expect(deriveStatus({ ...draft, merged_video_url: '/final.mp4' })).toBe('completed');
  expect(deriveStatus({ ...draft, merged_video_url: '/final.mp4', video_tasks: [{ status: 'processing' }] })).toBe('processing');
});

it('keeps starring available on editorial cards and rolls back a failed toggle', async () => {
  let fail!: (error: Error) => void;
  toggleStar.mockReturnValue(new Promise((_,reject) => {fail=reject;}));
  renderWithIntl(<ProjectCard project={{id:'project-1',title:'测试项目',frames:[]} as unknown as Project} onDelete={vi.fn()} onArchive={vi.fn()} onRestore={vi.fn()} onRename={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', {name:'更多操作'}));
  fireEvent.click(await screen.findByRole('menuitem', {name:'加星'}));
  await waitFor(() => expect(toggleStar).toHaveBeenCalledWith('project-1'));
  fireEvent.click(screen.getByRole('button', {name:'更多操作'}));
  expect(await screen.findByRole('menuitem', {name:'取消加星'})).toBeVisible();
  await act(async () => fail(new Error('offline')));
  expect(screen.getByRole('menuitem', {name:'加星'})).toBeVisible();
});
