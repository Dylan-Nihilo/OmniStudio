import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import EpisodeEditLeaseGuard from './EpisodeEditLeaseGuard';
import { useEditLeaseStore } from '@/store/editLeaseStore';

const { post, patch, remove, auth } = vi.hoisted(() => ({ post: vi.fn(), patch: vi.fn(), remove: vi.fn(),
  auth: { user: { id: 'user-1' }, activeWorkspace: { role: 'owner' } },
}));
vi.mock('@/lib/apiClient', () => ({ API_URL: '/api-proxy', CLIENT_INSTANCE_KEY: 'lease-test', apiClient: { post, patch, delete: remove } }));
vi.mock('@/store/authStore', () => ({ useAuthStore: (select: (state: typeof auth) => unknown) => select(auth) }));
vi.mock('@/store/projectStore', () => ({ useProjectStore: { getState: () => ({ currentProject: { id: 'episode-1', _revision: 'loaded-version' } }) } }));
vi.mock('@omnistudio/ui', () => ({ Button: ({ children, onPress }: { children: React.ReactNode; onPress: () => void }) => <button onClick={onPress}>{children}</button> }));

const locked = (user = 'user-1') => ({ isAxiosError: true, response: { status: 423, data: { lease: {
  holder_user_id: user, holder_display_name: 'creation_runner', revision: 'server-version',
} } } });
const acquired = (token = 'new-token') => ({ data: { holder_user_id: 'user-1', holder_display_name: 'creation_runner', token, revision: 'server-version' } });
async function showEditor() {
  await act(async () => { render(<EpisodeEditLeaseGuard scriptId="episode-1"><textarea aria-label="本地草稿" defaultValue="我的草稿" /></EpisodeEditLeaseGuard>); });
}
beforeEach(() => {
  vi.useFakeTimers(); vi.resetAllMocks();
  auth.activeWorkspace.role = 'owner';
  useEditLeaseStore.setState({ status: 'idle', scriptId: null, token: null, revision: null, holderDisplayName: null });
  remove.mockResolvedValue({});
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

it('explains another session of the same account and recovers after it ends', async () => {
  post.mockRejectedValueOnce(locked()).mockResolvedValue(acquired());
  await showEditor();
  expect(screen.getByRole('status')).toHaveTextContent('你的另一个窗口或编辑会话');
  await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
  expect(useEditLeaseStore.getState()).toMatchObject({ status: 'editing', revision: 'loaded-version' });
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(screen.getByLabelText('本地草稿')).toHaveValue('我的草稿');
});

it('rechecks a locked page on focus without overriding another active editor', async () => {
  post.mockRejectedValue(locked('user-2'));
  await showEditor();
  await act(async () => { fireEvent.focus(window); });
  expect(post).toHaveBeenCalledTimes(2);
  expect(useEditLeaseStore.getState().status).toBe('locked');
  expect(screen.getByRole('status')).toHaveTextContent('creation_runner 正在编辑');
  post.mockResolvedValue(acquired());
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '重新检查' })); });
  expect(useEditLeaseStore.getState().status).toBe('editing');
});

it('recovers a lease expired during sleep without discarding unsaved text or its base revision', async () => {
  post.mockResolvedValueOnce(acquired('first-token')).mockResolvedValue(acquired('second-token'));
  await showEditor();
  fireEvent.change(screen.getByLabelText('本地草稿'), { target: { value: '尚未保存的新想法' } });
  patch.mockRejectedValueOnce({ response: { status: 423 } });
  await act(async () => { fireEvent.focus(window); });
  expect(useEditLeaseStore.getState()).toMatchObject({ status: 'editing', token: 'second-token', revision: 'loaded-version' });
  expect(screen.getByLabelText('本地草稿')).toHaveValue('尚未保存的新想法');
});

it('recovers a failed check when connectivity returns', async () => {
  post.mockRejectedValueOnce(new Error('offline')).mockResolvedValue(acquired());
  await showEditor();
  expect(screen.getByRole('status')).toHaveTextContent('编辑连接已中断');
  await act(async () => { fireEvent.online(window); });
  expect(useEditLeaseStore.getState().status).toBe('editing');
});

it('does not try to acquire edit access for a viewer', async () => {
  auth.activeWorkspace.role = 'viewer';
  await showEditor();
  await act(async () => { fireEvent.focus(window); await vi.advanceTimersByTimeAsync(40_000); });
  expect(post).not.toHaveBeenCalled();
  expect(screen.getByRole('status')).toHaveTextContent('当前账号只能查看');
  expect(screen.queryByRole('button', { name: '重新检查' })).not.toBeInTheDocument();
});
