// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import StoryboardR2V from "@/components/modules/StoryboardR2V";
import { useProjectStore } from "@/store/projectStore";

const { createFrame, createVideoTask, getProject, getTaskStatus } = vi.hoisted(() => ({
    createFrame: vi.fn(),
    createVideoTask: vi.fn(),
    getProject: vi.fn(),
    getTaskStatus: vi.fn(),
}));

vi.mock("next-intl", () => ({
    useTranslations: () => (key: string) => key,
}));

vi.mock("@/lib/api", () => ({
    api: {
        createVideoTask,
        getProject,
        getTaskStatus,
        updateFrameWorkbench: vi.fn(),
        updateFrame: vi.fn(),
    },
    crudApi: { createFrame },
}));

vi.mock("@/store/toastStore", () => ({
    toast: {
        error: vi.fn(),
        success: vi.fn(),
        warning: vi.fn(),
    },
}));

vi.mock("@/components/shared/StepPageHeader", () => ({
    default: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    StepPill: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock("@/components/modules/storyboard-r2v/ShotCard", () => ({
    default: (props: {
        onUpdatePrompt: (value: string) => void;
        onGenerateBatch: (count: number) => void;
    }) => (
        <div>
            <button onClick={() => props.onUpdatePrompt("A noir station [character1:Lin Xia]")}>set prompt</button>
            <button onClick={() => props.onGenerateBatch(1)}>generate video</button>
        </div>
    ),
}));

vi.mock("@/components/modules/storyboard-r2v/DialogueAudioRow", () => ({ default: () => null }));
vi.mock("@/components/modules/storyboard-r2v/StoryboardGenerateDialog", () => ({ default: () => null }));
vi.mock("@/components/modules/storyboard-r2v/AssetDrawer", () => ({ default: () => null }));
vi.mock("@/components/modules/storyboard-r2v/shot-panel/ParamsSection", () => ({ default: () => null }));
vi.mock("@/components/modules/storyboard-r2v/shot-panel/T2ISubsection", () => ({ default: () => null }));
vi.mock("@/components/modules/storyboard-r2v/shot-panel/CandidatesSection", () => ({ default: () => null }));
vi.mock("@/components/modules/storyboard-r2v/shot-panel/CompareModal", () => ({ default: () => null }));
vi.mock("@/components/modules/storyboard-r2v/shot-panel/TaskQueueButton", () => ({ default: () => null }));
vi.mock("@/components/modules/storyboard-r2v/shot-panel/TaskQueuePanel", () => ({ default: () => null }));
vi.mock("@/components/modules/storyboard-r2v/GenerationBanner", () => ({
    GenerationBanner: () => null,
}));
vi.mock("@/components/modules/storyboard-r2v/shot-panel/usePanelSectionState", () => ({
    overridePanelSectionState: vi.fn(),
}));

describe("StoryboardR2V synthetic frame generation", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        createFrame.mockResolvedValue({
            frames: [{
                id: "frame-real-1",
                action_description: "A noir station [character1:Lin Xia]",
                workbench_tab_mode: "direct_r2v",
            }],
        });
        createVideoTask.mockResolvedValue([{ id: "video-task-1" }]);
        useProjectStore.setState({
            projects: [],
            currentProject: {
                id: "project-1",
                title: "Episode 1",
                frames: [],
                characters: [{
                    id: "character-1",
                    name: "Lin Xia",
                    reference_sheet: {
                        selected_image_id: "variant-1",
                        image_variants: [{ id: "variant-1", url: "assets/lin-xia.png" }],
                    },
                }],
                scenes: [],
                props: [],
                video_tasks: [],
                default_generation_mode: "r2v",
                workflow_mode: "r2v",
                model_settings: { r2v_model: "wan2.7-r2v" },
            },
        } as never);
    });

    it("materializes a synthetic shot before submitting its video task", async () => {
        render(<StoryboardR2V />);

        await act(async () => {
            fireEvent.click(screen.getByRole("button", { name: "set prompt" }));
        });
        await act(async () => {
            fireEvent.click(screen.getByRole("button", { name: "generate video" }));
        });

        await waitFor(() => expect(createVideoTask).toHaveBeenCalledTimes(1));
        expect(createFrame).toHaveBeenCalledTimes(1);
        expect(createVideoTask.mock.calls[0][12]).toBe("frame-real-1");
    });

    it("uses project refresh instead of the asset-task endpoint for video polling", async () => {
        vi.useFakeTimers();
        getProject.mockResolvedValue({
            id: "project-1",
            title: "Episode 1",
            frames: [{
                id: "frame-real-1",
                action_description: "A noir station [character1:Lin Xia]",
                workbench_tab_mode: "direct_r2v",
            }],
            characters: [],
            scenes: [],
            props: [],
            video_tasks: [{
                id: "video-task-1",
                frame_id: "frame-real-1",
                status: "processing",
                model: "wan2.7-r2v",
            }],
        });

        try {
            render(<StoryboardR2V />);
            await act(async () => {
                fireEvent.click(screen.getByRole("button", { name: "set prompt" }));
            });
            await act(async () => {
                fireEvent.click(screen.getByRole("button", { name: "generate video" }));
                await Promise.resolve();
                await Promise.resolve();
            });

            expect(createVideoTask).toHaveBeenCalledTimes(1);

            await act(async () => {
                await vi.advanceTimersByTimeAsync(5000);
            });

            expect(getProject).toHaveBeenCalledWith("project-1");
            expect(getTaskStatus).not.toHaveBeenCalled();
        } finally {
            vi.useRealTimers();
        }
    });
});
