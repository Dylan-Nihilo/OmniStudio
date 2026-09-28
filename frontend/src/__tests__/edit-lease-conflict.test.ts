// @vitest-environment happy-dom
/**
 * A request refused because the episode's edit lease is held elsewhere comes back as 423.
 * Every caller in the app shows `error.message`, so a blocked export read
 * "Request failed with status code 423" and told the user nothing — not that a second
 * window of their own was holding the episode, and not that there is a button to take it.
 */
import axios from 'axios';
import { expect, it, vi } from 'vitest';

it('explains a lease conflict and announces it so the takeover banner appears at once', async () => {
    const originalAdapter = axios.defaults.adapter;
    vi.doMock('axios', () => ({ default: axios, AxiosHeaders: axios.AxiosHeaders }));
    axios.defaults.adapter = async config => {
        const response = { config, status: 423, statusText: 'Locked', headers: {},
            data: { error: { code: 'EDIT_LEASE_HELD', message: '超级管理员 正在编辑这一集' } } };
        throw new axios.AxiosError('Request failed with status code 423', 'ERR_BAD_REQUEST',
            config, undefined, response as never);
    };
    try {
        const { apiClient, EDIT_LEASE_EVENT, EDIT_LEASE_HELD_MESSAGE } = await import('@/lib/apiClient');
        const announced = vi.fn();
        window.addEventListener(EDIT_LEASE_EVENT, announced);

        await expect(apiClient.post('/projects/episode/merge')).rejects.toMatchObject({
            message: EDIT_LEASE_HELD_MESSAGE,
        });
        // Says which window and what to do about it, rather than quoting a status code.
        expect(EDIT_LEASE_HELD_MESSAGE).toContain('在本窗口继续编辑');
        expect(EDIT_LEASE_HELD_MESSAGE).not.toContain('423');
        // The guard listens for this, so the banner does not wait for its next 20s poll.
        expect(announced).toHaveBeenCalled();

        window.removeEventListener(EDIT_LEASE_EVENT, announced);
    } finally {
        axios.defaults.adapter = originalAdapter;
        vi.doUnmock('axios');
    }
});
