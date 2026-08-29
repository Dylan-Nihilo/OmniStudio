import { describe, expect, it } from "vitest";
import {
  getLogoutButtonClasses,
  getUserMenuLayerClasses,
  getUserMenuPopoverClasses,
} from "@/components/layout/GlobalSidebar";
import { getWarningToastClasses } from "@/components/shared/ToastContainer";

describe("GlobalSidebar user menu layering", () => {
  it("keeps the account popover above the app content layer", () => {
    expect(getUserMenuLayerClasses()).toContain("z-30");
  });

  it("uses an opaque elevated surface so settings text cannot show through", () => {
    const classes = getUserMenuPopoverClasses();
    expect(classes).toContain("bg-elevated");
    expect(classes).not.toContain("bg-surface/95");
    expect(classes).not.toContain("backdrop-blur");
  });

  it("uses the theme-aware failure color for a readable logout action", () => {
    const classes = getLogoutButtonClasses();
    expect(classes).toContain("text-status-failed-fg");
    expect(classes).toContain("hover:bg-status-failed-bg");
    expect(classes).not.toContain("text-red-300");
  });

  it("uses theme-aware warning colors for logout feedback", () => {
    const classes = getWarningToastClasses();
    expect(classes).toContain("bg-elevated");
    expect(classes).toContain("border-status-processing-border");
    expect(classes).toContain("text-foreground");
    expect(classes).not.toContain("text-status-processing-fg");
  });
});
