import { apiStreamRequest } from "@/lib/apiClient";

/**
 * Download a file in ranges, retrying each range on its own.
 *
 * A finished episode is tens of megabytes and one long response has to survive the whole
 * transfer. On a link that cuts out after a hundred kilobytes it never does: the server
 * answered with the full 40 MB every time and the connection died after ~77–141 KB, so the
 * download failed with nothing to resume and nothing to show. Asking for the file a piece
 * at a time turns those short bursts — which the link manages fine — into a complete file,
 * and a piece that fails costs one retry instead of the whole download.
 *
 * `/files` reports `Accept-Ranges: bytes` and serves ranges correctly, which is what makes
 * this possible.
 */
export const DEFAULT_CHUNK_BYTES = 2 * 1024 * 1024;
/** Floor for the adaptive size; below this the request overhead dominates. */
export const MIN_CHUNK_BYTES = 32 * 1024;

export interface ChunkedDownloadOptions {
    chunkBytes?: number;
    attemptsPerChunk?: number;
    /** Fraction between 0 and 1, called as each piece lands. */
    onProgress?: (received: number, total: number) => void;
    signal?: AbortSignal;
}

async function fetchRange(url: string, start: number, end: number, signal?: AbortSignal): Promise<Blob> {
    const response = await apiStreamRequest(url, { headers: { Range: `bytes=${start}-${end}` }, signal });
    if (response.status !== 206 && response.status !== 200) {
        throw new Error(`HTTP ${response.status}`);
    }
    return response.blob();
}

/** Total size of the file, read from a one-byte range so no body is transferred. */
export async function probeSize(url: string, signal?: AbortSignal): Promise<number | null> {
    const response = await apiStreamRequest(url, { headers: { Range: "bytes=0-0" }, signal });
    if (!response.ok && response.status !== 206) throw new Error(`HTTP ${response.status}`);
    const range = response.headers.get("content-range");          // e.g. "bytes 0-0/39928919"
    const total = range?.split("/")[1];
    const size = total ? Number(total) : Number(response.headers.get("content-length"));
    return Number.isFinite(size) && size > 0 ? size : null;
}

export async function downloadInChunks(
    url: string,
    { chunkBytes = DEFAULT_CHUNK_BYTES, attemptsPerChunk = 3, onProgress, signal }: ChunkedDownloadOptions = {},
): Promise<Blob> {
    const total = await probeSize(url, signal);
    if (!total) {
        // No size to divide up, so there is nothing to be gained by splitting it.
        const response = await apiStreamRequest(url, { signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.blob();
    }

    const pieces: Blob[] = [];
    let received = 0;
    // Shrinks when a range will not come down and stays shrunk. The link this was reported
    // from cuts every response at exactly 77,268 bytes whatever is asked for — a fixed cap,
    // not a flaky connection — so no amount of retrying at 2 MB would ever have worked, but
    // anything under the cap goes through. Starting large keeps a healthy link fast.
    let size = Math.max(MIN_CHUNK_BYTES, chunkBytes);
    while (received < total) {
        const end = Math.min(received + size, total) - 1;
        let piece: Blob | null = null;
        for (let attempt = 0; attempt < attemptsPerChunk && !piece; attempt += 1) {
            if (signal?.aborted) throw new Error("下载已取消");
            try {
                const fetched = await fetchRange(url, received, end, signal);
                // A short read is the cap showing itself; treat it as a failure so the
                // size comes down, rather than stitching a file full of holes.
                if (fetched.size === end - received + 1) piece = fetched;
            } catch {
                // Falls through to the backoff and the halving below.
            }
            if (!piece) await new Promise(resolve => setTimeout(resolve, 200 * (attempt + 1)));
        }
        if (!piece) {
            if (size > MIN_CHUNK_BYTES) {
                size = Math.max(MIN_CHUNK_BYTES, Math.floor(size / 4));
                continue;                       // same offset, smaller bite
            }
            const done = Math.round((received / total) * 100);
            throw new Error(`下载中断（已完成 ${done}%），请重试`);
        }
        pieces.push(piece);
        received += piece.size;
        onProgress?.(received, total);
    }
    return new Blob(pieces, { type: "video/mp4" });
}
