// @vitest-environment happy-dom
/**
 * A finished episode is tens of megabytes and one long response has to survive the whole
 * transfer. On the link this was reported from it never did: the server answered with the
 * full 40 MB every time and the connection died after 77–141 KB, so the download failed
 * with nothing to resume and only "下载失败，请重试" to show. Ranges turn the short bursts
 * the link does manage into a complete file.
 */
import { beforeEach, expect, it, vi } from 'vitest';

const stream = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('@/lib/apiClient', () => ({ apiStreamRequest: stream.request }));

import { downloadInChunks, probeSize } from '@/lib/chunkedDownload';

const TOTAL = 5 * 1024 * 1024 + 7;          // not a whole number of chunks

function ranged(body: Uint8Array) {
    return (url: string, init: RequestInit = {}) => {
        const header = new Headers(init.headers).get('Range') ?? '';
        const match = /bytes=(\d+)-(\d*)/.exec(header);
        if (!match) {
            return Promise.resolve(new Response(new Blob([body]), { status: 200, headers: { 'Content-Length': String(body.length) } }));
        }
        const start = Number(match[1]);
        const end = match[2] ? Number(match[2]) : body.length - 1;
        const slice = body.slice(start, end + 1);
        return Promise.resolve(new Response(new Blob([slice]), {
            status: 206,
            headers: { 'Content-Range': `bytes ${start}-${end}/${body.length}`, 'Content-Length': String(slice.length) },
        }));
    };
}

beforeEach(() => { stream.request.mockReset(); });

it('reads the total size without pulling the body', async () => {
    const body = new Uint8Array(TOTAL);
    stream.request.mockImplementation(ranged(body));
    expect(await probeSize('/files/video/x.mp4')).toBe(TOTAL);
    // One byte asked for, one byte transferred.
    expect(new Headers(stream.request.mock.calls[0][1].headers).get('Range')).toBe('bytes=0-0');
});

it('assembles the whole file from ranges, in order', async () => {
    const body = new Uint8Array(TOTAL);
    for (let i = 0; i < TOTAL; i += 1) body[i] = i % 251;   // position-dependent, so order shows
    stream.request.mockImplementation(ranged(body));
    const seen: number[] = [];

    const blob = await downloadInChunks('/files/video/x.mp4', { onProgress: (r, t) => seen.push(r / t) });

    expect(blob.size).toBe(TOTAL);
    // Sampled rather than compared element by element: a 5 MB deep-equality is slower than
    // the download it is checking. Boundaries are where a misordered join would show.
    const bytes = new Uint8Array(await blob.arrayBuffer());
    for (const at of [0, 1, 2 * 1024 * 1024 - 1, 2 * 1024 * 1024, 4 * 1024 * 1024, TOTAL - 1]) {
        expect([at, bytes[at]]).toEqual([at, at % 251]);
    }
    // Progress is reported as it goes, which is what the old silent failure lacked.
    expect(seen.length).toBeGreaterThan(1);
    expect(seen.at(-1)).toBeCloseTo(1, 5);
});

it('retries only the range that dropped, not the whole download', async () => {
    const body = new Uint8Array(TOTAL);
    const serve = ranged(body);
    let failures = 0;
    stream.request.mockImplementation((url: string, init: RequestInit = {}) => {
        const header = new Headers(init.headers).get('Range') ?? '';
        // Kill the third megabyte once, the way the reported link cut out mid-transfer.
        if (header.startsWith('bytes=4194304-') && failures === 0) {
            failures += 1;
            return Promise.reject(new TypeError('network error'));
        }
        return serve(url, init);
    });

    const blob = await downloadInChunks('/files/video/x.mp4', { chunkBytes: 2 * 1024 * 1024 });
    expect(blob.size).toBe(TOTAL);
    expect(failures).toBe(1);
});

it('says how far it got when a range will not come down at all', async () => {
    const body = new Uint8Array(TOTAL);
    const serve = ranged(body);
    stream.request.mockImplementation((url: string, init: RequestInit = {}) => {
        const header = new Headers(init.headers).get('Range') ?? '';
        if (header.startsWith('bytes=2097152-')) return Promise.reject(new TypeError('network error'));
        return serve(url, init);
    });

    await expect(downloadInChunks('/files/video/x.mp4', { chunkBytes: 2 * 1024 * 1024, attemptsPerChunk: 2 }))
        .rejects.toThrow(/已完成 \d+%/);
});
