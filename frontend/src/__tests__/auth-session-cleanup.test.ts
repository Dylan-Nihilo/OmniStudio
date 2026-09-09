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
    localStorage.setItem("project-storage:user-1:workspace-1", JSON.stringify({ currentProject: { id: "private" } }));
    localStorage.setItem("omni_studio.script-editor.dismissed-cache:private", "123");
    localStorage.setItem("omni_studio.script-editor.last-project", "private");
    localStorage.setItem("omni_studio_default_model_settings", JSON.stringify({ t2i_model: "private-model" }));
    localStorage.setItem("omni_studio_default_prompt_config", JSON.stringify({ storyboard_polish: "private-prompt" }));
    localStorage.setItem("omni_studio:playground:featured", JSON.stringify({ generation: "private-output" }));
    sessionStorage.setItem("omni-studio.shot-drafts.v1", JSON.stringify({ private: { projectId: "private" } }));
  });

  it("clears workspace and client identity when the session is cleared", async () => {
    const deleteDatabase = vi.fn();
    Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: { deleteDatabase } });
    useAuthStore.getState().clearSession();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(localStorage.getItem("omni_studio.activeWorkspaceId")).toBeNull();
    expect(sessionStorage.getItem("omni_studio.clientInstanceId")).toBeNull();
    expect(localStorage.getItem("project-storage:user-1:workspace-1")).toBeNull();
    expect(localStorage.getItem("omni_studio.script-editor.dismissed-cache:private")).toBeNull();
    expect(localStorage.getItem("omni_studio.script-editor.last-project")).toBeNull();
    expect(localStorage.getItem("omni_studio_default_model_settings")).toBeNull();
    expect(localStorage.getItem("omni_studio_default_prompt_config")).toBeNull();
    expect(localStorage.getItem("omni_studio:playground:featured")).toBeNull();
    expect(sessionStorage.getItem("omni-studio.shot-drafts.v1")).toBeNull();
    expect(deleteDatabase).toHaveBeenCalledWith("scriptEditorCache");
    expect(useAuthStore.getState().activeWorkspace).toBeNull();
    expect(useAuthStore.getState().user).toBeNull();
  });
});
