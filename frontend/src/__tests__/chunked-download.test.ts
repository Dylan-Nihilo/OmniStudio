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

/** Serves `buffer` the way `/files` does: whole on a plain GET, a slice on a Range. */
function ranged(buffer: ArrayBuffer) {
    return (url: string, init: RequestInit = {}) => {
        const header = new Headers(init.headers).get('Range') ?? '';
        const match = /bytes=(\d+)-(\d*)/.exec(header);
        if (!match) {
            return Promise.resolve(new Response(buffer, {
                status: 200, headers: { 'Content-Length': String(buffer.byteLength) },
            }));
        }
        const start = Number(match[1]);
        const end = match[2] ? Number(match[2]) : buffer.byteLength - 1;
        const slice = buffer.slice(start, end + 1);
        return Promise.resolve(new Response(slice, {
            status: 206,
            headers: {
                'Content-Range': `bytes ${start}-${end}/${buffer.byteLength}`,
                'Content-Length': String(slice.byteLength),
            },
        }));
    };
}

/** A buffer whose byte at each position encodes that position, so order is checkable. */
function patterned(size: number): ArrayBuffer {
    const buffer = new ArrayBuffer(size);
    const view = new Uint8Array(buffer);
    for (let i = 0; i < size; i += 1) view[i] = i % 251;
    return buffer;
}

beforeEach(() => { stream.request.mockReset(); });

it('reads the total size without pulling the body', async () => {
    stream.request.mockImplementation(ranged(new ArrayBuffer(TOTAL)));
    expect(await probeSize('/files/video/x.mp4')).toBe(TOTAL);
    // One byte asked for, one byte transferred.
    expect(new Headers(stream.request.mock.calls[0][1].headers).get('Range')).toBe('bytes=0-0');
});

it('assembles the whole file from ranges, in order', async () => {
    stream.request.mockImplementation(ranged(patterned(TOTAL)));
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
    const serve = ranged(new ArrayBuffer(TOTAL));
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
    const serve = ranged(new ArrayBuffer(TOTAL));
    stream.request.mockImplementation((url: string, init: RequestInit = {}) => {
        const header = new Headers(init.headers).get('Range') ?? '';
        if (header.startsWith('bytes=2097152-')) return Promise.reject(new TypeError('network error'));
        return serve(url, init);
    });

    await expect(downloadInChunks('/files/video/x.mp4', { chunkBytes: 2 * 1024 * 1024, attemptsPerChunk: 2 }))
        .rejects.toThrow(/已完成 \d+%/);
});

it('finds a size the link will carry when every response is capped', async () => {
    // The reported link cut every response at exactly 77,268 bytes no matter how much was
    // asked for — a fixed cap, not a flaky connection. Retrying 2 MB could never succeed;
    // the size has to come down until it fits underneath.
    const CAP = 77_268;
    const buffer = patterned(TOTAL);
    const serve = ranged(buffer);
    const asked: number[] = [];
    stream.request.mockImplementation(async (url: string, init: RequestInit = {}) => {
        const response = await serve(url, init);
        const header = new Headers(init.headers).get('Range') ?? '';
        const match = /bytes=(\d+)-(\d+)/.exec(header);
        if (!match) return response;
        const wanted = Number(match[2]) - Number(match[1]) + 1;
        asked.push(wanted);
        if (wanted <= CAP) return response;
        // Truncated exactly the way the link does it.
        const body = (await response.arrayBuffer()).slice(0, CAP);
        return new Response(body, { status: 206, headers: response.headers });
    });

    const blob = await downloadInChunks('/files/video/x.mp4', { onProgress: () => {} });

    expect(blob.size).toBe(TOTAL);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    for (const at of [0, CAP, CAP + 1, TOTAL - 1]) {
        expect([at, bytes[at]]).toEqual([at, at % 251]);
    }
    // It backed off until the request fitted under the cap, and stayed there.
    expect(Math.max(...asked.slice(-5))).toBeLessThanOrEqual(CAP);
});
