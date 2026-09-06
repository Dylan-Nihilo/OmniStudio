import { beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();
const post = vi.fn();

vi.mock("@/lib/apiClient", () => ({
  API_URL: "/api-proxy",
  AUTH_API_URL: "/auth-proxy",
  apiClient: { get, post },
}));

describe("unified task API client", () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
  });

  it("lists jobs with filters and returns the API envelope", async () => {
    const response = { items: [], page: 2, page_size: 10, total: 0 };
    get.mockResolvedValue({ data: response });
    const { api } = await import("@/lib/api");

    await expect(api.listTasks({ project_id: "project-1", status: "failed", page: 2, page_size: 10 })).resolves.toEqual(response);
    expect(get).toHaveBeenCalledWith("/api-proxy/tasks", {
      params: { project_id: "project-1", status: "failed", page: 2, page_size: 10 },
    });
  });

  it("keeps task detail, cancel, retry, and summary on the unified endpoints", async () => {
    get.mockResolvedValue({ data: { job: { id: "job-1" }, events: [] } });
    post.mockResolvedValue({ data: { id: "job-1" } });
    const { api } = await import("@/lib/api");

    await api.getTask("job-1");
    await api.cancelTask("job-1");
    await api.retryTask("job-1", ["item-1"]);
    await api.getTaskSummary({ episode_id: "episode-1" });

    expect(get).toHaveBeenNthCalledWith(1, "/api-proxy/tasks/job-1");
    expect(post).toHaveBeenNthCalledWith(1, "/api-proxy/tasks/job-1/cancel");
    expect(post).toHaveBeenNthCalledWith(2, "/api-proxy/tasks/job-1/retry", { item_ids: ["item-1"] });
    expect(get).toHaveBeenNthCalledWith(2, "/api-proxy/tasks/summary", { params: { episode_id: "episode-1" } });
  });
});
