import axios from "axios";
import { describe, expect, it } from "vitest";
import {
  isAuthenticationRecoveryError,
  isSafeReturnHash,
  resolveAuthApiUrl,
} from "@/lib/apiClient";

describe("authentication hash routing", () => {
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
