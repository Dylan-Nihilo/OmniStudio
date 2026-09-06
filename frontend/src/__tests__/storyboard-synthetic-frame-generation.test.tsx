// @vitest-environment happy-dom

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import StoryboardR2V from "@/components/modules/StoryboardR2V";
import { useShotDraftStore } from "@/components/modules/storyboard-r2v/useShotDrafts";
import { useProjectStore } from "@/store/projectStore";
import { useAuthStore } from "@/store/authStore";

const { createFrame, createVideoTask, getProject, getTaskStatus, toastError, deleteFrame, reorderFrames, copyFrame, updateFrame, updateFrameWorkbench } = vi.hoisted(() => ({
    createFrame: vi.fn(),
    createVideoTask: vi.fn(),
    getProject: vi.fn(),
    getTaskStatus: vi.fn(),
    toastError: vi.fn(),
    deleteFrame: vi.fn(),
    reorderFrames: vi.fn(),
    copyFrame: vi.fn(),
    updateFrame: vi.fn(),
    updateFrameWorkbench: vi.fn(),
}));

vi.mock("next-intl", () => ({
    useTranslations: () => (key: string) => key,
}));

vi.mock("@/lib/api", () => ({
    api: {
        createVideoTask,
        getProject,
        getTaskStatus,
        updateFrameWorkbench,
        updateFrame,
    },
    crudApi: { createFrame, deleteFrame, reorderFrames, copyFrame },
}));

vi.mock("@/store/toastStore", () => ({
    toast: {
        error: toastError,
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
        sequence?: React.ReactNode;
        shot: { id: string; prompt: string };
        onDelete: () => void;
        onMoveDown: () => void;
        onDuplicate: () => void;
        onSetTabMode: (mode: "t2i_i2v") => void;
        onUpdateField: (field: string, value: string | null) => void;
        onSetGenerateCount: (count: number) => void;
        generateCount: number;
    }) => (
        <div>
            <button onClick={() => props.onUpdatePrompt("A noir station [character1:Lin Xia]")}>set prompt</button>
            <button onClick={() => props.onGenerateBatch(1)}>generate video</button>
            <button onClick={props.onDelete}>delete shot</button>
            <button onClick={props.onMoveDown}>move down</button>
            <button onClick={props.onDuplicate}>copy shot</button>
            <button onClick={() => props.onSetTabMode("t2i_i2v")}>use first frame</button>
            <button onClick={() => props.onUpdateField("shotSize", "close-up")}>close-up</button>
            <button onClick={() => props.onUpdateField("transitionHint", null)}>clear transition</button>
            <button onClick={() => props.onSetGenerateCount(3)}>three takes</button>
            <p>takes: {props.generateCount}</p>
            <output>{props.shot.id}</output>
            <textarea aria-label="shot prompt" value={props.shot.prompt} onChange={event => props.onUpdatePrompt(event.target.value)} />
            {props.sequence}
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
        useShotDraftStore.setState({ drafts: {}, errors: {}, saving: {}, storageUnavailable: false });
        updateFrame.mockResolvedValue({});
        updateFrameWorkbench.mockResolvedValue({});
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

    it("shows a save error when adding a shot cannot be persisted", async () => {
        createFrame.mockRejectedValueOnce(new Error("save failed"));

        render(<StoryboardR2V />);
        fireEvent.click(screen.getAllByRole("button", { name: "addShot" })[0]);

        await waitFor(() => {
            expect(toastError).toHaveBeenCalledWith("saveFailed", { body: "save failed" });
        });
    });

    it("keeps failed prompt edits recoverable when the workbench is reopened", async () => {
        vi.useFakeTimers();
        const project = {
            ...useProjectStore.getState().currentProject!,
            frames: [{ id: "frame-save", action_description: "original prompt" }],
        };
        useProjectStore.setState({ currentProject: project, selectedFrameId: "frame-save" });
        updateFrame.mockRejectedValue(new Error("offline"));
        const view = render(<StoryboardR2V />);
        try {
            fireEvent.change(screen.getByRole("textbox", { name: "shot prompt" }), { target: { value: "keep this edit" } });
            await act(async () => { await vi.advanceTimersByTimeAsync(900); });
            expect(updateFrame).toHaveBeenCalledWith("project-1", "frame-save", { action_description: "keep this edit" });
            const leaving = new Event("beforeunload", { cancelable: true });
            window.dispatchEvent(leaving);
            expect(leaving.defaultPrevented).toBe(true);
            view.unmount();
            const leavingOtherModule = new Event("beforeunload", { cancelable: true });
            window.dispatchEvent(leavingOtherModule);
            expect(leavingOtherModule.defaultPrevented).toBe(true);
            // A fresh project response still contains the last server value.
            useProjectStore.setState({ currentProject: project });
            render(<StoryboardR2V />);
            expect(screen.getByRole("textbox", { name: "shot prompt" })).toHaveValue("keep this edit");
            updateFrame.mockResolvedValue({});
            await act(async () => { fireEvent.click(screen.getByRole("button", { name: "retrySave" })); });
            expect(screen.getByRole("status", { name: "saveStatus" })).toHaveTextContent("saved");
            expect(useProjectStore.getState().currentProject!.frames[0].action_description).toBe("keep this edit");
        } finally {
            vi.useRealTimers();
        }
    });

    it("serializes successive edits while keeping other shots and projects isolated", async () => {
        vi.useFakeTimers();
        const project = { ...useProjectStore.getState().currentProject!, frames: [
            { id: "frame-a", action_description: "original A" },
            { id: "frame-b", action_description: "original B" },
        ] };
        useProjectStore.setState({ currentProject: project, selectedFrameId: "frame-a" });
        let finishFirst!: () => void;
        let finishSecond!: () => void;
        updateFrame.mockImplementationOnce(() => new Promise(resolve => { finishFirst = () => resolve({}); }))
            .mockImplementationOnce(() => new Promise(resolve => { finishSecond = () => resolve({}); }));
        const view = render(<StoryboardR2V />);
        try {
            fireEvent.change(screen.getByRole("textbox", { name: "shot prompt" }), { target: { value: "first edit" } });
            await act(async () => { await vi.advanceTimersByTimeAsync(900); });
            fireEvent.change(screen.getByRole("textbox", { name: "shot prompt" }), { target: { value: "latest edit" } });
            await act(async () => { await vi.advanceTimersByTimeAsync(900); });
            expect(updateFrame).toHaveBeenCalledTimes(1);
            await act(async () => { useProjectStore.setState({ selectedFrameId: "frame-b" }); });
            expect(screen.getByRole("textbox", { name: "shot prompt" })).toHaveValue("original B");
            await act(async () => { finishFirst(); });
            expect(updateFrame).toHaveBeenLastCalledWith("project-1", "frame-a", { action_description: "latest edit" });
            expect(screen.getByRole("status", { name: "saveStatus" })).toHaveTextContent("saving");
            await act(async () => {
                useProjectStore.setState({ currentProject: { ...project, id: "project-2" }, selectedFrameId: "frame-a" });
            });
            expect(screen.getByRole("textbox", { name: "shot prompt" })).toHaveValue("original A");
            await act(async () => { finishSecond(); });
            expect(useProjectStore.getState().currentProject!.frames[0].action_description).toBe("original A");
        } finally { view.unmount(); vi.useRealTimers(); }
    });

    it("retries workbench and field changes independently and restores their draft values", async () => {
        vi.useFakeTimers();
        const project = { ...useProjectStore.getState().currentProject!, frames: [
            { id: "frame-config", action_description: "original", workbench_generate_count: 1 },
        ] };
        useProjectStore.setState({ currentProject: project, selectedFrameId: "frame-config" });
        updateFrameWorkbench.mockRejectedValue(new Error("offline"));
        const view = render(<StoryboardR2V />);
        try {
            fireEvent.click(screen.getByRole("button", { name: "close-up" }));
            fireEvent.click(screen.getByRole("button", { name: "three takes" }));
            await act(async () => { await vi.advanceTimersByTimeAsync(3100); });
            expect(updateFrame).toHaveBeenCalledWith("project-1", "frame-config", { shot_size: "close-up" });
            view.unmount();
            useProjectStore.setState({ currentProject: project });
            render(<StoryboardR2V />);
            expect(screen.getByText("takes: 3")).toBeVisible();
            updateFrameWorkbench.mockResolvedValue({});
            await act(async () => { fireEvent.click(screen.getByRole("button", { name: "retrySave" })); });
            expect(updateFrame).toHaveBeenCalledTimes(1);
            expect(updateFrameWorkbench).toHaveBeenLastCalledWith("project-1", "frame-config", { workbench_generate_count: 3 });
            expect(screen.getByRole("status", { name: "saveStatus" })).toHaveTextContent("saved");
        } finally { vi.useRealTimers(); }
    });

    it("edits the refined visual narrative without reverting to the coarse action", async () => {
        vi.useFakeTimers();
        useProjectStore.setState({ currentProject: { ...useProjectStore.getState().currentProject!, frames: [
            { id: "frame-action", action_description: "original action", visual_description: "static composition" },
        ] }, selectedFrameId: "frame-action" });
        const view = render(<StoryboardR2V />);
        try {
            expect(screen.getByRole("textbox", { name: "shot prompt" })).toHaveValue("static composition");
            fireEvent.change(screen.getByRole("textbox", { name: "shot prompt" }), { target: { value: "saved action" } });
            await act(async () => { await vi.advanceTimersByTimeAsync(900); });
            view.unmount();
            render(<StoryboardR2V />);
            expect(screen.getByRole("textbox", { name: "shot prompt" })).toHaveValue("saved action");
            expect(updateFrame).toHaveBeenLastCalledWith("project-1", "frame-action", { visual_description: "saved action" });
        } finally { vi.useRealTimers(); }
    });

    it("persists clearing an optional field instead of omitting it from the update", async () => {
        vi.useFakeTimers();
        useProjectStore.setState({ currentProject: { ...useProjectStore.getState().currentProject!, frames: [
            { id: "frame-clear", action_description: "action", transition_hint: "fade" },
        ] }, selectedFrameId: "frame-clear" });
        const view = render(<StoryboardR2V />);
        try {
            fireEvent.click(screen.getByRole("button", { name: "clear transition" }));
            await act(async () => { await vi.advanceTimersByTimeAsync(3100); });
            expect(updateFrame).toHaveBeenCalledWith("project-1", "frame-clear", { transition_hint: "" });
            expect(useProjectStore.getState().currentProject!.frames[0].transition_hint).toBe("");
        } finally { view.unmount(); vi.useRealTimers(); }
    });

    it("keeps drafts in their workspace and does not send queued writes after switching", async () => {
        vi.useFakeTimers();
        const workspace = useAuthStore.getState().activeWorkspace;
        useProjectStore.setState({ currentProject: { ...useProjectStore.getState().currentProject!, frames: [
            { id: "frame-scoped", action_description: "server text" },
        ] }, selectedFrameId: "frame-scoped" });
        const view = render(<StoryboardR2V />);
        try {
            fireEvent.change(screen.getByRole("textbox", { name: "shot prompt" }), { target: { value: "private draft" } });
            await act(async () => {
                useAuthStore.setState({ activeWorkspace: { id: "another-workspace", name: "Other", slug: null, role: "member" } });
                await vi.advanceTimersByTimeAsync(1000);
            });
            expect(updateFrame).not.toHaveBeenCalled();
            expect(screen.getByRole("textbox", { name: "shot prompt" })).toHaveValue("server text");
            await act(async () => { useAuthStore.setState({ activeWorkspace: workspace }); });
            expect(screen.getByRole("textbox", { name: "shot prompt" })).toHaveValue("private draft");
            await act(async () => { fireEvent.click(screen.getByRole("button", { name: "saveNow" })); });
            expect(updateFrame).toHaveBeenCalledOnce();
        } finally {
            view.unmount();
            useAuthStore.setState({ activeWorkspace: workspace });
            vi.useRealTimers();
        }
    });

    it("transfers edits made during new-frame creation to the persisted frame", async () => {
        vi.useFakeTimers();
        let finishCreate!: () => void;
        createFrame.mockImplementationOnce(() => new Promise(resolve => {
            finishCreate = () => resolve({ frames: [{ id: "frame-created", action_description: "first edit" }] });
        }));
        const view = render(<StoryboardR2V />);
        try {
            fireEvent.change(screen.getByRole("textbox", { name: "shot prompt" }), { target: { value: "first edit" } });
            await act(async () => { await vi.advanceTimersByTimeAsync(900); });
            fireEvent.change(screen.getByRole("textbox", { name: "shot prompt" }), { target: { value: "latest edit" } });
            await act(async () => { await vi.advanceTimersByTimeAsync(900); });
            expect(createFrame).toHaveBeenCalledOnce();
            await act(async () => { finishCreate(); });
            expect(updateFrame).toHaveBeenLastCalledWith("project-1", "frame-created", { action_description: "latest edit" });
            expect(screen.getByRole("textbox", { name: "shot prompt" })).toHaveValue("latest edit");
            expect(screen.getByRole("status", { name: "saveStatus" })).toHaveTextContent("saved");
        } finally { view.unmount(); vi.useRealTimers(); }
    });
    it.each(["delete", "reorder", "copy"])("retains shot order and reports a failed %s", async (operation) => {
        const frames = [
            { id: "frame-1", action_description: "first shot" },
            { id: "frame-2", action_description: "second shot" },
        ];
        useProjectStore.setState({ currentProject: { ...useProjectStore.getState().currentProject!, frames }, selectedFrameId: "frame-1" });
        deleteFrame.mockRejectedValueOnce(new Error("delete failed"));
        reorderFrames.mockRejectedValueOnce(new Error("reorder failed"));
        copyFrame.mockRejectedValueOnce(new Error("copy failed"));
        render(<StoryboardR2V />);
        fireEvent.click(screen.getByRole("button", { name: operation === "delete" ? "delete shot" : operation === "copy" ? "copy shot" : "move down" }));
        await waitFor(() => expect(toastError).toHaveBeenCalledWith("saveFailed", { body: `${operation} failed` }));
        expect(screen.getByText("frame-1", { selector: "output" })).toBeVisible();
        expect(screen.getAllByRole("button", { name: "selectShot" }).map(node => node.textContent)).toEqual([expect.stringContaining("first shot"), expect.stringContaining("second shot")]);
        expect(useProjectStore.getState().currentProject!.frames.map(frame => frame.id)).toEqual(["frame-1", "frame-2"]);
    });

});
