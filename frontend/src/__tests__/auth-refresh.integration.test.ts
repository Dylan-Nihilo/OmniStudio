// @vitest-environment happy-dom
import axios from 'axios';
import { expect, it, vi } from 'vitest';

it('coordinates JSON and stream recovery across independent tab clients', async () => {
  let authenticated = false;
  let refreshes = 0;
  const originalAdapter = axios.defaults.adapter;
  let lockTail = Promise.resolve();
  const request = vi.fn((_name: string, callback: () => Promise<void>) => {
    const next = lockTail.then(callback);
    lockTail = next.catch(() => undefined);
    return next;
  });
  vi.stubGlobal('navigator', { locks: { request } });
  vi.doMock('axios', () => ({ default: axios, AxiosHeaders: axios.AxiosHeaders }));
  axios.defaults.adapter = async config => {
    const response = { config, status: 200, statusText: 'OK', headers: {}, data: {} };
    if (config.url === '/auth/refresh') {
      refreshes++;
      await new Promise(resolve => setTimeout(resolve, 10));
      authenticated = true;
    } else if (!authenticated) {
      throw new axios.AxiosError('Expired', 'ERR_BAD_REQUEST', config, undefined, { ...response, status: 401 });
    }
    return response;
  };
  vi.stubGlobal('fetch', vi.fn(async () => new Response('result', { status: authenticated ? 200 : 401 })));
  try {
    vi.resetModules();
    const tabA = await import('@/lib/apiClient');
    vi.resetModules();
    const tabB = await import('@/lib/apiClient');
    const results = await Promise.all([tabA.apiClient.get('/projects'), tabB.apiStreamRequest('/projects/stream')]);
    expect(results.map(result => result.status)).toEqual([200, 200]);
    expect(refreshes).toBe(1);
    expect(request).toHaveBeenCalledTimes(2);
  } finally {
    axios.defaults.adapter = originalAdapter;
    vi.doUnmock('axios');
    vi.unstubAllGlobals();
    vi.resetModules();
  }
});


it('sends the editing tab identity on mutating stream requests', async () => {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response('ok'));
  vi.stubGlobal('fetch', fetchMock);
  const { apiStreamRequest, CLIENT_INSTANCE_KEY } = await import('@/lib/apiClient');
  window.sessionStorage.setItem(CLIENT_INSTANCE_KEY, 'editing-tab');
  try {
    await apiStreamRequest('/projects/one/storyboard/refine_batch', { method: 'POST' });
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get('X-Client-Instance-ID')).toBe('editing-tab');
  } finally {
    window.sessionStorage.removeItem(CLIENT_INSTANCE_KEY);
    vi.unstubAllGlobals();
  }
});
