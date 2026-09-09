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
import { saveWorkspaceNavigationContext } from "@/lib/workspaceNavigationContext";

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
    localStorage.setItem("omni_studio.workspaceContext:user-1:workspace-1", "#/project/private#script");
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
    expect(localStorage.getItem("omni_studio.workspaceContext:user-1:workspace-1")).toBeNull();
    expect(sessionStorage.getItem("omni-studio.shot-drafts.v1")).toBeNull();
    expect(deleteDatabase).toHaveBeenCalledWith("scriptEditorCache");
    expect(useAuthStore.getState().activeWorkspace).toBeNull();
    expect(useAuthStore.getState().user).toBeNull();
  });

  it("restores the target Workspace project and pipeline step when switching", async () => {
    const workspaceA = { id: "workspace-1", name: "Workspace A", slug: "a", role: "owner" as const };
    const workspaceB = { id: "workspace-2", name: "Workspace B", slug: "b", role: "editor" as const };
    useAuthStore.setState({
      user: { id: "user-1", username: "owner", email: "owner@example.com", display_name: null, created_at: "now" },
      activeWorkspace: workspaceA,
      workspaces: [workspaceA, workspaceB],
    });
    window.location.hash = "#/project/episode-a#script";
    saveWorkspaceNavigationContext("user-1", "workspace-2", "#/series/series-b/episode/episode-b#assembly");

    await useAuthStore.getState().setActiveWorkspace("workspace-2");

    expect(window.location.hash).toBe("#/series/series-b/episode/episode-b#assembly");
  });
});
