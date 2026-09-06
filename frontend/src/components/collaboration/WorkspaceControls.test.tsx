import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import GlobalSidebar from '../layout/GlobalSidebar';
import WorkspaceControls from './WorkspaceControls';

const { auth, get, post, remove } = vi.hoisted(() => ({
  auth: { user: { username: 'artist' }, activeWorkspace: { id: 'one', name: 'First', role: 'owner' }, workspaces: [{ id: 'one', name: 'First', role: 'owner' }, { id: 'two', name: 'Second', role: 'member' }], setActiveWorkspace: vi.fn(), createWorkspace: vi.fn(), logout: vi.fn() },
  get: vi.fn(), post: vi.fn(), remove: vi.fn(),
}));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@/store/authStore', () => ({ useAuthStore: (select: (state: typeof auth) => unknown) => select(auth) }));
vi.mock('@/lib/apiClient', () => ({ AUTH_API_URL: '', apiClient: { get, post, delete: remove } }));
vi.mock('@/components/auth/ChangePasswordDialog', () => ({ default: () => null }));
beforeEach(() => { vi.clearAllMocks(); get.mockResolvedValue({ data: [] }); auth.setActiveWorkspace.mockResolvedValue(undefined); });

it('keeps the account popover open while choosing a workspace in a portaled listbox', async () => {
  render(<GlobalSidebar activeTab="workspace" onTabChange={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'artist' }));
  fireEvent.click(screen.getByRole('button', { name: /currentWorkspace/ }));
  const option = await screen.findByRole('option', { name: 'Second' });
  fireEvent.mouseDown(option);
  fireEvent.click(option);
  await waitFor(() => expect(auth.setActiveWorkspace).toHaveBeenCalledWith('two'));
  expect(screen.getByRole('button', { name: 'logout' })).toBeVisible();
});

it('retains a failed workspace draft and blocks dismissal during creation', async () => {
  let reject!: (error: Error) => void;
  auth.createWorkspace.mockImplementation(() => new Promise((_, fail) => { reject = fail; }));
  render(<GlobalSidebar activeTab="workspace" onTabChange={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'artist' }));
  fireEvent.click(screen.getByRole('button', { name: 'createWorkspace' }));
  const dialog = await screen.findByRole('dialog', { name: 'createWorkspace' });
  fireEvent.change(within(dialog).getByRole('textbox', { name: 'workspaceName' }), { target: { value: 'My studio' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'create' }));
  await waitFor(() => expect(auth.createWorkspace).toHaveBeenCalledWith('My studio'));
  expect(within(dialog).getByRole('button', { name: 'cancel' })).toBeDisabled();
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
  expect(dialog).toBeVisible();
  reject(new Error('offline'));
  expect(await within(dialog).findByRole('alert')).toHaveTextContent('createFailed');
  expect(within(dialog).getByRole('textbox', { name: 'workspaceName' })).toHaveValue('My studio');
});

it('requires in-app confirmation to remove a member and retains the member after failure', async () => {
  get.mockResolvedValue({ data: [{ id: 'member', username: 'Rae', email: 'rae@example.test', role: 'member' }] });
  remove.mockRejectedValue(new Error('offline'));
  render(<WorkspaceControls />);
  fireEvent.click(screen.getByRole('button', { name: 'manageMembers' }));
  await screen.findByText('Rae');
  fireEvent.click(screen.getByRole('button', { name: 'removeMember' }));
  const confirm = await screen.findByRole('dialog', { name: 'removeMember' });
  expect(remove).not.toHaveBeenCalled();
  fireEvent.click(within(confirm).getByRole('button', { name: 'confirm' }));
  await waitFor(() => expect(remove).toHaveBeenCalledWith('/auth/workspaces/one/members/member'));
  expect(await within(confirm).findByRole('alert')).toHaveTextContent('removeFailed');
  expect(get).toHaveBeenCalledTimes(1);
});

it('retries switching to an already-created workspace without creating a duplicate', async () => {
  auth.createWorkspace.mockResolvedValue({ id: 'created' });
  auth.setActiveWorkspace.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(undefined);
  render(<WorkspaceControls />);
  fireEvent.click(screen.getByRole('button', { name: 'createWorkspace' }));
  const dialog = await screen.findByRole('dialog', { name: 'createWorkspace' });
  fireEvent.change(within(dialog).getByRole('textbox', { name: 'workspaceName' }), { target: { value: 'My studio' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'create' }));
  expect(await within(dialog).findByRole('alert')).toHaveTextContent('switchCreatedFailed');
  fireEvent.click(within(dialog).getByRole('button', { name: 'create' }));
  await waitFor(() => expect(auth.setActiveWorkspace).toHaveBeenCalledTimes(2));
  expect(auth.createWorkspace).toHaveBeenCalledOnce();
  expect(auth.setActiveWorkspace).toHaveBeenLastCalledWith('created');
});
