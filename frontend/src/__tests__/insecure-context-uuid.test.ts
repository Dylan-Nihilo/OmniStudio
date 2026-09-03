/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/apiClient", () => ({
  API_URL: "/api-proxy",
  CLIENT_INSTANCE_KEY: "omni_studio.clientInstanceId",
  apiClient: { post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

describe("insecure browser context", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("loads collaboration state when crypto.randomUUID is unavailable", async () => {
    sessionStorage.clear();
    vi.stubGlobal("crypto", {
      getRandomValues: (values: Uint8Array) => values.fill(0xab),
    });

    const { useEditLeaseStore } = await import("@/store/editLeaseStore");

    expect(useEditLeaseStore.getState().clientInstanceId).toBe(
      "abababab-abab-4bab-abab-abababababab",
    );
  });
});
