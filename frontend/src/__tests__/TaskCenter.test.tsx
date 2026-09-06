/** @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import TaskCenter from "@/components/tasks/TaskCenter";
import { toTaskViewModel } from "@/components/tasks/taskCenterModel";

const mocks = vi.hoisted(() => ({
  listTasks: vi.fn(),
  getTaskSummary: vi.fn(),
  getTask: vi.fn(),
  cancelTask: vi.fn(),
  retryTask: vi.fn(),
}));

vi.mock("@/lib/api", () => ({ api: mocks }));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => ({ failed: "失败", retry: "重试", cancel: "取消" })[key] ?? key,
}));

const failedJob = {
  id: "job-failed",
  workspace_id: "workspace-1",
  project_id: "project-1",
  episode_id: "episode-1",
  kind: "video",
  status: "failed",
  total: 2,
  succeeded: 1,
  failed: 1,
  canceled: 0,
  skipped: 0,
  items: [
    {
      id: "item-failed",
      job_id: "job-failed",
      workspace_id: "workspace-1",
      project_id: "project-1",
      episode_id: "episode-1",
      kind: "video",
      status: "failed",
      progress: 1,
      idempotency_key: "key-1",
      media_refs: [],
      error_code: "PROVIDER_TIMEOUT",
      error_message: "Provider timed out",
      payload: { frame_id: "frame-1" },
    },
  ],
};

const runningJob = {
  ...failedJob,
  id: "job-running",
  status: "processing",
  failed: 0,
  succeeded: 0,
  items: [{ ...failedJob.items[0], id: "item-running", status: "processing", progress: 0.45, error_code: null, error_message: null }],
};

describe("taskCenterModel", () => {
  it("maps a failed job to a recovery action and object target", () => {
    expect(toTaskViewModel(failedJob as never)).toMatchObject({
      status: "failed",
      action: "retry",
      progress: 50,
      objectRef: { projectId: "project-1", episodeId: "episode-1", frameId: "frame-1" },
    });
  });
});

describe("TaskCenter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listTasks.mockResolvedValue({ items: [failedJob], page: 1, page_size: 10, total: 1 });
    mocks.getTaskSummary.mockResolvedValue({ pending: 0, processing: 0, running: 0, succeeded: 1, failed: 1, canceled: 0, skipped: 0, total: 2 });
    mocks.getTask.mockResolvedValue({ job: failedJob, events: [] });
    mocks.cancelTask.mockResolvedValue({ ...runningJob, status: "canceled" });
    mocks.retryTask.mockResolvedValue({ ...failedJob, status: "processing" });
    vi.stubGlobal("confirm", vi.fn(() => true));
  });

  it("renders a failed task with a retry action", async () => {
    render(<TaskCenter workspaceId="workspace-1" onOpenObject={vi.fn()} onClose={vi.fn()} />);

    expect(await screen.findByText("PROVIDER_TIMEOUT")).toBeInTheDocument();
    expect(within(screen.getByRole("article")).getByText("失败")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));

    await waitFor(() => expect(mocks.retryTask).toHaveBeenCalledWith("job-failed", ["item-failed"]));
  });

  it("cancels a running task and opens its related object", async () => {
    mocks.listTasks.mockResolvedValue({ items: [runningJob], page: 1, page_size: 10, total: 1 });
    mocks.getTaskSummary.mockResolvedValue({ pending: 0, processing: 1, running: 1, succeeded: 0, failed: 0, canceled: 0, skipped: 0, total: 1 });
    const onOpenObject = vi.fn();
    render(<TaskCenter workspaceId="workspace-1" onOpenObject={onOpenObject} onClose={vi.fn()} />);

    expect(await screen.findByText("45%")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    await waitFor(() => expect(mocks.cancelTask).toHaveBeenCalledWith("job-running"));
    fireEvent.click(screen.getByRole("button", { name: "openTaskObject" }));
    expect(onOpenObject).toHaveBeenCalledWith(expect.objectContaining({ projectId: "project-1" }));
  });

  it("shows a clear empty state when no jobs exist", async () => {
    mocks.listTasks.mockResolvedValue({ items: [], page: 1, page_size: 10, total: 0 });
    render(<TaskCenter workspaceId="workspace-1" onOpenObject={vi.fn()} onClose={vi.fn()} />);

    expect(await screen.findByText("empty")).toBeInTheDocument();
  });

  it("lets the user retry after a transient task loading failure", async () => {
    mocks.listTasks
      .mockRejectedValueOnce(new Error("network unavailable"))
      .mockResolvedValueOnce({ items: [failedJob], page: 1, page_size: 10, total: 1 });
    render(<TaskCenter workspaceId="workspace-1" onOpenObject={vi.fn()} onClose={vi.fn()} />);

    expect(await screen.findByText("network unavailable")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));

    expect(await screen.findByText("PROVIDER_TIMEOUT")).toBeInTheDocument();
    expect(mocks.listTasks).toHaveBeenCalledTimes(2);
  });
});
