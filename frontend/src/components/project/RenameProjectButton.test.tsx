import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import RenameProjectButton from './RenameProjectButton';
import { api } from '@/lib/api';
import { useProjectStore } from '@/store/projectStore';
import { useAuthStore } from '@/store/authStore';
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@/lib/api', () => ({ api: { updateProject: vi.fn() } }));
beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({ activeWorkspace: { role: 'owner' } as never });
  useProjectStore.setState({ currentProject: { id: 'p', title: 'Typo', originalText: 'Keep this draft' } as never, projects: [] });
});
it('renames the project without replacing its script and retains failed input for retry', async () => {
  vi.mocked(api.updateProject).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ title: '归鞘' } as never);
  render(<RenameProjectButton projectId="p" title="Typo" />);
  fireEvent.click(screen.getByRole('button', { name: 'rename' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'projectName' }), { target: { value: ' 归鞘 ' } });
  fireEvent.click(screen.getByRole('button', { name: 'save' }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('renameFailed'));
  expect(screen.getByRole('textbox', { name: 'projectName' })).toHaveValue(' 归鞘 ');
  fireEvent.click(screen.getByRole('button', { name: 'save' }));
  await waitFor(() => expect(useProjectStore.getState().currentProject?.title).toBe('归鞘'));
  expect(api.updateProject).toHaveBeenLastCalledWith('p', { title: '归鞘' });
  expect(useProjectStore.getState().currentProject?.originalText).toBe('Keep this draft');
});
it('does not offer rename to a viewer', () => {
  useAuthStore.setState({ activeWorkspace: { role: 'viewer' } as never });
  render(<RenameProjectButton projectId="p" title="Typo" />);
  expect(screen.queryByRole('button', { name: 'rename' })).not.toBeInTheDocument();
});
