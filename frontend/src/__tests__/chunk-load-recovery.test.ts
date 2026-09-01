import { describe, expect, it, vi } from "vitest";

import {
  isChunkLoadError,
  type ChunkRecoveryRuntime,
  withChunkLoadRecovery,
} from "@/lib/chunkLoadRecovery";

function createRuntime() {
  const values = new Map<string, string>();
  const reload = vi.fn();
  let now = 1_000;
  const runtime: ChunkRecoveryRuntime = {
    href: "http://localhost:3008/#/settings",
    now: () => now,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
    reload,
  };

  return { runtime, reload, values, setNow: (value: number) => { now = value; } };
}

describe("chunk load recovery", () => {
  it("recognizes Next.js and native dynamic-import chunk failures", () => {
    expect(isChunkLoadError(new Error("ChunkLoadError: Loading chunk settings failed."))).toBe(true);
    expect(isChunkLoadError(new Error("Failed to fetch dynamically imported module"))).toBe(true);
    expect(isChunkLoadError(new Error("validation failed"))).toBe(false);
  });

  it("reloads once when a stale dynamic chunk cannot be loaded", async () => {
    const { runtime, reload, values } = createRuntime();
    const error = new Error(
      "ChunkLoadError: Loading chunk settings failed. (error: http://localhost:3008/_next/static/chunks/settings.js)",
    );

    void withChunkLoadRecovery(() => Promise.reject(error), runtime);
    await Promise.resolve();
    await Promise.resolve();

    expect(reload).toHaveBeenCalledOnce();
    expect(values.size).toBe(1);
  });

  it("surfaces a repeated matching failure instead of reloading forever", async () => {
    const { runtime, reload } = createRuntime();
    const error = new Error("ChunkLoadError: Loading chunk settings failed.");

    void withChunkLoadRecovery(() => Promise.reject(error), runtime);
    await Promise.resolve();
    await Promise.resolve();

    await expect(withChunkLoadRecovery(() => Promise.reject(error), runtime)).rejects.toBe(error);
    expect(reload).toHaveBeenCalledOnce();
  });

  it("clears a previous recovery marker after the module loads", async () => {
    const { runtime, values } = createRuntime();
    values.set("omni_studio:chunk-recovery", "stale");

    await expect(withChunkLoadRecovery(() => Promise.resolve({ default: "ok" }), runtime))
      .resolves.toEqual({ default: "ok" });
    expect(values.size).toBe(0);
  });

  it("surfaces the chunk error when session storage cannot record a retry", async () => {
    const error = new Error("ChunkLoadError: Loading chunk settings failed.");
    const reload = vi.fn();
    const runtime: ChunkRecoveryRuntime = {
      href: "http://localhost:3008/#/settings",
      now: () => 1_000,
      getItem: () => { throw new Error("storage unavailable"); },
      setItem: () => { throw new Error("storage unavailable"); },
      removeItem: () => undefined,
      reload,
    };

    await expect(withChunkLoadRecovery(() => Promise.reject(error), runtime)).rejects.toBe(error);
    expect(reload).not.toHaveBeenCalled();
  });
});
