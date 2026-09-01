import { beforeEach, describe, expect, it, vi } from "vitest";

const { post } = vi.hoisted(() => ({
    post: vi.fn(),
}));

vi.mock("@/lib/apiClient", () => ({
    API_URL: "/api-proxy",
    AUTH_API_URL: "",
    apiClient: { post },
    apiStreamRequest: vi.fn(),
}));

import { api } from "@/lib/api";

describe("storyboard generation timeout", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        post.mockResolvedValue({ data: { frames: [] } });
    });

    it("allows synchronous AI storyboard generation to exceed the global 30 second timeout", async () => {
        await api.generateStoryboard("project-1");

        expect(post).toHaveBeenCalledWith(
            "/api-proxy/projects/project-1/generate_storyboard",
            undefined,
            { timeout: 120_000 },
        );
    });
});
