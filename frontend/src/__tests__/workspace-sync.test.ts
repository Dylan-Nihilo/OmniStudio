import { describe, expect, it } from "vitest";
import { isWorkspaceRoute } from "@/lib/workspaceSync";

describe("workspace route refresh", () => {
  it("recognizes the home hashes that should refresh workspace data", () => {
    expect(isWorkspaceRoute("#/"), "root hash").toBe(true);
    expect(isWorkspaceRoute("#/workspace"), "workspace hash").toBe(true);
    expect(isWorkspaceRoute(""), "empty hash").toBe(true);
    expect(isWorkspaceRoute("#/new-project"), "new project handoff").toBe(true);
    expect(isWorkspaceRoute("#/series/series-1"), "series detail").toBe(false);
  });
});
