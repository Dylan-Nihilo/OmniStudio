/** @vitest-environment jsdom */
import { act, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ status: 'locked', holderDisplayName: 'same-user', acquire: vi.fn().mockResolvedValue(undefined), heartbeat: vi.fn(), release: vi.fn() }));
vi.mock('@/store/editLeaseStore', () => ({ useEditLeaseStore: (select: (s: typeof state) => unknown) => select(state) }));
import EpisodeEditLeaseGuard from '@/components/collaboration/EpisodeEditLeaseGuard';
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });
it('rechecks a held lease so an expired lease does not leave the page read-only forever', async () => {
  vi.useFakeTimers();
  const view = render(<EpisodeEditLeaseGuard scriptId="ep"><div>Editor</div></EpisodeEditLeaseGuard>);
  expect(state.acquire).toHaveBeenCalledTimes(1);
  await act(async () => { vi.advanceTimersByTime(10000); });
  expect(state.acquire).toHaveBeenCalledTimes(2);
  view.unmount();
  await act(async () => { vi.advanceTimersByTime(10000); });
  expect(state.acquire).toHaveBeenCalledTimes(2);
});
