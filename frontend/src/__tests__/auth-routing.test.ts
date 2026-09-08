// @vitest-environment happy-dom
import axios from "axios";
import { describe, expect, it, vi } from "vitest";
import {
  isAuthenticationRecoveryError,
  isSafeReturnHash,
  resolveAuthApiUrl,
} from "@/lib/apiClient";

describe("authentication hash routing", () => {
  it("uses the independent site's CSRF cookie for JSON and streaming writes", async () => {
    vi.stubEnv("NEXT_PUBLIC_AUTH_COOKIE_PREFIX", "omni_studio_ui");
    vi.resetModules();
    document.cookie = "omni_studio_csrf=existing-site";
    document.cookie = "omni_studio_ui_csrf=new-site";
    const fetcher = vi.fn().mockResolvedValue(new Response("ok"));
    vi.stubGlobal("fetch", fetcher);
    try {
      const { apiClient: client, apiStreamRequest } = await import("@/lib/apiClient");
      await client.post("/projects", {}, { adapter: async config => {
        expect(config.headers.get("X-CSRF-Token")).toBe("new-site");
        return { data: {}, status: 200, statusText: "OK", headers: {}, config };
      } });
      await apiStreamRequest("/projects/example/storyboard/refine_batch", { method: "POST" });
      expect(fetcher.mock.calls[0][1].headers.get("X-CSRF-Token")).toBe("new-site");
    } finally {
      document.cookie = "omni_studio_csrf=; Max-Age=0";
      document.cookie = "omni_studio_ui_csrf=; Max-Age=0";
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });

  it("keeps development refresh requests on the refresh cookie path", () => {
    expect(resolveAuthApiUrl("/api-proxy")).toBe("");
    expect(resolveAuthApiUrl("http://127.0.0.1:17177")).toBe("http://127.0.0.1:17177");
  });

  it("does not remember public authentication pages as return targets", () => {
    expect(isSafeReturnHash("#/login")).toBe(false);
    expect(isSafeReturnHash("#/setup")).toBe(false);
    expect(isSafeReturnHash("#/reset-password")).toBe(false);
  });

  it("keeps protected workspace hashes as safe return targets", () => {
    expect(isSafeReturnHash("#/workspace")).toBe(true);
    expect(isSafeReturnHash("#/settings")).toBe(true);
  });

  it("recognizes failed session recovery without hiding normal permission errors", () => {
    const expiredSession = new axios.AxiosError(
      "Request failed with status code 403",
      "ERR_BAD_REQUEST",
      { url: "/auth/refresh" } as never,
      undefined,
      {
        status: 403,
        statusText: "Forbidden",
        headers: {},
        config: { url: "/auth/refresh" } as never,
        data: { error: { code: "AUTH_REFRESH_INVALID" } },
      },
    );
    const normalForbidden = new axios.AxiosError(
      "Request failed with status code 403",
      "ERR_BAD_REQUEST",
      { url: "/projects/project-1" } as never,
      undefined,
      {
        status: 403,
        statusText: "Forbidden",
        headers: {},
        config: { url: "/projects/project-1" } as never,
        data: { error: { code: "PROJECT_FORBIDDEN" } },
      },
    );

    expect(isAuthenticationRecoveryError(expiredSession)).toBe(true);
    expect(isAuthenticationRecoveryError(normalForbidden)).toBe(false);
  });
});
