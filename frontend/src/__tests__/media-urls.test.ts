// @vitest-environment happy-dom
import { afterEach, expect, it } from 'vitest';
import { getAssetUrl, getAssetUrlWithTimestamp } from '@/lib/utils';

afterEach(() => localStorage.clear());

it('scopes every local media URL for native images, videos and downloads', () => {
  localStorage.setItem('omni_studio.activeWorkspaceId', 'workspace-b');
  for (const path of ['video/final.mp4', '/files/video/final.mp4', '/api-proxy/files/video/final.mp4']) {
    const url = new URL(getAssetUrl(path), 'http://localhost:3035');
    expect(url.pathname).toMatch(/\/files\/video\/final\.mp4$/);
    expect(url.searchParams.get('workspace_id')).toBe('workspace-b');
  }
  const timed = new URL(getAssetUrlWithTimestamp('video/final.mp4', 42), 'http://localhost:3035');
  expect(timed.searchParams.get('workspace_id')).toBe('workspace-b');
  expect(timed.searchParams.get('t')).toBe('42');
  expect(getAssetUrl('https://cdn.example.com/video.mp4?signature=abc')).toBe('https://cdn.example.com/video.mp4?signature=abc');
});
