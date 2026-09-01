// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ArtDirection from "@/components/modules/ArtDirection";
import { useProjectStore } from "@/store/projectStore";

const { getProject, getSeries, getStylePresets, saveArtDirection } = vi.hoisted(() => ({
    getProject: vi.fn(),
    getSeries: vi.fn(),
    getStylePresets: vi.fn(),
    saveArtDirection: vi.fn(),
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
});
