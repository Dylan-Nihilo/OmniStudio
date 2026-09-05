import { expect, it } from 'vitest';
import { deriveStatus } from './ProjectCard';
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
