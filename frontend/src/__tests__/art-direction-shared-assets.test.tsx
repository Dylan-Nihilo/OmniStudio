// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ArtDirection from "@/components/modules/ArtDirection";
import { useProjectStore } from "@/store/projectStore";

const {
    getProject,
    getSeries,
    getStylePresets,
    saveArtDirection,
    getVisualHandbook,
    importVisualHandbook,
    listVisualHandbookTemplates,
    saveVisualHandbookTemplate,
} = vi.hoisted(() => ({
    getProject: vi.fn(),
    getSeries: vi.fn(),
    getStylePresets: vi.fn(),
    saveArtDirection: vi.fn(),
    getVisualHandbook: vi.fn(),
    importVisualHandbook: vi.fn(),
    listVisualHandbookTemplates: vi.fn(),
    saveVisualHandbookTemplate: vi.fn(),
}));

vi.mock("next-intl", () => ({
    useTranslations: () => (key: string) => key,
}));

vi.mock("@/lib/api", () => ({
    api: {
        getProject,
        getSeries,
        getStylePresets,
        saveArtDirection,
        getVisualHandbook,
        importVisualHandbook,
        listVisualHandbookTemplates,
        saveVisualHandbookTemplate,
    },
}));

describe("ArtDirection shared asset refresh", () => {
    const rawEpisode = {
        id: "episode-1",
        title: "Episode 1",
        originalText: "A short script",
        series_id: "series-1",
        characters: [],
        scenes: [],
        props: [],
        frames: [],
        art_direction: {
            selected_style_id: "classic-noir",
            style_config: {
                id: "classic-noir",
                name: "Classic Film Noir",
                positive_prompt: "high contrast noir",
                negative_prompt: "bright daylight",
                is_custom: false,
            },
            custom_styles: [],
            ai_recommendations: [],
        },
    };

    const mergedEpisode = {
        ...rawEpisode,
        characters: [
            {
                id: "character-lin-xia",
                name: "Lin Xia",
                description: "Reporter",
                source: "series",
            },
        ],
    };

    beforeEach(() => {
        vi.clearAllMocks();
        getSeries.mockResolvedValue({ id: "series-1", art_direction: null });
        getStylePresets.mockResolvedValue({ presets: [], categories: [] });
        saveArtDirection.mockResolvedValue(rawEpisode);
        getProject.mockResolvedValue(mergedEpisode);
        getVisualHandbook.mockResolvedValue({ markdown: "# Existing handbook" });
        listVisualHandbookTemplates.mockResolvedValue({
            templates: [{ id: "template-noir", name: "Noir", markdown: "# Noir handbook" }],
        });
        importVisualHandbook.mockResolvedValue({
            ...mergedEpisode,
            visual_handbook_markdown: "# Revised handbook",
        });
        saveVisualHandbookTemplate.mockResolvedValue({
            id: "template-revised",
            name: "Revised",
            markdown: "# Revised handbook",
        });
        useProjectStore.setState({
            projects: [mergedEpisode],
            currentProject: mergedEpisode,
            currentSeries: null,
            seriesList: [],
            isAnalyzingArtStyle: false,
        } as never);
    });

    it("keeps series-shared assets after saving the episode style", async () => {
        render(<ArtDirection />);

        const applyButton = await screen.findByRole("button", { name: "applyAndContinue" });
        await act(async () => {
            fireEvent.click(applyButton);
        });

        expect(useProjectStore.getState().currentProject?.characters).toEqual(
            mergedEpisode.characters,
        );
    });

    it("loads, edits, saves, and reuses visual handbook templates", async () => {
        const prompt = vi.spyOn(window, "prompt").mockReturnValue("Revised");
        render(<ArtDirection />);

        const editor = await screen.findByRole("textbox", { name: "visualHandbook" });
        expect(editor).toHaveValue("# Existing handbook");

        fireEvent.click(screen.getByRole("button", { name: "Noir" }));
        expect(editor).toHaveValue("# Noir handbook");

        fireEvent.change(editor, { target: { value: "# Revised handbook" } });
        fireEvent.click(screen.getByRole("button", { name: "saveHandbook" }));
        await waitFor(() => {
            expect(importVisualHandbook).toHaveBeenCalledWith(
                "episode-1",
                "# Revised handbook",
            );
        });

        fireEvent.click(screen.getByRole("button", { name: "saveHandbookTemplate" }));
        await waitFor(() => {
            expect(saveVisualHandbookTemplate).toHaveBeenCalledWith(
                "episode-1",
                "Revised",
                "# Revised handbook",
            );
        });
        expect(await screen.findByRole("button", { name: "Revised" })).toBeInTheDocument();
        prompt.mockRestore();
    });
});
