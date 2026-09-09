/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it } from "vitest";
import {
  clearWorkspaceNavigationContexts,
  loadWorkspaceNavigationContext,
  saveWorkspaceNavigationContext,
} from "@/lib/workspaceNavigationContext";

describe("workspace navigation context", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("keeps the latest project, episode, and pipeline step per Workspace", () => {
    saveWorkspaceNavigationContext("user-1", "workspace-a", "#/project/episode-a#storyboard_r2v");
    saveWorkspaceNavigationContext("user-1", "workspace-b", "#/series/series-b/episode/episode-b#assembly");

    expect(loadWorkspaceNavigationContext("user-1", "workspace-a")).toBe("#/project/episode-a#storyboard_r2v");
    expect(loadWorkspaceNavigationContext("user-1", "workspace-b")).toBe("#/series/series-b/episode/episode-b#assembly");
    expect(loadWorkspaceNavigationContext("user-2", "workspace-a")).toBeNull();
  });

  it("does not persist login or external routes", () => {
    saveWorkspaceNavigationContext("user-1", "workspace-a", "#/login");
    saveWorkspaceNavigationContext("user-1", "workspace-b", "https://example.com");

    expect(loadWorkspaceNavigationContext("user-1", "workspace-a")).toBeNull();
    expect(loadWorkspaceNavigationContext("user-1", "workspace-b")).toBeNull();
  });

  it("can clear every private context on logout", () => {
    saveWorkspaceNavigationContext("user-1", "workspace-a", "#/project/episode-a#script");
    saveWorkspaceNavigationContext("user-1", "workspace-b", "#/tasks");

    clearWorkspaceNavigationContexts();

    expect(loadWorkspaceNavigationContext("user-1", "workspace-a")).toBeNull();
    expect(loadWorkspaceNavigationContext("user-1", "workspace-b")).toBeNull();
  });
});
