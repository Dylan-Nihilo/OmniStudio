const CHUNK_RECOVERY_KEY = "lumenx:chunk-recovery";
const CHUNK_RECOVERY_WINDOW_MS = 30_000;

export interface ChunkRecoveryRuntime {
  href: string;
  now: () => number;
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
  reload: () => void;
}

interface ChunkRecoveryAttempt {
  signature: string;
  timestamp: number;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  return typeof error === "string" ? error : "";
}

export function isChunkLoadError(error: unknown): boolean {
  const message = getErrorMessage(error);
  return (
    message.includes("ChunkLoadError") ||
    /Loading chunk\s+.+\s+failed/i.test(message) ||
    /Failed to fetch dynamically imported module/i.test(message)
  );
}

function getChunkSignature(error: unknown, href: string): string {
  const message = getErrorMessage(error);
  const chunkUrl = message.match(/https?:\/\/[^\s)]+/i)?.[0];
  return `${href}|${chunkUrl ?? message}`;
}

function readAttempt(runtime: ChunkRecoveryRuntime): ChunkRecoveryAttempt | null {
  try {
    const raw = runtime.getItem(CHUNK_RECOVERY_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ChunkRecoveryAttempt>;
    if (typeof parsed.signature !== "string" || typeof parsed.timestamp !== "number") {
      return null;
    }
    return { signature: parsed.signature, timestamp: parsed.timestamp };
  } catch {
    return null;
  }
}

function browserRuntime(): ChunkRecoveryRuntime | null {
  if (typeof window === "undefined") return null;
  return {
    href: window.location.href,
    now: () => Date.now(),
    getItem: (key) => window.sessionStorage.getItem(key),
    setItem: (key, value) => window.sessionStorage.setItem(key, value),
    removeItem: (key) => window.sessionStorage.removeItem(key),
    reload: () => window.location.reload(),
  };
}

function clearRecoveryAttempt(runtime: ChunkRecoveryRuntime | null): void {
  if (!runtime) return;
  try {
    runtime.removeItem(CHUNK_RECOVERY_KEY);
  } catch {
    // sessionStorage may be unavailable in hardened browser contexts.
  }
}

/**
 * Recovers once from stale Next.js dynamic-import URLs after a dev-server restart,
 * branch switch, or rolling deployment. A matching second failure is surfaced so
 * a genuine compile error cannot create an infinite reload loop.
 */
export function withChunkLoadRecovery<T>(
  loader: () => Promise<T>,
  runtime: ChunkRecoveryRuntime | null = browserRuntime(),
): Promise<T> {
  return loader()
    .then((module) => {
      clearRecoveryAttempt(runtime);
      return module;
    })
    .catch((error: unknown) => {
      if (!runtime || !isChunkLoadError(error)) {
        throw error;
      }

      const now = runtime.now();
      const signature = getChunkSignature(error, runtime.href);
      const previous = readAttempt(runtime);
      const alreadyRetried =
        previous?.signature === signature &&
        now - previous.timestamp < CHUNK_RECOVERY_WINDOW_MS;

      if (alreadyRetried) {
        clearRecoveryAttempt(runtime);
        throw error;
      }

      try {
        runtime.setItem(
          CHUNK_RECOVERY_KEY,
          JSON.stringify({ signature, timestamp: now } satisfies ChunkRecoveryAttempt),
        );
      } catch {
        // Reload recovery still works when sessionStorage is unavailable.
      }

      runtime.reload();
      return new Promise<T>(() => undefined);
    });
}
