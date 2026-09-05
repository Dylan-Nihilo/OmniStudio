import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { Project } from "@/store/projectStore";
import WorkspaceOverview from "./WorkspaceOverview";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string, values?: Record<string, unknown>) => values ? `${key}:${JSON.stringify(values)}` : key }));
vi.mock("@/store/authStore", () => ({ useAuthStore: (select: (state: unknown) => unknown) => select({ user: { username: "artist" } }) }));
vi.mock("@/store/settingsStore", () => ({ useSettingsStore: (select: (state: unknown) => unknown) => select({ locale: "zh" }) }));
const actions = { onRefresh: vi.fn(), onCreate: vi.fn(), onCreateSeries: vi.fn(), onImport: vi.fn(), onDelete: vi.fn() };

it("shows real progress and routes, preserves creation actions and distinguishes failed loading from an empty workspace", () => {
  const { rerender } = render(<WorkspaceOverview {...actions} projects={[]} series={[]} loading={false} error={false} />);
  fireEvent.click(screen.getByRole("button", { name: "newSeries" }));
  expect(actions.onCreateSeries).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "import" }));
  expect(actions.onImport).toHaveBeenCalledOnce();
  expect(screen.getByText("emptyTitle")).toBeVisible();
  rerender(<WorkspaceOverview {...actions} projects={[]} series={[]} loading={false} error />);
  expect(screen.queryByText("emptyTitle")).not.toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent("loadFailed");
  fireEvent.click(screen.getByRole("button", { name: "retry" }));
  expect(actions.onRefresh).toHaveBeenCalledOnce();
  const project = { id: "episode", title: "Story", series_id: "series", frames: [{ id: "shot" }], video_tasks: [{ id: "job", status: "processing" }] } as Project;
  rerender(<WorkspaceOverview {...actions} projects={[project]} series={[]} loading={false} error={false} />);
  expect(screen.getByRole("link", { name: "viewQueue" })).toHaveAttribute("href", "#/series/series/episode/episode");
  expect(screen.getByText('queued:{"count":1}')).toBeVisible();
  expect(screen.getByText("notStarted")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "moreActions" }));
  expect(screen.getByRole("menuitem", { name: "delete" })).toBeVisible();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
});
