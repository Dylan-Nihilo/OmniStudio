// @vitest-environment happy-dom

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import StoryboardR2V from "@/components/modules/StoryboardR2V";
import { useShotDraftStore } from "@/components/modules/storyboard-r2v/useShotDrafts";
import { useProjectStore } from "@/store/projectStore";
import { useAuthStore } from "@/store/authStore";
import type { VideoTask } from "@/lib/api";

const { createFrame, createVideoTask, retryVideoTask, getProject, getTaskStatus, toastError, deleteFrame, reorderFrames, copyFrame, updateFrame, updateFrameWorkbench, refineSingleFrame, cancelVideoTask, annotateVideoTask, selectVideo, unpinVideo, autoSelectLatestVideo, candidateError } = vi.hoisted(() => ({
    createFrame: vi.fn(),
    createVideoTask: vi.fn(),
    retryVideoTask: vi.fn(),
    getProject: vi.fn(),
    getTaskStatus: vi.fn(),
    toastError: vi.fn(),
    deleteFrame: vi.fn(),
    reorderFrames: vi.fn(),
    copyFrame: vi.fn(),
    updateFrame: vi.fn(),
    updateFrameWorkbench: vi.fn(),
    refineSingleFrame: vi.fn(),
    cancelVideoTask: vi.fn(),
    annotateVideoTask: vi.fn(),
    selectVideo: vi.fn(),
    unpinVideo: vi.fn(),
    autoSelectLatestVideo: vi.fn(),
    candidateError: vi.fn(),
}));

vi.mock("next-intl", () => ({
    useTranslations: () => (key: string) => key,
}));

vi.mock("@/lib/api", () => ({
    api: {
        createVideoTask,
        retryVideoTask,
        getProject,
        getTaskStatus,
        updateFrameWorkbench,
        updateFrame,
        refineSingleFrame,
        cancelVideoTask,
        annotateVideoTask,
        selectVideo,
        unpinVideo,
        autoSelectLatestVideo,
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
        onRefineFrame: () => void;
        onUpdatePrompt: (value: string) => void;
        onGenerateBatch: (count: number) => void;
        sequence?: React.ReactNode;
        candidates?: React.ReactNode;
        shot: { id: string; prompt: string; videoUrl?: string };
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
            <button onClick={props.onRefineFrame}>refine shot</button>
            <button onClick={() => props.onSetTabMode("t2i_i2v")}>use first frame</button>
            <button onClick={() => props.onUpdateField("shotSize", "close-up")}>close-up</button>
            <button onClick={() => props.onUpdateField("transitionHint", null)}>clear transition</button>
            <button onClick={() => props.onSetGenerateCount(3)}>three takes</button>
            <p>takes: {props.generateCount}</p>
            <output>{props.shot.id}</output>
            <output aria-label="selected video">{props.shot.videoUrl}</output>
            <textarea aria-label="shot prompt" value={props.shot.prompt} onChange={event => props.onUpdatePrompt(event.target.value)} />
            {props.sequence}
            {props.candidates}
        </div>
    ),
}));

vi.mock("@/components/modules/storyboard-r2v/DialogueAudioRow", () => ({ default: () => null }));
vi.mock("@/components/modules/storyboard-r2v/StoryboardGenerateDialog", () => ({ default: () => null }));
vi.mock("@/components/modules/storyboard-r2v/AssetDrawer", () => ({ default: () => null }));
vi.mock("@/components/modules/storyboard-r2v/shot-panel/ParamsSection", () => ({ default: () => null }));
vi.mock("@/components/modules/storyboard-r2v/shot-panel/T2ISubsection", () => ({ default: () => null }));
vi.mock("@/components/modules/storyboard-r2v/shot-panel/CandidatesSection", () => ({
    default: ({ tasks, onToggleStar, onSetActive, onRetry, retryingTaskIds, isSelecting }: { tasks: VideoTask[]; onToggleStar: (task: VideoTask, next: boolean) => Promise<void>; onSetActive: (task: VideoTask) => Promise<void>; onRetry: (task: VideoTask) => Promise<void>; retryingTaskIds?: ReadonlySet<string>; isSelecting?: boolean }) => <div><output aria-label="candidate selection state">{isSelecting ? "saving" : "idle"}</output>{tasks.map(task =>
        <div key={task.id}>
            <button onClick={() => { void onToggleStar(task, true).catch(candidateError); }}>{task.is_starred ? "starred task" : "star task"}</button>
            <button onClick={() => { void onSetActive(task).catch(() => {}); }}>select {task.id}</button>
            <button disabled={retryingTaskIds?.has(task.id)} onClick={() => { void onRetry(task).catch(candidateError); }}>candidate retry {task.id}</button>
        </div>
    )}</div>,
}));
vi.mock("@/components/modules/storyboard-r2v/shot-panel/CompareModal", () => ({ default: () => null }));
vi.mock("@/components/modules/storyboard-r2v/shot-panel/TaskQueueButton", () => ({ default: () => null }));
vi.mock("@/components/modules/storyboard-r2v/shot-panel/TaskQueuePanel", () => ({
    default: ({ tasks, onCancel, onRetry, retryingTaskIds }: { tasks: VideoTask[]; onCancel: (task: VideoTask) => Promise<void>; onRetry: (task: VideoTask) => Promise<void>; retryingTaskIds?: ReadonlySet<string> }) => <div>{tasks.map(task =>
        <div key={task.id}>
            <button onClick={() => { void onCancel(task).catch(() => {}); }}>cancel {task.id}</button>
            <button disabled={retryingTaskIds?.has(task.id)} onClick={() => { void onRetry(task).catch(candidateError); }}>queue retry {task.id}</button>
        </div>
    )}</div>,
}));
vi.mock("@/components/modules/storyboard-r2v/GenerationBanner", () => ({
    GenerationBanner: () => null,
}));
vi.mock("@/components/modules/storyboard-r2v/shot-panel/usePanelSectionState", () => ({
    overridePanelSectionState: vi.fn(),
}));

describe("StoryboardR2V synthetic frame generation", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useShotDraftStore.setState({ drafts: {}, errors: {}, saving: {}, storageUnavailable: false, materializedIds: {}, refining: {}, refinedVersions: {} });
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

    it("saves a failed draft before refinement and keeps the refined result on reopening", async () => {
        vi.useFakeTimers();
        const project = { ...useProjectStore.getState().currentProject!, frames: [
            { id: "frame-refine", action_description: "coarse", visual_description: "original rich description" },
        ] };
        useProjectStore.setState({ currentProject: project });
        updateFrame.mockRejectedValue(new Error("save failed"));
        refineSingleFrame.mockResolvedValue({ ...project.frames[0], visual_description: "refined description" });
        const view = render(<StoryboardR2V />);
        try {
            fireEvent.change(screen.getByRole("textbox", { name: "shot prompt" }), { target: { value: "manual draft" } });
            await act(async () => { await vi.advanceTimersByTimeAsync(900); });
            await act(async () => { fireEvent.click(screen.getByRole("button", { name: "refine shot" })); });
            expect(refineSingleFrame).not.toHaveBeenCalled();
            expect(screen.getByRole("textbox", { name: "shot prompt" })).toHaveValue("manual draft");
            updateFrame.mockResolvedValue({});
            await act(async () => { fireEvent.click(screen.getByRole("button", { name: "refine shot" })); });
            expect(refineSingleFrame).toHaveBeenCalledOnce();
            expect(updateFrame).toHaveBeenLastCalledWith("project-1", "frame-refine", { visual_description: "manual draft" });
            expect(screen.getByRole("textbox", { name: "shot prompt" })).toHaveValue("refined description");
            view.unmount();
            render(<StoryboardR2V />);
            expect(screen.getByRole("textbox", { name: "shot prompt" })).toHaveValue("refined description");
            expect(screen.queryByRole("button", { name: "retrySave" })).not.toBeInTheDocument();
        } finally { vi.useRealTimers(); }
    });

    it.each([["success", true], ["success", false], ["failure", true], ["failure", false]])("retains newer edits after refinement %s with rich frame %s", async (outcome, rich) => {
        vi.useFakeTimers();
        const project = { ...useProjectStore.getState().currentProject!, frames: [
            { id: "frame-refining", action_description: "coarse", visual_description: rich ? "original" : undefined },
        ] };
        useProjectStore.setState({ currentProject: project });
        let finishRefine!: () => void;
        refineSingleFrame.mockImplementationOnce(() => new Promise((resolve, reject) => { finishRefine = () => outcome === "success" ? resolve({ ...project.frames[0], visual_description: "AI result" }) : reject(new Error("refine failed")); }));
        const first = render(<StoryboardR2V />);
        let reopened: ReturnType<typeof render> | undefined;
        try {
            await act(async () => { fireEvent.click(screen.getByRole("button", { name: "refine shot" })); });
            first.unmount();
            reopened = render(<StoryboardR2V />);
            await act(async () => { fireEvent.click(screen.getByRole("button", { name: "refine shot" })); });
            fireEvent.change(screen.getByRole("textbox", { name: "shot prompt" }), { target: { value: "newer edit" } });
            await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
            expect(refineSingleFrame).toHaveBeenCalledOnce();
            expect(updateFrame).not.toHaveBeenCalled();
            await act(async () => { finishRefine(); });
            expect(screen.getByRole("textbox", { name: "shot prompt" })).toHaveValue("newer edit");
            expect(updateFrame).toHaveBeenLastCalledWith("project-1", "frame-refining", outcome === "success" || rich ? { visual_description: "newer edit" } : { action_description: "newer edit" });
            reopened.unmount();
            reopened = render(<StoryboardR2V />);
            expect(screen.getByRole("textbox", { name: "shot prompt" })).toHaveValue("newer edit");
            expect(screen.getByRole("status", { name: "saveStatus" })).toHaveTextContent("saved");
        } finally { first.unmount(); reopened?.unmount(); vi.useRealTimers(); }
    });

    it.each([100, 900])("keeps one new shot when creation finishes %ims after reopening Studio", async (delay) => {
        vi.useFakeTimers();
        let finishCreate!: () => void;
        createFrame.mockImplementationOnce(() => new Promise(resolve => {
            finishCreate = () => resolve({ frames: [{ id: "frame-reopened", action_description: "first edit" }] });
        }));
        const first = render(<StoryboardR2V />);
        let reopened: ReturnType<typeof render> | undefined;
        try {
            fireEvent.change(screen.getByRole("textbox", { name: "shot prompt" }), { target: { value: "first edit" } });
            await act(async () => { await vi.advanceTimersByTimeAsync(900); });
            first.unmount();
            reopened = render(<StoryboardR2V />);
            fireEvent.change(screen.getByRole("textbox", { name: "shot prompt" }), { target: { value: "edit after reopening" } });
            await act(async () => { await vi.advanceTimersByTimeAsync(delay); finishCreate(); });
            await act(async () => { await vi.advanceTimersByTimeAsync(1200); });
            expect(createFrame).toHaveBeenCalledOnce();
            expect(screen.getByText("frame-reopened", { selector: "output" })).toBeVisible();
            expect(screen.getByRole("textbox", { name: "shot prompt" })).toHaveValue("edit after reopening");
            expect(updateFrame).toHaveBeenLastCalledWith("project-1", "frame-reopened", { action_description: "edit after reopening" });
            expect(screen.getByRole("status", { name: "saveStatus" })).toHaveTextContent("saved");
        } finally { first.unmount(); reopened?.unmount(); vi.useRealTimers(); }
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

    it("retains the selected video on failed adoption and merges only confirmed selection fields on retry", async () => {
        vi.useFakeTimers();
        const task = { id: "take-new", frame_id: "frame-select", status: "completed", video_url: "new.mp4", workbench_tab: "direct_r2v" };
        const project = { ...useProjectStore.getState().currentProject!, frames: [{ id: "frame-select", action_description: "original", video_url: "old.mp4", selected_video_id: "take-old", dubbed_video_url: "old-dub.mp4", dubbed_video_task_id: "take-old", workbench_tab_mode: "direct_r2v" }], video_tasks: [task] };
        useProjectStore.setState({ currentProject: project } as never);
        selectVideo.mockRejectedValueOnce(new Error("selection failed"));
        const view = render(<StoryboardR2V />);
        try {
            await act(async () => { fireEvent.click(screen.getByRole("button", { name: "select take-new" })); });
            expect(screen.getByLabelText("selected video")).toHaveTextContent("old-dub.mp4");
            let finishSelect!: (value: unknown) => void;
            selectVideo.mockImplementationOnce(() => new Promise(resolve => { finishSelect = resolve; }));
            fireEvent.click(screen.getByRole("button", { name: "select take-new" }));
            fireEvent.change(screen.getByRole("textbox", { name: "shot prompt" }), { target: { value: "new description" } });
            await act(async () => { await vi.advanceTimersByTimeAsync(900); });
            expect(screen.getByLabelText("selected video")).toHaveTextContent("old-dub.mp4");
            await act(async () => { finishSelect({ ...project, frames: [{ ...project.frames[0], selected_video_id: task.id, video_url: task.video_url, is_video_pinned: true }] }); });
            expect(screen.getByLabelText("selected video")).toHaveTextContent("new.mp4");
            expect(useProjectStore.getState().currentProject?.frames[0].action_description).toBe("new description");
            expect(useProjectStore.getState().currentProject?.frames[0].selected_video_id).toBe("take-new");
            view.unmount();
            const reopened = render(<StoryboardR2V />);
            try { expect(screen.getByLabelText("selected video")).toHaveTextContent("new.mp4"); }
            finally { reopened.unmount(); }
        } finally { view.unmount(); vi.useRealTimers(); }
    });

    it("reads the server-selected candidate without replacing newer prompt edits or issuing selection writes", async () => {
        vi.useFakeTimers();
        const task = { id: "finished-away", frame_id: "frame-readback", status: "processing", created_at: 1 };
        const project = { ...useProjectStore.getState().currentProject!, frames: [{ id: "frame-readback", action_description: "Original", video_url: "old.mp4", selected_video_id: "old" }], video_tasks: [task] };
        useProjectStore.setState({ currentProject: project } as never);
        let finishRead!: (value: unknown) => void;
        getProject.mockImplementationOnce(() => new Promise(resolve => { finishRead = resolve; }));
        const view = render(<StoryboardR2V />);
        try {
            await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
            fireEvent.change(screen.getByRole("textbox", { name: "shot prompt" }), { target: { value: "Keep my new description" } });
            await act(async () => { await vi.advanceTimersByTimeAsync(900); });
            await act(async () => { finishRead({ ...project, frames: [{ ...project.frames[0], selected_video_id: task.id, video_url: "finished.mp4" }], video_tasks: [{ ...task, status: "completed", video_url: "finished.mp4" }] }); });
            expect(screen.getByLabelText("selected video")).toHaveTextContent("finished.mp4");
            expect(useProjectStore.getState().currentProject!.frames[0].action_description).toBe("Keep my new description");
            expect(screen.getByRole("textbox", { name: "shot prompt" })).toHaveValue("Keep my new description");
            expect(autoSelectLatestVideo).not.toHaveBeenCalled();
            view.unmount();
            const reopened = render(<StoryboardR2V />);
            expect(screen.getByLabelText("selected video")).toHaveTextContent("finished.mp4");
            reopened.unmount();
        } finally { view.unmount(); vi.useRealTimers(); }
    });

    it("refreshes again after a selection write overlaps the final task read, preserving the manual pin", async () => {
        vi.useFakeTimers();
        const automatic = { id: "take-auto", frame_id: "frame-select", status: "processing", created_at: 2 };
        const manual = { id: "take-manual", frame_id: "frame-select", status: "completed", video_url: "manual.mp4", workbench_tab: "direct_r2v", created_at: 1 };
        const project = { ...useProjectStore.getState().currentProject!, frames: [{ id: "frame-select", action_description: "Original", video_url: "old.mp4", selected_video_id: "old" }], video_tasks: [automatic, manual] };
        const completed = [{ ...automatic, status: "completed", video_url: "auto.mp4" }, manual];
        const pinned = { ...project, frames: [{ ...project.frames[0], selected_video_id: manual.id, video_url: manual.video_url, is_video_pinned: true }], video_tasks: completed };
        useProjectStore.setState({ currentProject: project } as never);
        let finishRead!: (value: unknown) => void;
        let finishSelect!: (value: unknown) => void;
        getProject.mockImplementationOnce(() => new Promise(resolve => { finishRead = resolve; })).mockResolvedValue(pinned);
        selectVideo.mockImplementationOnce(() => new Promise(resolve => { finishSelect = resolve; }));
        const view = render(<StoryboardR2V />);
        try {
            await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
            fireEvent.click(screen.getByRole("button", { name: "select take-manual" }));
            await act(async () => { finishRead({ ...project, frames: [{ ...project.frames[0], selected_video_id: automatic.id, video_url: "auto.mp4" }], video_tasks: completed }); });
            expect(screen.getByLabelText("selected video")).toHaveTextContent("old.mp4");
            await act(async () => { finishSelect(pinned); });
            expect(screen.getByLabelText("selected video")).toHaveTextContent("manual.mp4");
            await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
            expect(getProject).toHaveBeenCalledTimes(2);
            expect(screen.getByLabelText("selected video")).toHaveTextContent("manual.mp4");
            expect(useProjectStore.getState().currentProject!.frames[0].is_video_pinned).toBe(true);
            expect(autoSelectLatestVideo).not.toHaveBeenCalled();
        } finally { view.unmount(); vi.useRealTimers(); }
    });

    it("preserves pending candidate selection across navigation and applies only selection fields after reopening", async () => {
        const task: VideoTask = { id: "reopen-take", project_id: "project-1", frame_id: "frame-reopen-selection", image_url: "", prompt: "Candidate", duration: 5, resolution: "720p", generate_audio: false, prompt_extend: false, status: "completed", video_url: "reopened.mp4", created_at: 1, workbench_tab: "direct_r2v" };
        const project = { ...useProjectStore.getState().currentProject!, frames: [{ id: task.frame_id!, action_description: "Original description", video_url: "previous.mp4", selected_video_id: "previous" }], video_tasks: [task] };
        useProjectStore.setState({ currentProject: project });
        let finish!: (value: unknown) => void;
        selectVideo.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
        const view = render(<StoryboardR2V />);
        fireEvent.click(screen.getByRole("button", { name: "select reopen-take" }));
        view.unmount();
        const reopened = render(<StoryboardR2V />);
        expect(screen.getByLabelText("candidate selection state")).toHaveTextContent("saving");
        fireEvent.change(screen.getByRole("textbox", { name: "shot prompt" }), { target: { value: "Continue editing" } });
        fireEvent.click(screen.getByRole("button", { name: "select reopen-take" }));
        expect(selectVideo).toHaveBeenCalledOnce();
        await act(async () => { finish({ ...project, frames: [{ ...project.frames[0], selected_video_id: task.id, video_url: task.video_url, is_video_pinned: true }] }); });
        expect(screen.getByLabelText("candidate selection state")).toHaveTextContent("idle");
        expect(screen.getByLabelText("selected video")).toHaveTextContent("reopened.mp4");
        expect(screen.getByRole("textbox", { name: "shot prompt" })).toHaveValue("Continue editing");
        expect(useProjectStore.getState().currentProject!.frames[0].is_video_pinned).toBe(true);
        reopened.unmount();
    });

    it("reports a failed annotation to the candidate and retains its previous value until retry succeeds", async () => {
        const task = { id: "star-task", frame_id: "frame-star", status: "completed", workbench_tab: "direct_r2v", is_starred: false };
        const project = { ...useProjectStore.getState().currentProject!, frames: [{ id: "frame-star", action_description: "original", workbench_tab_mode: "direct_r2v" }], video_tasks: [task] };
        useProjectStore.setState({ currentProject: project } as never);
        const failure = new Error("annotation failed");
        annotateVideoTask.mockRejectedValueOnce(failure).mockResolvedValueOnce({ ...task, is_starred: true });
        const view = render(<StoryboardR2V />);
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "star task" })); });
        expect(candidateError).toHaveBeenCalledWith(failure);
        expect(screen.getByRole("button", { name: "star task" })).toBeVisible();
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "star task" })); });
        expect(screen.getByRole("button", { name: "starred task" })).toBeVisible();
        view.unmount();
    });

    it("keeps a confirmed star when an older task read finishes", async () => {
        vi.useFakeTimers();
        const task = { id: "star-task", frame_id: "frame-star", status: "processing", workbench_tab: "direct_r2v", generation_mode: "r2v" };
        const project = { ...useProjectStore.getState().currentProject!, frames: [{ id: "frame-star", action_description: "original", workbench_tab_mode: "direct_r2v" }], video_tasks: [task] };
        useProjectStore.setState({ currentProject: project } as never);
        let finishRead!: (value: unknown) => void;
        getProject.mockImplementationOnce(() => new Promise(resolve => { finishRead = resolve; }));
        getProject.mockResolvedValue({ ...project, video_tasks: [{ ...task, status: "failed", is_starred: true }] });
        annotateVideoTask.mockResolvedValue({ ...task, is_starred: true });
        const view = render(<StoryboardR2V />);
        try {
            await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
            await act(async () => { fireEvent.click(screen.getByRole("button", { name: "star task" })); });
            await act(async () => { finishRead({ ...project, video_tasks: [{ ...task, status: "failed" }] }); });
            expect(screen.getByRole("button", { name: "starred task" })).toBeVisible();
        } finally { view.unmount(); vi.useRealTimers(); }
    });

    it("keeps a failed cancellation unchanged, deduplicates pending requests and applies the returned task on retry", async () => {
        const task = { id: "cancel-task", frame_id: "frame-cancel", status: "processing" };
        const project = { ...useProjectStore.getState().currentProject!, frames: [{ id: "frame-cancel", action_description: "original" }], video_tasks: [task] };
        useProjectStore.setState({ currentProject: project } as never);
        let rejectCancel!: (error: Error) => void;
        cancelVideoTask.mockImplementationOnce(() => new Promise((_, reject) => { rejectCancel = reject; }));
        const view = render(<StoryboardR2V />);
        fireEvent.click(screen.getByRole("button", { name: "cancel cancel-task" }));
        fireEvent.click(screen.getByRole("button", { name: "cancel cancel-task" }));
        expect(cancelVideoTask).toHaveBeenCalledOnce();
        await act(async () => { rejectCancel(new Error("cancel failed")); });
        expect(useProjectStore.getState().currentProject?.video_tasks?.[0].status).toBe("processing");
        cancelVideoTask.mockResolvedValueOnce({ ...task, status: "failed", error: "Canceled by user" });
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "cancel cancel-task" })); });
        expect(useProjectStore.getState().currentProject?.video_tasks?.[0].error).toBe("Canceled by user");
        view.unmount();
    });

    it("keeps refreshing tasks while editing, without overlapping reads or replacing saved frame fields", async () => {
        vi.useFakeTimers();
        const task = { id: "running-task", frame_id: "frame-poll", status: "processing", created_at: 1 };
        const project = { ...useProjectStore.getState().currentProject!, frames: [{ id: "frame-poll", action_description: "original" }], video_tasks: [task] };
        useProjectStore.setState({ currentProject: project } as never);
        let finishRead!: (value: unknown) => void;
        getProject.mockImplementation(() => new Promise(resolve => { finishRead = resolve; }));
        const view = render(<StoryboardR2V />);
        try {
            for (let index = 0; index < 6; index++) {
                fireEvent.change(screen.getByRole("textbox", { name: "shot prompt" }), { target: { value: `edit ${index}` } });
                await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
            }
            expect(getProject).toHaveBeenCalledOnce();
            await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
            expect(getProject).toHaveBeenCalledOnce();
            await act(async () => { finishRead({ ...project, video_tasks: [{ ...task, status: "failed", error: "provider unavailable" }] }); });
            expect(useProjectStore.getState().currentProject?.frames[0].action_description).toBe("edit 5");
            expect(useProjectStore.getState().currentProject?.video_tasks?.[0].status).toBe("failed");
        } finally { view.unmount(); vi.useRealTimers(); }
    });

    it("discards an old workspace task response even when the new workspace has the same project ID", async () => {
        vi.useFakeTimers();
        const auth = useAuthStore.getState();
        const project = { ...useProjectStore.getState().currentProject!, frames: [{ id: "frame-poll", action_description: "original" }], video_tasks: [{ id: "running-task", status: "processing" }] };
        useProjectStore.setState({ currentProject: project } as never);
        let finishRead!: (value: unknown) => void;
        getProject.mockImplementation(() => new Promise(resolve => { finishRead = resolve; }));
        const view = render(<StoryboardR2V />);
        try {
            await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
            act(() => {
                useAuthStore.setState({ activeWorkspace: { id: "workspace-next" } } as never);
                useProjectStore.setState({ currentProject: { ...project, title: "New workspace", video_tasks: [] } } as never);
            });
            await act(async () => { finishRead(project); });
            expect(useProjectStore.getState().currentProject?.title).toBe("New workspace");
            expect(useProjectStore.getState().currentProject?.video_tasks).toEqual([]);
        } finally { view.unmount(); useAuthStore.setState(auth); vi.useRealTimers(); }
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

    it("retries the saved task once across both entrances and navigation without changing current edits", async () => {
        const task: VideoTask = { id: "failed-history", project_id: "project-1", frame_id: "frame-retry", image_url: "old.png", prompt: "Historical prompt", model: "old-model", status: "failed", duration: 8, seed: 0, resolution: "1080p", generate_audio: false, prompt_extend: false, created_at: 1, workbench_tab: "direct_r2v" };
        const project = { ...useProjectStore.getState().currentProject!, frames: [{ id: "frame-retry", action_description: "Current edit" }], video_tasks: [task] };
        useProjectStore.setState({ currentProject: project, selectedFrameId: "frame-retry" });
        let finish!: (value: VideoTask) => void;
        retryVideoTask.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
        const view = render(<StoryboardR2V />);
        fireEvent.click(screen.getByRole("button", { name: "candidate retry failed-history" }));
        fireEvent.click(screen.getByRole("button", { name: "queue retry failed-history" }));
        expect(retryVideoTask).toHaveBeenCalledOnce();
        expect(retryVideoTask).toHaveBeenCalledWith("project-1", "failed-history");
        expect(createVideoTask).not.toHaveBeenCalled();
        fireEvent.change(screen.getByRole("textbox", { name: "shot prompt" }), { target: { value: "Typing during retry" } });
        view.unmount();
        const reopened = render(<StoryboardR2V />);
        expect(screen.getByRole("button", { name: "queue retry failed-history" })).toBeDisabled();
        const retried = { ...task, id: "retry-new", retry_of_task_id: task.id, status: "pending" as const, created_at: 2 };
        await act(async () => { finish(retried); });
        expect(useProjectStore.getState().currentProject!.video_tasks).toEqual([task, retried]);
        expect(screen.getByRole("textbox", { name: "shot prompt" })).toHaveValue("Typing during retry");
        reopened.unmount();
    });

    it("keeps failed retry requests recoverable and ignores responses from another workspace", async () => {
        const task: VideoTask = { id: "retry-scoped", project_id: "project-1", image_url: "", prompt: "Saved prompt", status: "failed", duration: 5, resolution: "720p", generate_audio: false, prompt_extend: false, created_at: 1 };
        useProjectStore.setState({ currentProject: { ...useProjectStore.getState().currentProject!, video_tasks: [task] } });
        retryVideoTask.mockRejectedValueOnce(new Error("offline"));
        const view = render(<StoryboardR2V />);
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "queue retry retry-scoped" })); });
        expect(candidateError).toHaveBeenCalledWith(expect.objectContaining({ message: "offline" }));
        expect(screen.getByRole("button", { name: "queue retry retry-scoped" })).toBeEnabled();
        let finish!: (value: VideoTask) => void;
        retryVideoTask.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
        fireEvent.click(screen.getByRole("button", { name: "queue retry retry-scoped" }));
        const workspace = useAuthStore.getState().activeWorkspace;
        try {
            await act(async () => { useAuthStore.setState({ activeWorkspace: { id: "other-retry-workspace", name: "Other", slug: null, role: "member" } }); });
            await act(async () => { finish({ ...task, id: "foreign-new", retry_of_task_id: task.id, status: "pending" }); });
            expect(useProjectStore.getState().currentProject!.video_tasks).toEqual([task]);
        } finally { view.unmount(); useAuthStore.setState({ activeWorkspace: workspace }); }
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
