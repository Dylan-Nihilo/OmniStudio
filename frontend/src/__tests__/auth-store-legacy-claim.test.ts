/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { get, post, refreshCsrfToken } = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  refreshCsrfToken: vi.fn(),
}));

vi.mock("@/lib/apiClient", () => ({
  API_URL: "/api-proxy",
  AUTH_API_URL: "",
  apiClient: { get, post },
  clearReturnHash: vi.fn(),
  refreshCsrfToken,
}));

import { useAuthStore } from "@/store/authStore";

const user = {
  id: "owner-1",
  username: "owner",
  email: "owner@example.com",
  display_name: null,
  created_at: "2026-08-29T00:00:00Z",
};

const claimStatus = {
  state: "ready",
  source_sha256: "a".repeat(64),
  source_files: [],
  summary: { projects: 1, series: 1, media: 1, conflicts: 0 },
  diagnostics: [],
  rollback_available: false,
  batch: null,
};

describe("authStore legacy claim discovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useAuthStore.setState({
      initialized: true,
      setupStatus: {
        initialized: true,
        setup_allowed: false,
        setup_token_required: false,
      },
      user: null,
      bootstrapping: false,
      legacyClaimPending: false,
      legacyClaimAcknowledged: false,
    });
    post.mockResolvedValue({ data: { user } });
    get.mockResolvedValue({ data: claimStatus });
  });

  it("opens the claim gate when an existing owner logs into unclaimed data", async () => {
    await useAuthStore.getState().login({
      identifier: "owner",
      password: "demo password",
    });

    expect(post).toHaveBeenCalledWith("/auth/login", {
      identifier: "owner",
      password: "demo password",
    });
    expect(get).toHaveBeenCalledWith("/auth/legacy-claim/status");
    expect(useAuthStore.getState().legacyClaimPending).toBe(true);
  });

  it("does not reopen the claim gate after the owner acknowledges it", async () => {
    useAuthStore.getState().finishLegacyClaim();

    await useAuthStore.getState().login({
      identifier: "owner",
      password: "demo password",
    });

    expect(get).toHaveBeenCalledWith("/auth/legacy-claim/status");
    expect(useAuthStore.getState().legacyClaimPending).toBe(false);
  });

  it("refreshes the pre-auth CSRF cookie and retries a CSRF-failed login once", async () => {
    const csrfFailure = Object.assign(new Error("csrf"), {
      response: { status: 403, data: { error: { code: "AUTH_CSRF_FAILED" } } },
    });
    post.mockRejectedValueOnce(csrfFailure).mockResolvedValueOnce({ data: { user } });

    await useAuthStore.getState().login({
      identifier: "owner",
      password: "demo password",
    });

    expect(refreshCsrfToken).toHaveBeenCalledTimes(2);
    expect(post).toHaveBeenCalledTimes(2);
    expect(post).toHaveBeenNthCalledWith(1, "/auth/login", {
      identifier: "owner",
      password: "demo password",
    });
    expect(post).toHaveBeenNthCalledWith(2, "/auth/login", {
      identifier: "owner",
      password: "demo password",
    });
    expect(useAuthStore.getState().user).toEqual(user);
  });
});
