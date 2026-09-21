import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PendingTaskAffordance } from "./PendingTaskAffordance";

const { healthCheck, diagnoseLogTail } = vi.hoisted(() => ({
  healthCheck: vi.fn(),
  diagnoseLogTail: vi.fn(),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) => values ? `${key}:${JSON.stringify(values)}` : key,
}));
vi.mock("@/lib/api", () => ({ api: { healthCheck, diagnoseLogTail } }));

beforeEach(() => {
  healthCheck.mockReset().mockResolvedValue({ studio_projects: 2, log_file: "/tmp/omni.log" });
  diagnoseLogTail.mockReset().mockResolvedValue({ lines: ["INFO task"], errors: [], returned_lines: 1, missing: false });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it("reveals actions immediately even when the clock advances during mount", () => {
  let now = 1_000;
  vi.spyOn(Date, "now").mockImplementation(() => now++);

  render(<PendingTaskAffordance statusLabel="生成中" revealAfterMs={0} onCancel={vi.fn()} />);

  expect(screen.getByRole("button", { name: "cancel" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "diagnose" })).toBeInTheDocument();
  expect(screen.getByText("0s")).toBeInTheDocument();
});

it.each([undefined, 4])("reveals actions at the threshold with createdAt=%s", (createdAt) => {
  vi.useFakeTimers();
  vi.setSystemTime(5_000);
  render(<PendingTaskAffordance statusLabel="生成中" createdAt={createdAt} revealAfterMs={2_000} onCancel={vi.fn()} />);

  const remainingMs = createdAt === undefined ? 2_000 : 1_000;
  expect(screen.queryByRole("button", { name: "cancel" })).not.toBeInTheDocument();
  act(() => vi.advanceTimersByTime(remainingMs - 1));
  expect(screen.queryByRole("button", { name: "cancel" })).not.toBeInTheDocument();
  act(() => vi.advanceTimersByTime(1));
  expect(screen.getByRole("button", { name: "cancel" })).toBeInTheDocument();
  expect(screen.getByText("2s")).toBeInTheDocument();
});

it("reveals recoverable actions, keeps the failure visible, and opens a localized diagnosis dialog", async () => {
  const onCancel = vi.fn().mockRejectedValue(new Error("provider still running"));
  render(<PendingTaskAffordance statusLabel="生成中" revealAfterMs={0} taskId="task-1" onCancel={onCancel} />);

  fireEvent.click(screen.getByRole("button", { name: "cancel" }));
  await waitFor(() => expect(onCancel).toHaveBeenCalledOnce());
  expect(await screen.findByText("provider still running")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "diagnose" }));
  expect(await screen.findByRole("dialog", { name: "title" })).toBeInTheDocument();
  await waitFor(() => expect(healthCheck).toHaveBeenCalledOnce());
  expect(await screen.findByText(/reachable/)).toBeInTheDocument();
  expect(diagnoseLogTail).toHaveBeenCalledWith(200);
  fireEvent.click(screen.getByRole("button", { name: "close" }));
  expect(screen.queryByRole("dialog", { name: "title" })).not.toBeInTheDocument();
});
