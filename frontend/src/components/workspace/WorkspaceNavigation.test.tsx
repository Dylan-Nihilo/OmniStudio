import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import WorkspaceNavigation from "./WorkspaceNavigation";
import GlobalSidebar from "../layout/GlobalSidebar";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/components/collaboration/WorkspaceControls", () => ({ default: () => <button>switchWorkspace</button> }));
vi.mock("@/components/auth/ChangePasswordDialog", () => ({ default: () => null }));
vi.mock("@/store/authStore", () => ({ useAuthStore: (select: (s: unknown) => unknown) => select({ user: { username: "artist" }, logout: vi.fn() }) }));

describe("workspace navigation", () => {
  it("keeps the selected section and project/asset routes distinct", () => {
    render(<WorkspaceNavigation section="series" />);
    expect(screen.getByRole("link", { name: "series" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "overview" })).toHaveAttribute("href", "#/workspace");
    expect(screen.getByRole("link", { name: "projects" })).toHaveAttribute("href", "#/workspace/projects");
    expect(screen.getByRole("link", { name: "assets" })).toHaveAttribute("href", "#/library");
  });

  it("keeps global, context and account actions inside one sidebar", () => {
    render(<GlobalSidebar activeTab="workspace" onTabChange={vi.fn()} context={<WorkspaceNavigation section="overview" />} />);
    const sidebar = screen.getByRole("complementary");
    expect(screen.getAllByRole("complementary")).toHaveLength(1);
    expect(sidebar).toContainElement(screen.getByRole("navigation", { name: "mainNavAria" }));
    expect(sidebar).toContainElement(screen.getByRole("link", { name: "overview" }));
    expect(sidebar).toContainElement(screen.getByRole("button", { name: "artist" }));
    fireEvent.click(screen.getByRole("button", { name: "artist" }));
    expect(screen.getByRole("button", { name: "switchWorkspace" })).toBeVisible();
    expect(screen.getByRole("button", { name: "changePassword" })).toBeVisible();
    expect(screen.getByRole("button", { name: "logout" })).toBeVisible();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("button", { name: "logout" })).not.toBeInTheDocument();
  });
});
