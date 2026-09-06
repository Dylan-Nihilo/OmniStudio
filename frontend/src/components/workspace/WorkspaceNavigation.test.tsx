import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import WorkspaceNavigation from "./WorkspaceNavigation";
import GlobalSidebar from "../layout/GlobalSidebar";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/components/collaboration/WorkspaceControls", () => ({ default: ({ children }: { children: (controls: ReactNode) => ReactNode }) => children(<button>switchWorkspace</button>) }));
vi.mock("@/components/auth/ChangePasswordDialog", () => ({ default: () => null }));
vi.mock("@/store/authStore", () => ({ useAuthStore: (select: (s: unknown) => unknown) => select({ user: { username: "artist" }, logout: vi.fn() }) }));

describe("workspace navigation", () => {
  it("groups only workspace pages under a disclosure and reopens it on entry", () => {
    const { rerender } = render(<WorkspaceNavigation active section="series" />);
    const summary = screen.getByText("title");
    const disclosure = summary.closest("details");
    expect(disclosure).toHaveAttribute("open");
    expect(screen.getByRole("link", { name: "series" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "overview" })).toHaveAttribute("href", "#/workspace");
    expect(screen.getByRole("link", { name: "projects" })).toHaveAttribute("href", "#/workspace/projects");
    expect(screen.getAllByRole("link")).toHaveLength(3);
    expect(summary).not.toHaveAttribute("aria-current");
    fireEvent.click(summary);
    expect(disclosure).not.toHaveAttribute("open");
    rerender(<WorkspaceNavigation active={false} section="series" />);
    expect(screen.queryByRole("link", { current: "page" })).not.toBeInTheDocument();
    rerender(<WorkspaceNavigation active section="drafts" />);
    expect(disclosure).toHaveAttribute("open");
    expect(screen.getByRole("link", { name: "projects" })).toHaveAttribute("aria-current", "page");
  });

  it("keeps global, context and account actions inside one sidebar", async () => {
    render(<GlobalSidebar activeTab="workspace" onTabChange={vi.fn()} workspaceSection="overview" />);
    const sidebar = screen.getByRole("complementary");
    expect(screen.getAllByRole("complementary")).toHaveLength(1);
    expect(sidebar).toContainElement(screen.getByRole("navigation", { name: "mainNavAria" }));
    expect(sidebar).toContainElement(screen.getByRole("link", { name: "overview" }));
    expect(sidebar).toContainElement(screen.getByRole("button", { name: "artist" }));
    fireEvent.click(screen.getByRole("button", { name: "artist" }));
    expect(screen.getByRole("button", { name: "switchWorkspace" })).toBeVisible();
    expect(screen.getByRole("button", { name: "changePassword" })).toBeVisible();
    expect(screen.getByRole("button", { name: "logout" })).toBeVisible();
    fireEvent.keyDown(screen.getByRole("dialog", { name: "artist" }), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("button", { name: "logout" })).not.toBeInTheDocument());
  });
});
