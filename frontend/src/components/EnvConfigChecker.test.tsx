import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AxiosError } from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '@/store/authStore';
import EnvConfigChecker from './EnvConfigChecker';
import EnvConfigDialog from './project/EnvConfigDialog';

const mocks = vi.hoisted(() => ({ getEnvConfig: vi.fn(), saveEnvConfig: vi.fn(), fetchPromptDefaults: vi.fn(), healthCheck: vi.fn() }));
const t = vi.hoisted(() => (key: string) => key);
vi.mock('next-intl', () => ({ useTranslations: () => t }));
vi.mock('@/lib/api', () => ({ api: mocks, API_URL: 'http://localhost:3021' }));
vi.mock('@/components/layout/OmniStudioBranding', () => ({ default: () => null }));
vi.mock('@/components/settings/UpdateChecker', () => ({ default: () => null }));

const forbidden = new AxiosError('Forbidden', 'ERR_BAD_REQUEST', undefined, undefined, {
  status: 403, statusText: 'Forbidden', data: { error: { code: 'AUTH_OWNER_REQUIRED' } }, headers: {}, config: {} as never,
});
const ownerWorkspace = { id: 'workspace', name: 'Workspace', slug: null, role: 'owner' as const };

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  useAuthStore.setState({
    user: { id: 'member', username: 'user01', display_name: 'Writer', email: 'member@example.test', created_at: '' },
    activeWorkspace: { id: 'workspace', name: 'Workspace', slug: null, role: 'member' },
    bootstrapping: false,
  });
  mocks.getEnvConfig.mockRejectedValue(forbidden);
  mocks.fetchPromptDefaults.mockResolvedValue({});
  mocks.healthCheck.mockResolvedValue({});
});

describe('configuration dialog after refresh', () => {
  it('does not trap a workspace member in configuration when its request is forbidden', async () => {
    await act(async () => { render(<EnvConfigChecker />); });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mocks.getEnvConfig).not.toHaveBeenCalled();
  });

  it('lets the user close a required configuration dialog when configuration cannot be loaded', async () => {
    useAuthStore.setState({ activeWorkspace: ownerWorkspace });
    mocks.getEnvConfig.mockRejectedValue(new Error('Network error'));
    const close = vi.fn();
    await act(async () => { render(<EnvConfigDialog isOpen isRequired onClose={close} />); });
    expect(screen.getByRole('alert')).toHaveTextContent('loadConfigFailed');
    fireEvent.click(screen.getByRole('button', { name: 'close' }));
    expect(close).toHaveBeenCalledOnce();
  });

  it.each([401, 403, 503, undefined])('does not infer missing credentials from request failure %s', async status => {
    useAuthStore.setState({ activeWorkspace: ownerWorkspace });
    mocks.getEnvConfig.mockRejectedValue(new AxiosError('Request failed', undefined, undefined, undefined,
      status ? { status, statusText: 'Failed', data: {}, headers: {}, config: {} as never } : undefined));
    await act(async () => { render(<EnvConfigChecker />); });
    expect(mocks.getEnvConfig).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it.each(['dashscope', 'openai'])('offers dismissable setup only for a confirmed missing %s credential', async provider => {
    useAuthStore.setState({ activeWorkspace: ownerWorkspace });
    mocks.getEnvConfig.mockResolvedValue({ LLM_PROVIDER: provider, DASHSCOPE_API_KEY: 'masked', OPENAI_API_KEY: 'masked',
      secrets_configured: { DASHSCOPE_API_KEY: provider !== 'dashscope', OPENAI_API_KEY: provider !== 'openai' } });
    await act(async () => { render(<EnvConfigChecker />); });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it.each(['workspace', 'role', 'logout'])('ignores a stale missing-key response after a %s change', async change => {
    useAuthStore.setState({ activeWorkspace: ownerWorkspace });
    let finish!: (value: object) => void;
    mocks.getEnvConfig.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }))
      .mockResolvedValue({ secrets_configured: { DASHSCOPE_API_KEY: true } });
    render(<EnvConfigChecker />);
    await act(async () => useAuthStore.setState(change === 'logout' ? {user:null, activeWorkspace:null} : {
      activeWorkspace: change === 'role' ? {...ownerWorkspace, role:'member'} : {...ownerWorkspace, id:'workspace-b'},
    }));
    await act(async () => finish({ DASHSCOPE_API_KEY:'' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mocks.getEnvConfig).toHaveBeenCalledTimes(change === 'workspace' ? 2 : 1);
  });

  it('blocks dismissal only during a save and restores it after a failed save', async () => {
    useAuthStore.setState({ activeWorkspace: ownerWorkspace });
    mocks.getEnvConfig.mockResolvedValue({ DASHSCOPE_API_KEY: '' });
    let fail!: (error: Error) => void;
    mocks.saveEnvConfig.mockReturnValue(new Promise((_, reject) => { fail = reject; }));
    const close = vi.fn();
    render(<EnvConfigDialog isOpen isRequired onClose={close} />);
    fireEvent.change(await screen.findByLabelText('DashScope API Key'), {target:{value:'test-key'}});
    fireEvent.click(screen.getByRole('button', {name:'saveConfig'}));
    await waitFor(() => expect(mocks.saveEnvConfig).toHaveBeenCalledOnce());
    expect(screen.getByRole('button', {name:'close'})).toBeDisabled();
    await act(async () => fail(new Error('Offline')));
    expect(screen.getByRole('alert')).toHaveTextContent('saveConfigFailed');
    expect(screen.getByLabelText('DashScope API Key')).toHaveValue('test-key');
    fireEvent.click(screen.getByRole('button', {name:'close'}));
    expect(close).toHaveBeenCalledOnce();
  });
});
