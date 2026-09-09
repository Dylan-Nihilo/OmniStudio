/** @vitest-environment happy-dom */
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { renderWithIntl } from '@/test/renderWithIntl';
import { apiClient, redirectToLogin } from '@/lib/apiClient';
import AuthGate from '@/components/auth/AuthGate';

const originalAdapter = apiClient.defaults.adapter;
afterEach(() => { apiClient.defaults.adapter = originalAdapter; window.localStorage.clear(); });

it('can open password recovery and return to login after a session expires', async () => {
  const workspace = { id: 'w1', name: 'Test', role: 'owner', slug: null };
  apiClient.defaults.adapter = async config => {
    const path = new URL(config.url!, 'http://localhost').pathname;
    const responses: Record<string, unknown> = {
      '/auth/setup-status': { initialized: true, setup_allowed: false, setup_token_required: false },
      '/auth/me': { user: { id: 'u1', username: 'e2e', email: 'e2e@example.invalid' }, workspace, workspaces: [workspace] },
      '/auth/legacy-claim/status': { summary: { projects: 0, series: 0, media: 0, conflicts: 0 }, batch: null },
      '/auth/password-reset/status': { available: true, token_required: false },
    };
    if (!(path in responses)) throw new Error(`Unexpected request: ${path}`);
    return { config, status: 200, statusText: 'OK', headers: {}, data: responses[path] };
  };
  window.location.hash = '#/workspace';
  renderWithIntl(<AuthGate><p>Private workspace</p></AuthGate>);
  expect(await screen.findByText('Private workspace')).toBeVisible();
  await act(async () => redirectToLogin());
  expect(screen.queryByText('Private workspace')).not.toBeInTheDocument();
  fireEvent.click(await screen.findByRole('button', { name: '忘记密码？' }));
  await waitFor(() => expect(window.location.hash).toBe('#/reset-password'));
  expect(await screen.findByRole('heading', { name: '重置密码' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '返回登录' }));
  expect(await screen.findByRole('button', { name: '忘记密码？' })).toBeVisible();
});
