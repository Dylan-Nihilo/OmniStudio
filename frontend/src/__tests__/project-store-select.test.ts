import { beforeEach, describe, expect, it, vi } from "vitest";

const getProject = vi.fn();
const fetchSeries = vi.fn();

vi.mock("@/lib/api", () => ({
    api: {
        getProject,
    },
    API_URL: "http://localhost:17177",
}));

describe("projectStore.selectProject", () => {
    beforeEach(() => {
        getProject.mockReset();
        fetchSeries.mockReset();
        vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("native fetch must not be used"))));
    });

    it("uses the authenticated API client when loading a project", async () => {
        const latestProject = {
            id: "episode-new",
            title: "新集",
            originalText: "雨夜，旧影院的霓虹灯忽明忽暗。",
            series_id: "series-new",
            characters: [{ id: "character-lin", name: "林默" }],
            scenes: [],
            props: [],
            frames: [],
        };
        getProject.mockResolvedValue(latestProject);

        const { useProjectStore } = await import("@/store/projectStore");
        useProjectStore.setState({
            projects: [],
            currentProject: null,
            seriesList: [],
            fetchSeries,
        } as never);

        await useProjectStore.getState().selectProject("episode-new");

        expect(getProject).toHaveBeenCalledWith("episode-new");
        expect(useProjectStore.getState().currentProject).toMatchObject({
            id: "episode-new",
            originalText: "雨夜，旧影院的霓虹灯忽明忽暗。",
            characters: [{ id: "character-lin", name: "林默" }],
        });
        expect(fetchSeries).toHaveBeenCalledWith("series-new");
    });
});
