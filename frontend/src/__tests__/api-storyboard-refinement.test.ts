import { expect, it, vi } from 'vitest';
import { api } from '@/lib/api';

const { stream } = vi.hoisted(() => ({ stream: vi.fn() }));
vi.mock('@/lib/apiClient', () => ({ apiClient: {}, apiStreamRequest: stream, API_URL: '/api', AUTH_API_URL: '/auth' }));

it('reads split SSE records and returns the actual batch outcome', async () => {
    const body = 'event: frame_refine_error\r\ndata: {"frame_id":"镜头一","error":"请重试"}\r\n\r\nevent: batch_complete\ndata: {"total":1,"success":0,"failed":1}\n\n';
    const bytes = new TextEncoder().encode(body);
    stream.mockResolvedValueOnce(new Response(new ReadableStream({ start(controller) {
        for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
        controller.close();
    } })));
    const events = vi.fn();
    const result = await api.refineBatchFrames('project', events);
    expect(events.mock.calls.map(([event]) => event.type)).toEqual(['frame_refine_error', 'batch_complete']);
    expect(events.mock.calls[0][0].frame_id).toBe('镜头一');
    expect(result).toEqual({ total: 1, success: 0, failed: 1 });
});

it('does not treat an empty or interrupted SSE response as success', async () => {
    for (const body of ['', 'event: frame_refine_start\ndata: {"frame_id":"one"}\n\n']) {
        stream.mockResolvedValueOnce(new Response(body));
        await expect(api.refineBatchFrames('project', vi.fn())).rejects.toThrow();
    }
});
