import { beforeEach, describe, expect, it, vi } from "vitest";

const { get } = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock("@/lib/apiClient", () => ({
    API_URL: "http://studio.example:3000",
    AUTH_API_URL: "http://studio.example:3000",
    apiClient: { get },
    apiStreamRequest: vi.fn(),
}));

import { api } from "@/lib/api";

describe("asset library project loading", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        get.mockResolvedValue({ data: [] });
    });

    it("uses the canonical projects endpoint without a proxy redirect", async () => {
        await api.getProjects();

        expect(get).toHaveBeenCalledWith("http://studio.example:3000/projects");
    });
});
