import { beforeEach, describe, expect, it, vi } from "vitest";

const post = vi.fn();
const get = vi.fn();

vi.mock("@/lib/apiClient", () => ({
  API_URL: "/api-proxy",
  AUTH_API_URL: "/auth-proxy",
  apiClient: { get, post },
}));

describe("cast generation API client", () => {
  beforeEach(() => { post.mockReset(); get.mockReset(); });

  it("uses preview, cancel, and confirm endpoints before creating a paid job", async () => {
    post.mockResolvedValue({ data: { preview_id: "preview-1" } });
    const { api } = await import("@/lib/api");

    await api.previewCastGeneration("series-1", {
      asset_type: "character",
      name: "Detective",
      batch_size: 2,
    });
    await api.cancelCastGenerationPreview("series-1", "preview-1");
    await api.confirmCastGeneration("series-1", "preview-1");

    expect(post).toHaveBeenNthCalledWith(1, "/api-proxy/series/series-1/assets/generate/preview", {
      asset_type: "character",
      name: "Detective",
      batch_size: 2,
    });
    expect(post).toHaveBeenNthCalledWith(2, "/api-proxy/series/series-1/assets/generate/previews/preview-1/cancel");
    expect(post).toHaveBeenNthCalledWith(3, "/api-proxy/series/series-1/assets/generate/confirm", { preview_id: "preview-1" });
  });

  it("sets an explicit lock state for the reviewed batch", async () => {
    post.mockResolvedValue({ data: { characters: [] } });
    const { api } = await import("@/lib/api");

    await api.toggleSeriesAssetLockBatch("series-1", "character", ["a", "b"], true);

    expect(post).toHaveBeenCalledWith("/api-proxy/series/series-1/assets/toggle_lock_batch", {
      asset_type: "character",
      asset_ids: ["a", "b"],
      locked: true,
    });
  });

  it("reads the persisted storyboard readiness report", async () => {
    get.mockResolvedValue({ data: { ready: false, storyboard_ready: false, checked_frames: 1, blockers: [] } });
    const { api } = await import("@/lib/api");

    await expect(api.getStoryboardReadiness("script-1")).resolves.toMatchObject({ ready: false });
    expect(get).toHaveBeenCalledWith("/api-proxy/projects/script-1/storyboard/readiness");
  });
});
