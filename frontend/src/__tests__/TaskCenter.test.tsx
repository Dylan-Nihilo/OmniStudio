/** @vitest-environment happy-dom */

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TaskCenter from "@/components/tasks/TaskCenter";
import { taskObjectHash, toTaskViewModel } from "@/components/tasks/taskCenterModel";

const mocks = vi.hoisted(() => ({
  listTasks: vi.fn(),
  getTaskSummary: vi.fn(),
  getTask: vi.fn(),
  cancelTask: vi.fn(),
  retryTask: vi.fn(),
}));

vi.mock("@/lib/api", () => ({ api: mocks }));
const t = vi.hoisted(() => (key: string) => ({ failed: "失败", retry: "重试", cancel: "取消" })[key] ?? key);
vi.mock("next-intl", () => ({ useTranslations: () => t }));

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

  it("maps Playground jobs to the Playground object target", () => {
    const playgroundJob = {
      ...failedJob,
      id: "job-playground",
      project_id: null,
      episode_id: null,
      kind: "playground.t2i",
      items: [{ ...failedJob.items[0], kind: "t2i", payload: { generation_id: "generation-1" } }],
    };
    expect(toTaskViewModel(playgroundJob as never).objectRef).toEqual({
      view: "playground",
      generationId: "generation-1",
    });
    expect(taskObjectHash({ view: "playground", generationId: "generation-1" })).toBe("#/playground");
  });

  it("maps source analysis jobs back to the Source workspace", () => {
    const sourceJob = {
      ...failedJob,
      id: "job-source-analysis",
      project_id: null,
      episode_id: null,
      kind: "production.source_analysis",
      items: [{ ...failedJob.items[0], kind: "source_analysis", payload: { source_document_id: "source-1", batch_id: "batch-1" } }],
    };
    expect(toTaskViewModel(sourceJob as never).objectRef).toEqual({ view: "sources", sourceId: "source-1", batchId: "batch-1" });
    expect(taskObjectHash({ view: "sources", sourceId: "source-1", batchId: "batch-1" })).toBe("#/sources");
  });
});

describe("TaskCenter", () => {
  afterEach(() => vi.useRealTimers());

  it("retains the task after retry failure and resumes polling when a later retry starts work", async () => {
    render(<TaskCenter workspaceId="workspace-1" onOpenObject={vi.fn()} onClose={vi.fn()} />);
    await screen.findByText("PROVIDER_TIMEOUT");
    mocks.retryTask.mockRejectedValueOnce(new Error("Retry unavailable"));
    fireEvent.click(screen.getByRole("button", {name:"重试"}));
    expect(await screen.findByRole("alert")).toHaveTextContent("Retry unavailable");
    expect(screen.getByText("PROVIDER_TIMEOUT")).toBeInTheDocument();
    mocks.listTasks.mockResolvedValue({items:[runningJob], total:1});
    mocks.getTaskSummary.mockResolvedValue({running:1, failed:0, succeeded:0, total:1});
    vi.useFakeTimers();
    await act(async () => fireEvent.click(screen.getByRole("button", {name:"重试"})));
    const calls = mocks.listTasks.mock.calls.length;
    await act(async () => vi.advanceTimersByTimeAsync(5000));
    expect(mocks.listTasks).toHaveBeenCalledTimes(calls + 1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("ignores task results arriving from the previous workspace", async () => {
    let finish!: (value: object) => void;
    mocks.listTasks.mockReturnValueOnce(new Promise(resolve => {finish = resolve;})).mockResolvedValue({items:[],total:0});
    const view = render(<TaskCenter workspaceId="workspace-1" onOpenObject={vi.fn()} onClose={vi.fn()} />);
    view.rerender(<TaskCenter workspaceId="workspace-2" onOpenObject={vi.fn()} onClose={vi.fn()} />);
    await screen.findByText("empty");
    await act(async () => finish({items:[failedJob],total:1}));
    expect(screen.queryByText("PROVIDER_TIMEOUT")).not.toBeInTheDocument();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listTasks.mockResolvedValue({ items: [failedJob], page: 1, page_size: 10, total: 1 });
    mocks.getTaskSummary.mockResolvedValue({ pending: 0, processing: 0, running: 0, succeeded: 1, failed: 1, canceled: 0, skipped: 0, total: 2 });
    mocks.getTask.mockResolvedValue({ job: failedJob, events: [] });
    mocks.cancelTask.mockResolvedValue({ ...runningJob, status: "canceled" });
    mocks.retryTask.mockResolvedValue({ ...failedJob, status: "processing" });
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
    expect(mocks.cancelTask).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", {name:"confirmCancelAction"}));
    await waitFor(() => expect(mocks.cancelTask).toHaveBeenCalledWith("job-running"));
    fireEvent.click(screen.getByRole("button", { name: "openObject" }));
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

describe("what a task row is allowed to say", () => {
  const providerFailure = {
    ...failedJob,
    id: "job-leaky",
    project_title: "斗破苍穹 第一集",
    kind: "production.video",
    credits_spent: 45,
    items: [{
      ...failedJob.items[0],
      id: "item-leaky",
      error_code: "PROVIDER_FAILED",
      // The kind of text that actually comes back: a vendor's own wording, its endpoint,
      // and the model we bought capacity on.
      error_message: "451 from https://open302.com/v1/images/generations: gpt-image-2 refused",
      started_at: 1_700_000_000,
      finished_at: 1_700_000_060,
    }],
  };

  it("never puts the provider's own words on screen", async () => {
    mocks.listTasks.mockResolvedValue({ items: [providerFailure], page: 1, page_size: 20, total: 1 });
    mocks.getTaskSummary.mockResolvedValue({ pending: 0, processing: 0, succeeded: 0, failed: 1, canceled: 0, skipped: 0 });
    await act(async () => { render(<TaskCenter isOpen onClose={vi.fn()} />); });

    await waitFor(() => expect(mocks.listTasks).toHaveBeenCalled());
    const body = document.body.textContent ?? "";
    for (const leak of ["open302", "gpt-image-2", "PROVIDER_FAILED", "https://", "refused"]) {
      expect(body).not.toContain(leak);
    }
    // ...and it does say something, rather than failing silently.
    expect(body).toContain("reasonGenerationFailed");
  });

  it("labels the row by project and a readable task name", async () => {
    mocks.listTasks.mockResolvedValue({ items: [providerFailure], page: 1, page_size: 20, total: 1 });
    mocks.getTaskSummary.mockResolvedValue({ pending: 0, processing: 0, succeeded: 0, failed: 1, canceled: 0, skipped: 0 });
    await act(async () => { render(<TaskCenter isOpen onClose={vi.fn()} />); });

    await waitFor(() => expect(mocks.listTasks).toHaveBeenCalled());
    const body = document.body.textContent ?? "";
    expect(body).toContain("斗破苍穹 第一集");
    expect(body).toContain("kindVideo");
    // The internal kind string and the id fragment are what this replaced.
    expect(body).not.toContain("production.video");
    expect(body).not.toContain("job-leaky");
  });

  it("shows what the task cost", async () => {
    const charged = { ...providerFailure, id: "job-charged", status: "succeeded", failed: 0,
                      succeeded: 2, credits_spent: 45,
                      items: [{ ...providerFailure.items[0], status: "succeeded",
                                error_code: null, error_message: null }] };
    mocks.listTasks.mockResolvedValue({ items: [charged], page: 1, page_size: 20, total: 1 });
    mocks.getTaskSummary.mockResolvedValue({ pending: 0, processing: 0, succeeded: 1, failed: 0, canceled: 0, skipped: 0 });
    await act(async () => { render(<TaskCenter isOpen onClose={vi.fn()} />); });

    await waitFor(() => expect(mocks.listTasks).toHaveBeenCalled());
    expect(document.body.textContent).toContain("creditsSpent");
    expect(document.body.textContent).toContain("45");
  });

  it("reads the times off the items", () => {
    const view = toTaskViewModel(providerFailure as never);
    expect(view.startedAt).toBe(1_700_000_000);
    expect(view.finishedAt).toBe(1_700_000_060);
    expect(view.creditsSpent).toBe(45);
    expect(view.projectTitle).toBe("斗破苍穹 第一集");
  });

  it("does not claim a finish time while an item is still running", () => {
    const halfDone = {
      ...providerFailure,
      items: [
        { ...providerFailure.items[0], started_at: 100, finished_at: 200 },
        { ...providerFailure.items[0], id: "item-2", started_at: 150, finished_at: null },
      ],
    };
    const view = toTaskViewModel(halfDone as never);
    expect(view.startedAt).toBe(100);
    expect(view.finishedAt).toBeNull();
  });
});
