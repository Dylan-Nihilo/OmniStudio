/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/apiClient", () => ({
  API_URL: "/api-proxy",
  AUTH_API_URL: "",
  apiClient: { get: vi.fn(), post: vi.fn() },
  clearReturnHash: vi.fn(),
  refreshCsrfToken: vi.fn(),
}));

import { useAuthStore } from "@/store/authStore";

describe("auth session cleanup", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    useAuthStore.setState({
      user: { id: "user-1", username: "owner", email: "owner@example.com", display_name: null, created_at: "now" },
      activeWorkspace: { id: "workspace-1", name: "Workspace", slug: "workspace", role: "owner" },
      workspaces: [],
      legacyClaimPending: true,
    });
    localStorage.setItem("omni_studio.activeWorkspaceId", "workspace-1");
    sessionStorage.setItem("omni_studio.clientInstanceId", "client-1");
  });

  it("clears workspace and client identity when the session is cleared", async () => {
    useAuthStore.getState().clearSession();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(localStorage.getItem("omni_studio.activeWorkspaceId")).toBeNull();
    expect(sessionStorage.getItem("omni_studio.clientInstanceId")).toBeNull();
    expect(useAuthStore.getState().activeWorkspace).toBeNull();
    expect(useAuthStore.getState().user).toBeNull();
  });
});
