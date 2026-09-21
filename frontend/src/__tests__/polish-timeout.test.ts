import { beforeEach, describe, expect, it, vi } from "vitest";

const post = vi.fn().mockResolvedValue({
  data: { prompt_cn: "中文结果", prompt_en: "English result" },
});

vi.mock("@/lib/apiClient", () => ({
  apiClient: { post },
  apiStreamRequest: vi.fn(),
  API_URL: "/api-proxy",
  AUTH_API_URL: "/auth",
}));

const { api } = await import("@/lib/api");

describe("polish API timeout", () => {
  beforeEach(() => {
    post.mockClear();
  });

  it("allows R2V polish to wait for a slow model response", async () => {
    await api.polishR2VPrompt("draft", [{ description: "hero" }], "", "project-1");

    expect(post).toHaveBeenCalledWith(
      "/api-proxy/video/polish_r2v_prompt",
      expect.objectContaining({
        draft_prompt: "draft",
        slots: [{ description: "hero" }],
      }),
      { timeout: 120_000 },
    );
  });

  it("allows video polish to wait for a slow model response", async () => {
    await api.polishVideoPrompt("draft", "", "project-1");

    expect(post).toHaveBeenCalledWith(
      "/api-proxy/video/polish_prompt",
      expect.objectContaining({ draft_prompt: "draft" }),
      { timeout: 120_000 },
    );
  });
});
