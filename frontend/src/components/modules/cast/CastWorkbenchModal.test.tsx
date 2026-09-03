import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CastWorkbenchModal, { activePolls } from "./CastWorkbenchModal";
import { useProjectStore } from "@/store/projectStore";
import { useToastStore } from "@/store/toastStore";

const api = vi.hoisted(() => ({
    generateAsset: vi.fn(),
    getProject: vi.fn(),
    getStylePresets: vi.fn(),
    getTaskStatus: vi.fn(),
    selectAssetVariant: vi.fn(),
    favoriteAssetVariant: vi.fn(),
}));

vi.mock("next-intl", () => ({
    useTranslations: () => (key: string) => key,
}));

vi.mock("@/lib/api", () => ({ api }));

vi.mock("@/components/common/GroupedModelGrid", () => ({
    default: () => <div data-testid="model-grid" />,
}));

vi.mock("@/components/shared/preview/PreviewImage", () => ({
    default: () => null,
}));

const project = {
    id: "project-1",
    title: "Issue 17 repro",
    characters: [{
        id: "character-1",
        name: "林默",
        description: "测试角色",
        reference_sheet: { selected_image_id: null, image_variants: [] },
    }],
    scenes: [],
    props: [],
    model_settings: { t2i_model: "wan2.7-image-pro" },
};

describe("CastWorkbenchModal asset generation", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-08-30T12:00:00Z"));
        vi.clearAllMocks();
        activePolls.forEach((poll) => clearInterval(poll));
        activePolls.clear();
        useToastStore.getState().clear();
        useProjectStore.setState({
            ...useProjectStore.getInitialState(),
            currentProject: project as any,
            projects: [project as any],
            generatingTasks: [],
        }, true);
        api.getStylePresets.mockResolvedValue([]);
        api.getProject.mockResolvedValue(project);
        api.generateAsset.mockResolvedValue({ _task_id: "task-1" });
        api.getTaskStatus.mockResolvedValue({ status: "processing" });
    });

    afterEach(() => {
        activePolls.forEach((poll) => clearInterval(poll));
        activePolls.clear();
        vi.useRealTimers();
    });

    it("fails a generation that is still processing after 45 seconds", async () => {
        render(
            <CastWorkbenchModal
                isOpen
                kind="character"
                entityId="character-1"
                onClose={vi.fn()}
            />,
        );

        await act(async () => {});
        await act(async () => {
            fireEvent.click(screen.getByRole("button", { name: "generateFirst" }));
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(api.generateAsset).toHaveBeenCalledTimes(1);
        expect(useProjectStore.getState().generatingTasks).toHaveLength(1);

        await act(async () => {
            await vi.advanceTimersByTimeAsync(47_500);
        });

        expect(useProjectStore.getState().generatingTasks).toHaveLength(0);
        expect(useToastStore.getState().toasts).toContainEqual(expect.objectContaining({
            kind: "error",
            title: "toastGenErr",
            body: "toastGenTimeout",
        }));
        expect(screen.getByRole("button", { name: "generateFirst" })).toBeEnabled();
    });
});
