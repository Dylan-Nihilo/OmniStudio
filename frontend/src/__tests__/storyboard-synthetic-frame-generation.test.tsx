// @vitest-environment happy-dom

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import StoryboardR2V, { useStoryboardRequests } from "@/components/modules/StoryboardR2V";
import StoryboardComposer from "@/components/modules/StoryboardComposer";
import { useShotDraftStore } from "@/components/modules/storyboard-r2v/useShotDrafts";
import { useDialogueAudioRequests } from "@/components/modules/storyboard-r2v/DialogueAudioRow";
import { useProjectStore } from "@/store/projectStore";
import { useAuthStore } from "@/store/authStore";
import type { VideoTask } from "@/lib/api";

const { createFrame, createVideoTask, retryVideoTask, renderFrame, uploadT2IFrame, getProject, generateDialogueAudioBatch, analyzeToStoryboard, refineBatchFrames, getTaskStatus, toastError, deleteFrame, reorderFrames, copyFrame, updateFrame, updateFrameWorkbench, refineSingleFrame, cancelVideoTask, annotateVideoTask, selectVideo, unpinVideo, autoSelectLatestVideo, candidateError } = vi.hoisted(() => ({
    createFrame: vi.fn(),
    createVideoTask: vi.fn(),
    retryVideoTask: vi.fn(),
    renderFrame: vi.fn(),
    uploadT2IFrame: vi.fn(),
    getProject: vi.fn(),
    generateDialogueAudioBatch: vi.fn(),
    analyzeToStoryboard: vi.fn(),
    refineBatchFrames: vi.fn(),
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
    API_URL: "http://localhost:17177",
    api: {
        createVideoTask,
        retryVideoTask,
        renderFrame,
        uploadT2IFrame,
        getProject,
        generateDialogueAudioBatch,
        analyzeToStoryboard,
        refineBatchFrames,
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

vi.mock("@/components/modules/storyboard-r2v/ShotCard", async importOriginal => ({
    ...await importOriginal<typeof import("@/components/modules/storyboard-r2v/ShotCard")>(),
    default: (props: {
        onRefineFrame: () => void;
        onUpdatePrompt: (value: string) => void;
        onGenerateBatch: (count: number) => void;
        onGenerateT2I: () => void;
        sequence?: React.ReactNode;
        candidates?: React.ReactNode;
        configuration?: React.ReactNode;
        audio?: React.ReactNode;
        shot: { id: string; prompt: string; videoUrl?: string; t2iImageUrl?: string; t2iStatus?: string; t2iError?: string };
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
            <button onClick={props.onGenerateT2I}>generate first frame</button>
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
            <output aria-label="first frame">{props.shot.t2iImageUrl}</output>
            <output aria-label="first frame state">{props.shot.t2iStatus}</output>
            <output aria-label="first frame error">{props.shot.t2iError}</output>
            <textarea aria-label="shot prompt" value={props.shot.prompt} onChange={event => props.onUpdatePrompt(event.target.value)} />
            {props.sequence}
            {props.candidates}
            {props.configuration}
            {props.audio}
        </div>
    ),
}));

vi.mock("@/components/modules/storyboard-r2v/DialogueAudioRow", async importOriginal => ({
    ...await importOriginal<typeof import("@/components/modules/storyboard-r2v/DialogueAudioRow")>(),
    default: ({ frameId, voiceId, generationStatus, dubGenerationStatus, onUpdateDialogue, onAudioUpdated }: { frameId: string; voiceId?: string; generationStatus?: string; dubGenerationStatus?: string; onUpdateDialogue: (text: string) => Promise<void>; onAudioUpdated: (result: unknown) => void }) => <>
        <output aria-label="dialogue voice">{voiceId}</output><output aria-label="audio state">{generationStatus}</output>
        <output aria-label="dub state">{dubGenerationStatus}</output>
        <button onClick={() => { void onUpdateDialogue("Saved dialogue").catch(candidateError); }}>save dialogue</button>
        <button onClick={() => onAudioUpdated({ frames: [{ id: frameId, action_description: "Stale prompt", dialogue: "Stale dialogue", audio_url: "new-audio.mp3", dialogue_snapshot_text: "Saved dialogue", audio_generation_status: "completed" }] })}>audio completed</button>
    </>,
}));
vi.mock("@/components/modules/storyboard-r2v/StoryboardGenerateDialog", () => ({ default: ({ isOpen, onConfirm }: { isOpen: boolean; onConfirm: () => void }) => isOpen ? <button onClick={onConfirm}>confirm storyboard</button> : null }));
vi.mock("@/components/modules/storyboard-r2v/AssetDrawer", () => ({ default: () => null }));
vi.mock("@/components/modules/storyboard-r2v/shot-panel/ParamsSection", () => ({ default: () => null }));
vi.mock("@/components/modules/storyboard-r2v/shot-panel/T2ISubsection", () => ({ default: ({ onUpload, onRemove }: { onUpload: (file: File) => Promise<unknown>; onRemove: (index: number) => void }) => <><button onClick={() => { void onUpload(new File(['image'], 'first-frame.png', { type: 'image/png' })); }}>upload first frame</button><button onClick={() => onRemove(0)}>remove first frame</button></> }));
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
vi.mock("@/components/modules/storyboard-r2v/shot-panel/usePanelSectionState", () => ({
    overridePanelSectionState: vi.fn(),
}));

describe("StoryboardR2V synthetic frame generation", () => {
    it("does not repeat a pending copy when switching to the legacy storyboard", async () => {
        const frames = [{ id: "first", action_description: "First shot" }, { id: "second", action_description: "Second shot" }];
        const project = { ...useProjectStore.getState().currentProject!, frames };
        useProjectStore.setState({ currentProject: project, selectedFrameId: "first" });
        let finish!: () => void;
        copyFrame.mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve({ ...project, frames: [frames[0], { id: "copy", action_description: "Copied shot" }, frames[1]] }); }));
        const first = render(<StoryboardR2V />);
        let legacy: ReturnType<typeof render> | undefined;
        const alert = vi.spyOn(window, "alert").mockImplementation(() => {});
        try {
            fireEvent.click(screen.getByRole("button", { name: "copy shot" }));
            await waitFor(() => expect(copyFrame).toHaveBeenCalledOnce());
            first.unmount();
            legacy = render(<StoryboardComposer />);
            fireEvent.click(legacy.container.querySelector('[data-tip="duplicateFrame"]')!);
            expect(copyFrame).toHaveBeenCalledOnce();
            await act(async () => { finish(); });
            expect(screen.getByText("Copied shot")).toBeVisible();
        } finally { first.unmount(); legacy?.unmount(); alert.mockRestore(); }
    });

    it.each(["copy", "delete", "reorder"] as const)("keeps a pending %s across reentry and shows the confirmed sequence", async operation => {
        const frames = [{ id: "first", action_description: "First shot" }, { id: "second", action_description: "Second shot" }];
        const ordered = operation === "delete" ? [frames[1]] : operation === "reorder" ? [frames[1], frames[0]] : [frames[0], { id: "copy", action_description: "Copied shot" }, frames[1]];
        const project = { ...useProjectStore.getState().currentProject!, frames };
        useProjectStore.setState({ currentProject: project, selectedFrameId: "first" });
        const mutation = { copy: copyFrame, delete: deleteFrame, reorder: reorderFrames }[operation];
        let finish!: () => void;
        mutation.mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve({ ...project, frames: ordered }); }));
        const name = { copy: "copy shot", delete: "delete shot", reorder: "move down" }[operation];
        const first = render(<StoryboardR2V />);
        let reopened: ReturnType<typeof render> | undefined;
        try {
            fireEvent.click(screen.getByRole("button", { name }));
            await waitFor(() => expect(mutation).toHaveBeenCalledOnce());
            first.unmount();
            reopened = render(<StoryboardR2V />);
            expect(screen.getByRole("status", { name: "saveStatus" })).toHaveTextContent("saving");
            fireEvent.click(screen.getByRole("button", { name }));
            expect(mutation).toHaveBeenCalledOnce();
            await act(async () => { finish(); });
            expect(screen.getAllByRole("button", { name: "selectShot" }).map(node => node.textContent)).toEqual(ordered.map(frame => expect.stringContaining(frame.action_description)));
            expect(screen.getByRole("status", { name: "saveStatus" })).toHaveTextContent("saved");
        } finally { first.unmount(); reopened?.unmount(); }
    });

    it.each(["add", "copy", "delete", "reorder"] as const)("keeps edits to retained shots when a delayed %s response updates the sequence", async operation => {
        const frames = [{ id: "first", action_description: "First shot" }, { id: "second", action_description: "Second shot" }];
        const inserted = { id: "inserted", action_description: operation === "copy" ? "First shot" : "" };
        const ordered = operation === "delete" ? [frames[1]] : operation === "reorder" ? [frames[1], frames[0]] : [frames[0], inserted, frames[1]];
        const project = { ...useProjectStore.getState().currentProject!, frames };
        useProjectStore.setState({ currentProject: project, selectedFrameId: "first" });
        let finish!: () => void;
        const mutation = { add: createFrame, copy: copyFrame, delete: deleteFrame, reorder: reorderFrames }[operation];
        mutation.mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve({ ...project, frames: ordered }); }));
        const view = render(<StoryboardR2V />);
        let reopened: ReturnType<typeof render> | undefined;
        try {
            fireEvent.click(screen.getByRole("button", { name: { add: "addShot", copy: "copy shot", delete: "delete shot", reorder: "move down" }[operation] }));
            await waitFor(() => expect(mutation).toHaveBeenCalledOnce());
            fireEvent.click(screen.getAllByRole("button", { name: "selectShot" }).find(node => node.textContent?.includes("Second shot"))!);
            fireEvent.change(screen.getByRole("textbox", { name: "shot prompt" }), { target: { value: "New retained writing" } });
            fireEvent.click(screen.getByRole("button", { name: "saveNow" }));
            await waitFor(() => expect(screen.getByRole("status", { name: "saveStatus" })).not.toHaveTextContent("unsaved"));
            await waitFor(() => expect(useProjectStore.getState().currentProject!.frames.find(frame => frame.id === "second").action_description).toBe("New retained writing"));
            await act(async () => { finish(); });
            expect(useProjectStore.getState().currentProject!.frames.map(frame => frame.id)).toEqual(ordered.map(frame => frame.id));
            expect(useProjectStore.getState().currentProject!.frames.find(frame => frame.id === "second").action_description).toBe("New retained writing");
            expect(useProjectStore.getState().selectedFrameId).toBe("second");
            view.unmount();
            reopened = render(<StoryboardR2V />);
            fireEvent.click(screen.getAllByRole("button", { name: "selectShot" }).find(node => node.textContent?.includes("New retained writing"))!);
            expect(screen.getByRole("textbox", { name: "shot prompt" })).toHaveValue("New retained writing");
        } finally { view.unmount(); reopened?.unmount(); }
    });

    it("continues once when status polling observes analysis before its POST response", async () => {
        vi.useFakeTimers();
        const project = { ...useProjectStore.getState().currentProject!, originalText: "A radio operator listens for a signal in the dark.".repeat(2), frames: [{ id: "old", action_description: "Original" }] };
        const analyzed = { ...project, frames: [{ id: "new", action_description: "Generated shot" }], storyboard_generation: { id: "analysis-race", phase: "analyze", status: "completed", frame_ids: ["new"], results: {} } };
        useProjectStore.setState({ currentProject: project });
        let finish!: () => void;
        analyzeToStoryboard.mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve(analyzed); }));
        getProject.mockResolvedValue(analyzed);
        refineBatchFrames.mockRejectedValueOnce({ response: { status: 400, data: { detail: "Refinement unavailable" } } });
        const view = render(<StoryboardR2V />);
        try {
            fireEvent.click(screen.getByRole("button", { name: "genShots" }));
            await act(async () => { fireEvent.click(screen.getByRole("button", { name: "confirm storyboard" })); await vi.advanceTimersByTimeAsync(10000); });
            expect(screen.getByRole("textbox", { name: "shot prompt" })).toHaveValue("Generated shot");
            expect(screen.getByRole("button", { name: "genInFlight" })).toHaveAttribute("aria-disabled", "true");
            expect(screen.queryByText("storyboardChangedDuringAnalysis")).not.toBeInTheDocument();
            fireEvent.change(screen.getByRole("textbox", { name: "shot prompt" }), { target: { value: "Edit the generated shot" } });
            await act(async () => { finish(); });
            expect(refineBatchFrames).toHaveBeenCalledWith(project.id, expect.any(Function), ["new"]);
            expect(screen.queryByText("storyboardChangedDuringAnalysis")).not.toBeInTheDocument();
            expect(screen.getByRole("textbox", { name: "shot prompt" })).toHaveValue("Edit the generated shot");
            expect(updateFrame).toHaveBeenLastCalledWith(project.id, "new", { action_description: "Edit the generated shot" });
        } finally { view.unmount(); vi.useRealTimers(); }
    });

    it("continues confirmed analysis through refinement and preserves edits made during the stream", async () => {
        vi.useFakeTimers();
        const project = { ...useProjectStore.getState().currentProject!, originalText: "A radio operator listens for a signal in the dark.".repeat(2), frames: [{ id: "old", action_description: "Original" }] };
        const frame = { id: "generated", action_description: "Generated coarse shot", audio_url: "keep.wav" };
        const analyzed = { ...project, frames: [frame], storyboard_generation: { id: "analysis", phase: "analyze", status: "completed", frame_ids: [frame.id], results: {} } };
        useProjectStore.setState({ currentProject: project });
        analyzeToStoryboard.mockResolvedValueOnce(analyzed);
        let finish!: () => void;
        refineBatchFrames.mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve({ total: 1, success: 1, failed: 0 }); }));
        getProject.mockResolvedValueOnce({ ...analyzed, frames: [{ ...frame, visual_description: "AI result", audio_url: "stale.wav" }], storyboard_generation: { id: "refinement", phase: "refine", status: "completed", frame_ids: [frame.id], results: { [frame.id]: "completed" } } });
        const view = render(<StoryboardR2V />);
        try {
            fireEvent.click(screen.getByRole("button", { name: "genShots" }));
            await act(async () => { fireEvent.click(screen.getByRole("button", { name: "confirm storyboard" })); });
            expect(refineBatchFrames).toHaveBeenCalledWith(project.id, expect.any(Function), [frame.id]);
            expect(screen.getByRole("textbox", { name: "shot prompt" })).toHaveValue("Generated coarse shot");
            fireEvent.change(screen.getByRole("textbox", { name: "shot prompt" }), { target: { value: "New writing" } });
            await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
            expect(updateFrame).not.toHaveBeenCalled();
            await act(async () => { finish(); });
            expect(screen.getByRole("textbox", { name: "shot prompt" })).toHaveValue("New writing");
            expect(updateFrame).toHaveBeenLastCalledWith(project.id, frame.id, { visual_description: "New writing" });
            expect(useProjectStore.getState().currentProject!.frames[0].audio_url).toBe("keep.wav");
            expect(screen.getByRole("button", { name: "genShots" })).toBeEnabled();
        } finally { view.unmount(); vi.useRealTimers(); }
    });

    it.each([false, true])("queries uncertain analysis before retrying and protects newer writing: %s", async edited => {
        vi.useFakeTimers();
        const frame = { id: "uncertain-old", action_description: "Original writing" };
        const project = { ...useProjectStore.getState().currentProject!, originalText: "A radio operator listens for a signal in the dark.".repeat(2), frames: [frame] };
        const job = { id: "recovered-analysis", phase: "analyze", status: "processing", frame_ids: [frame.id], results: {} };
        useProjectStore.setState({ currentProject: project });
        analyzeToStoryboard.mockRejectedValueOnce(new Error("timeout"));
        getProject.mockRejectedValueOnce(new Error("offline"))
            .mockResolvedValueOnce({ ...project, storyboard_generation: job })
            .mockResolvedValueOnce({ ...project, storyboard_generation: { ...job, status: "completed", frame_ids: ["recovered"] }, frames: [{ id: "recovered", action_description: "Recovered result" }] });
        const first = render(<StoryboardR2V />);
        let reopened: ReturnType<typeof render> | undefined;
        try {
            fireEvent.click(screen.getByRole("button", { name: "genShots" }));
            await act(async () => { fireEvent.click(screen.getByRole("button", { name: "confirm storyboard" })); });
            expect(screen.getByText("storyboardRefreshFailed")).toBeInTheDocument();
            expect(screen.getByRole("button", { name: "genInFlight" })).toHaveAttribute("aria-disabled", "true");
            await act(async () => { fireEvent.click(screen.getByRole("button", { name: "refreshStatus" })); });
            first.unmount();
            reopened = render(<StoryboardR2V />);
            if (edited) {
                fireEvent.change(screen.getByRole("textbox", { name: "shot prompt" }), { target: { value: "New writing" } });
                await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
                expect(updateFrame).not.toHaveBeenCalled();
                updateFrame.mockRejectedValueOnce(new Error("Old frame was replaced"));
            }
            await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
            expect(screen.getByRole("textbox", { name: "shot prompt" })).toHaveValue(edited ? "New writing" : "Recovered result");
            if (edited) expect(screen.getByText("storyboardChangedDuringAnalysis")).toBeInTheDocument();
            else expect(screen.getByRole("button", { name: "storyboardContinueRefinement" })).toBeInTheDocument();
            expect(analyzeToStoryboard).toHaveBeenCalledOnce();
            expect(refineBatchFrames).not.toHaveBeenCalled();
        } finally { first.unmount(); reopened?.unmount(); vi.useRealTimers(); }
    });

    it("reads completed analysis after reload and continues refinement without analyzing again", async () => {
        vi.useFakeTimers();
        const job = { id: "analysis-after-reload", phase: "analyze", status: "processing", frame_ids: ["old"], results: {} };
        const project = { ...useProjectStore.getState().currentProject!, frames: [{ id: "old", action_description: "Old shot" }], storyboard_generation: job };
        useProjectStore.setState({ currentProject: project } as never);
        getProject.mockResolvedValueOnce({ ...project, storyboard_generation: { ...job, status: "completed", frame_ids: ["new"] }, frames: [{ id: "new", action_description: "Recovered shot" }] });
        refineBatchFrames.mockRejectedValueOnce({ response: { status: 400, data: { detail: "Not available" } } });
        const view = render(<StoryboardR2V />);
        try {
            await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
            expect(screen.getByRole("textbox", { name: "shot prompt" })).toHaveValue("Recovered shot");
            expect(refineBatchFrames).not.toHaveBeenCalled();
            await act(async () => { fireEvent.click(screen.getByRole("button", { name: "storyboardContinueRefinement" })); });
            expect(refineBatchFrames).toHaveBeenCalledWith(project.id, expect.any(Function), ["new"]);
            expect(analyzeToStoryboard).not.toHaveBeenCalled();
        } finally { view.unmount(); vi.useRealTimers(); }
    });

    it("retries only unfinished refinement shots without regenerating the storyboard", async () => {
        vi.useFakeTimers();
        const frames = [
            { id: "refined", action_description: "Done", visual_description: "Keep this result" },
            { id: "failed", action_description: "Needs refinement" },
            { id: "unprocessed", action_description: "Not started" },
        ];
        const job = { id: "partial-refinement", phase: "refine", status: "failed", frame_ids: [...frames.map(frame => frame.id), "deleted"], results: { refined: "completed", failed: "failed" } };
        const project = { ...useProjectStore.getState().currentProject!, frames, storyboard_generation: job };
        useProjectStore.setState({ currentProject: project } as never);
        let finish!: () => void;
        refineBatchFrames.mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve({ total: 2, success: 2, failed: 0 }); }));
        getProject.mockResolvedValue({ ...project, storyboard_generation: { ...job, id: "retry-job", status: "completed", frame_ids: ["failed", "unprocessed"], results: { failed: "completed", unprocessed: "completed" } }, frames: [frames[0], { ...frames[1], visual_description: "Refined second" }, { ...frames[2], visual_description: "Refined third" }] });
        const first = render(<StoryboardR2V />);
        let reopened: ReturnType<typeof render> | undefined;
        try {
            await act(async () => { fireEvent.click(screen.getByRole("button", { name: "storyboardRetryRefinement" })); });
            expect(refineBatchFrames).toHaveBeenCalledWith(project.id, expect.any(Function), ["failed", "unprocessed"]);
            first.unmount();
            reopened = render(<StoryboardR2V />);
            expect(screen.getByRole("button", { name: "genInFlight" })).toHaveAttribute("aria-disabled", "true");
            await act(async () => { finish(); await vi.advanceTimersByTimeAsync(5000); });
            expect(screen.queryByRole("button", { name: "storyboardRetryRefinement" })).not.toBeInTheDocument();
            expect(useProjectStore.getState().currentProject!.frames[0].visual_description).toBe("Keep this result");
            expect(useProjectStore.getState().currentProject!.frames[1].visual_description).toBe("Refined second");
            expect(analyzeToStoryboard).not.toHaveBeenCalled();
            expect(refineBatchFrames).toHaveBeenCalledOnce();
        } finally { first.unmount(); reopened?.unmount(); vi.useRealTimers(); }
    });

    it("recovers a refining batch after reentry and saves newer coarse edits as visual descriptions", async () => {
        vi.useFakeTimers();
        const frame = { id: "refine-reload", action_description: "Original", audio_url: "keep.wav" };
        const job = { id: "refining-batch", phase: "refine", status: "processing", frame_ids: [frame.id], results: {} };
        const project = { ...useProjectStore.getState().currentProject!, frames: [frame], storyboard_generation: job };
        useProjectStore.setState({ currentProject: project } as never);
        getProject.mockResolvedValueOnce({ ...project, storyboard_generation: { ...job, status: "completed", results: { [frame.id]: "completed" } }, frames: [{ ...frame, visual_description: "AI result", audio_url: "stale.wav" }] });
        const first = render(<StoryboardR2V />);
        let reopened: ReturnType<typeof render> | undefined;
        try {
            expect(screen.getByRole("button", { name: "genInFlight" })).toHaveAttribute("aria-disabled", "true");
            expect(screen.getByText("bannerRefineProgress")).toBeInTheDocument();
            fireEvent.change(screen.getByRole("textbox", { name: "shot prompt" }), { target: { value: "New writing" } });
            await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
            expect(updateFrame).not.toHaveBeenCalled();
            first.unmount();
            reopened = render(<StoryboardR2V />);
            await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
            expect(screen.getByRole("textbox", { name: "shot prompt" })).toHaveValue("New writing");
            expect(updateFrame).toHaveBeenLastCalledWith(project.id, frame.id, { visual_description: "New writing" });
            expect(useProjectStore.getState().currentProject!.frames[0]).toMatchObject({ audio_url: "keep.wav", visual_description: "New writing" });
            expect(screen.getByRole("button", { name: "genShots" })).toBeEnabled();
            await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
            expect(getProject).toHaveBeenCalledOnce();
            expect(analyzeToStoryboard).not.toHaveBeenCalled();
        } finally { first.unmount(); reopened?.unmount(); vi.useRealTimers(); }
    });

    it("keeps existing storyboard shots when replacement generation fails", async () => {
        const frame = { id: "original-shot", action_description: "Keep the original shot" };
        useProjectStore.setState(state => ({ currentProject: { ...state.currentProject!, originalText: "A radio operator listens for a signal in the dark.".repeat(2), frames: [frame] } }));
        analyzeToStoryboard.mockRejectedValueOnce(new Error("Analysis unavailable"));
        render(<StoryboardR2V />);
        fireEvent.click(screen.getByRole("button", { name: "genShots" }));
        fireEvent.click(screen.getByRole("button", { name: "confirm storyboard" }));
        await waitFor(() => expect(toastError).toHaveBeenCalled());
        expect(screen.getByRole("textbox", { name: "shot prompt" })).toHaveValue("Keep the original shot");
        expect(useProjectStore.getState().currentProject!.frames).toEqual([frame]);
    });

    it("saves before batch dialogue, retains its request on reentry and merges only audio", async () => {
        const frame = { id: "batch-frame", action_description: "Original", dialogue: "Current dialogue", character_ids: ["character-1"] };
        const project = { ...useProjectStore.getState().currentProject!, frames: [frame], characters: [{ id: "character-1", name: "Speaker", voice_id: "voice" }] };
        useProjectStore.setState({ currentProject: project } as never);
        const auth = useAuthStore.getState();
        const key = JSON.stringify([auth.user?.id, auth.activeWorkspace?.id, project.id, frame.id]);
        useDialogueAudioRequests.setState({ [key]: { instructions: "whisper" } });
        let finishSave!: () => void;
        updateFrame.mockImplementationOnce(() => new Promise(resolve => { finishSave = () => resolve({}); }));
        let finishBatch!: () => void;
        const batch = { id: "batch-1", status: "completed", frame_ids: [frame.id], results: { [frame.id]: "generated" }, instructions: { [frame.id]: "whisper" } };
        generateDialogueAudioBatch.mockImplementationOnce(() => new Promise(resolve => { finishBatch = () => resolve({ ...project, dialogue_audio_batch: batch, frames: [{ ...frame, audio_url: "batch.mp3", dialogue_snapshot_text: frame.dialogue, dialogue_voice_id: "voice", dialogue_instructions: "whisper" }], _batch_stats: { generated: 1, skipped: 0, failed: 0, no_voice: 0, busy: 0 } }); }));
        const view = render(<StoryboardR2V />);
        fireEvent.change(screen.getByRole("textbox", { name: "shot prompt" }), { target: { value: "Saved first" } });
        fireEvent.click(screen.getByRole("button", { name: "bannerSynthDialogue" }));
        await waitFor(() => expect(updateFrame).toHaveBeenCalledOnce());
        expect(generateDialogueAudioBatch).not.toHaveBeenCalled();
        await act(async () => finishSave());
        expect(generateDialogueAudioBatch).toHaveBeenCalledWith(project.id, { [frame.id]: "whisper" });
        view.unmount();
        render(<StoryboardR2V />);
        expect(screen.getByRole("button", { name: "bannerSynthDialogue" })).toHaveAttribute("aria-disabled", "true");
        fireEvent.change(screen.getByRole("textbox", { name: "shot prompt" }), { target: { value: "Later writing" } });
        await act(async () => finishBatch());
        expect(useProjectStore.getState().currentProject!.frames[0]).toMatchObject({ action_description: "Saved first", audio_url: "batch.mp3" });
        expect(screen.getByRole("textbox", { name: "shot prompt" })).toHaveValue("Later writing");
        expect(getProject).not.toHaveBeenCalled();
    });

    it("retains drafts on save failure and recovers an uncertain batch before retrying its instructions", async () => {
        vi.useFakeTimers();
        const frame = { id: "batch-retry", dialogue: "Current line", action_description: "Original", character_ids: ["speaker"] };
        const project = { ...useProjectStore.getState().currentProject!, frames: [frame], characters: [{ id: "speaker", name: "Speaker", voice_id: "voice" }] };
        useProjectStore.setState({ currentProject: project } as never);
        updateFrame.mockRejectedValueOnce(new Error("save failed"));
        generateDialogueAudioBatch.mockRejectedValueOnce({ response: { status: 500, data: { detail: "Connection lost" } } });
        getProject.mockRejectedValueOnce(new Error("offline"));
        const batch = { id: "recovered-batch", status: "failed", frame_ids: [frame.id], results: { [frame.id]: "failed" }, instructions: { [frame.id]: "whisper" }, error: "Worker restarted" };
        getProject.mockResolvedValueOnce({ ...project, dialogue_audio_batch: batch });
        const view = render(<StoryboardR2V />);
        try {
            fireEvent.change(screen.getByRole("textbox", { name: "shot prompt" }), { target: { value: "Keep this draft" } });
            await act(async () => { fireEvent.click(screen.getByRole("button", { name: "bannerSynthDialogue" })); });
            expect(generateDialogueAudioBatch).not.toHaveBeenCalled();
            expect(screen.getByRole("textbox", { name: "shot prompt" })).toHaveValue("Keep this draft");
            await act(async () => { fireEvent.click(screen.getByRole("button", { name: "batchDialogueRetry" })); });
            expect(generateDialogueAudioBatch).toHaveBeenCalledOnce();
            expect(screen.getByRole("button", { name: "bannerSynthDialogue" })).toHaveAttribute("aria-disabled", "true");
            await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
            expect(screen.getByText("batchDialogueRefreshFailed")).toBeInTheDocument();
            await act(async () => { fireEvent.click(screen.getByRole("button", { name: "refreshStatus" })); });
            expect(screen.getByText("Worker restarted")).toBeInTheDocument();
            generateDialogueAudioBatch.mockResolvedValueOnce({ ...project, dialogue_audio_batch: { ...batch, id: "retried", status: "completed", error: null, results: { [frame.id]: "generated" } } });
            await act(async () => { fireEvent.click(screen.getByRole("button", { name: "batchDialogueRetry" })); });
            expect(generateDialogueAudioBatch).toHaveBeenLastCalledWith(project.id, { [frame.id]: "whisper" });
            expect(useProjectStore.getState().currentProject!.frames[0].action_description).toBe("Keep this draft");
        } finally { view.unmount(); vi.useRealTimers(); }
    });

    it("does not merge a completed batch into another workspace with the same project ID", async () => {
        const workspace = useAuthStore.getState().activeWorkspace;
        const frame = { id: "scope-frame", dialogue: "Private line", character_ids: ["speaker"] };
        const project = { ...useProjectStore.getState().currentProject!, frames: [frame], characters: [{ id: "speaker", name: "Speaker", voice_id: "voice" }] };
        useProjectStore.setState({ currentProject: project } as never);
        let finish!: () => void;
        generateDialogueAudioBatch.mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve({ ...project, frames: [{ ...frame, audio_url: "private.mp3" }], dialogue_audio_batch: { id: "private", status: "completed", frame_ids: [frame.id], results: {}, instructions: {} } }); }));
        const view = render(<StoryboardR2V />);
        try {
            await act(async () => { fireEvent.click(screen.getByRole("button", { name: "bannerSynthDialogue" })); });
            await act(async () => { useAuthStore.setState({ activeWorkspace: { id: "another-workspace", name: "Other", slug: null, role: "member" } }); });
            await act(async () => finish());
            expect(useProjectStore.getState().currentProject!.frames[0].audio_url).toBeUndefined();
            expect(useProjectStore.getState().currentProject!.dialogue_audio_batch).toBeUndefined();
        } finally { view.unmount(); useAuthStore.setState({ activeWorkspace: workspace }); }
    });

    it.each(["batch", "audio"])("keeps a newer remote %s result when an older batch response arrives", async kind => {
        const frame = { id: "late-frame", dialogue: "A line", audio_generation_id: "original", character_ids: ["speaker"] };
        const project = { ...useProjectStore.getState().currentProject!, frames: [frame], characters: [{ id: "speaker", name: "Speaker", voice_id: "voice" }] };
        useProjectStore.setState({ currentProject: project } as never);
        let finish!: () => void;
        const oldBatch = { id: "old-batch", status: "completed", frame_ids: [frame.id], results: { [frame.id]: "generated" }, instructions: {} };
        generateDialogueAudioBatch.mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve({ ...project, dialogue_audio_batch: oldBatch, frames: [{ ...frame, audio_url: "old.mp3", audio_generation_id: "old-audio" }] }); }));
        render(<StoryboardR2V />);
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "bannerSynthDialogue" })); });
        await act(async () => { useProjectStore.setState({ currentProject: { ...project, dialogue_audio_batch: { ...oldBatch, id: kind === "batch" ? "new-batch" : oldBatch.id }, frames: [{ ...frame, audio_url: "new.mp3", audio_generation_id: "new-audio" }] } } as never); });
        await act(async () => finish());
        expect(useProjectStore.getState().currentProject!.frames[0].audio_url).toBe("new.mp3");
        expect(useProjectStore.getState().currentProject!.dialogue_audio_batch!.id).toBe(kind === "batch" ? "new-batch" : oldBatch.id);
    });

    it("recovers batch progress after reload without overwriting newer frame fields", async () => {
        vi.useFakeTimers();
        const frame = { id: "batch-reload", action_description: "New writing", dialogue: "New dialogue", audio_url: "old.mp3" };
        const batch = { id: "persisted-batch", status: "processing", frame_ids: [frame.id], results: {}, instructions: {} };
        const project = { ...useProjectStore.getState().currentProject!, frames: [frame], dialogue_audio_batch: batch };
        useProjectStore.setState({ currentProject: project } as never);
        getProject.mockResolvedValueOnce({ ...project, dialogue_audio_batch: { ...batch, status: "completed", results: { [frame.id]: "generated" } }, frames: [{ ...frame, action_description: "Old writing", dialogue: "Old dialogue", audio_url: "finished.mp3" }] });
        const view = render(<StoryboardR2V />);
        try {
            expect(screen.getByText("bannerDialogueProgress")).toBeInTheDocument();
            await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
            expect(useProjectStore.getState().currentProject!.frames[0]).toMatchObject({ action_description: "New writing", dialogue: "New dialogue", audio_url: "finished.mp3" });
            expect(screen.getByText("batchDialogueResults")).toBeInTheDocument();
            await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
            expect(getProject).toHaveBeenCalledOnce();
            expect(generateDialogueAudioBatch).not.toHaveBeenCalled();
        } finally { view.unmount(); vi.useRealTimers(); }
    });

    it("recovers a persisted dub preview without replacing current audio or text", async () => {
        vi.useFakeTimers();
        const frame = { id: "dub-reload", action_description: "New writing", dialogue: "Current dialogue", audio_url: "current.wav", dub_generation_status: "processing", dub_generation_id: "new-dub" };
        const project = { ...useProjectStore.getState().currentProject!, frames: [frame] };
        const auth = useAuthStore.getState();
        const key = JSON.stringify([auth.user?.id, auth.activeWorkspace?.id, project.id, frame.id]);
        useProjectStore.setState({ currentProject: project });
        useDialogueAudioRequests.setState({ [key]: { recovering: true, recoveryKind: "dub", previousGenerationId: "old-dub" } });
        getProject.mockResolvedValue({ ...project, frames: [{ ...frame, audio_url: "stale.wav", action_description: "Old writing", dub_generation_status: "completed", preview_video_url: "preview.mp4", preview_audio_url: "current.wav" }] });
        const view = render(<StoryboardR2V />);
        try {
            await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
            expect(screen.getByLabelText("dub state")).toHaveTextContent("completed");
            expect(useProjectStore.getState().currentProject!.frames[0]).toMatchObject({ audio_url: "current.wav", action_description: "New writing", preview_video_url: "preview.mp4" });
            await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
            expect(getProject).toHaveBeenCalledOnce();
        } finally { view.unmount(); useDialogueAudioRequests.setState({}, true); vi.useRealTimers(); }
    });

    it("uses the explicit speaker and merges audio without replacing dialogue or other edits", async () => {
        useProjectStore.setState(state => ({ currentProject: { ...state.currentProject!,
            characters: [{ id: "silent", name: "Silent" }, { id: "speaker", name: "Speaker", voice_id: "speaker-voice" }],
            frames: [{ id: "audio-frame", action_description: "Original prompt", character_ids: ["silent", "speaker"], dialogue_structured: { speaker: "Speaker", line: "Original dialogue" } }],
        } } as never));
        render(<StoryboardR2V />);
        expect(screen.getByLabelText("dialogue voice")).toHaveTextContent("speaker-voice");
        fireEvent.change(screen.getByRole("textbox", { name: "shot prompt" }), { target: { value: "New prompt" } });
        fireEvent.click(screen.getByRole("button", { name: "save dialogue" }));
        await waitFor(() => expect(useProjectStore.getState().currentProject!.frames[0].dialogue_structured.line).toBe("Saved dialogue"));
        fireEvent.click(screen.getByRole("button", { name: "audio completed" }));
        const frame = useProjectStore.getState().currentProject!.frames[0];
        expect(frame.audio_url).toBe("new-audio.mp3");
        expect(frame.action_description).toBe("New prompt");
        expect(frame.dialogue_structured.line).toBe("Saved dialogue");
        expect(screen.getByRole("textbox", { name: "shot prompt" })).toHaveValue("New prompt");
    });

    it("recovers persisted dialogue generation through the shared project poll without replacing input", async () => {
        vi.useFakeTimers();
        const frame = { id: "audio-reload", action_description: "New prompt", dialogue: "New dialogue", audio_url: "old.mp3", audio_generation_status: "processing", audio_generation_id: "audio-current" };
        const project = { ...useProjectStore.getState().currentProject!, frames: [frame] };
        useProjectStore.setState({ currentProject: project });
        getProject.mockResolvedValueOnce({ ...project, frames: [{ ...frame, action_description: "Old prompt", dialogue: "Old dialogue", audio_url: "finished.mp3", audio_generation_status: "completed" }] });
        const view = render(<StoryboardR2V />);
        try {
            expect(screen.getByLabelText("audio state")).toHaveTextContent("processing");
            await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
            expect(screen.getByLabelText("audio state")).toHaveTextContent("completed");
            expect(useProjectStore.getState().currentProject!.frames[0].dialogue).toBe("New dialogue");
            expect(useProjectStore.getState().currentProject!.frames[0].audio_url).toBe("finished.mp3");
            await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
            expect(getProject).toHaveBeenCalledOnce();
        } finally { view.unmount(); vi.useRealTimers(); }
    });

    it("stops recovering a deleted frame while retaining dialogue and previous media", async () => {
        vi.useFakeTimers();
        const frame = { id: "audio-deleted", action_description: "Keep writing", dialogue: "Keep dialogue", audio_url: "old.mp3", audio_generation_status: "processing", image_generation_status: "processing", workbench_tab_mode: "t2i_i2v", t2i_image_urls: ["old.png"] };
        const project = { ...useProjectStore.getState().currentProject!, frames: [frame] };
        const auth = useAuthStore.getState();
        const key = JSON.stringify([auth.user?.id, auth.activeWorkspace?.id, project.id, frame.id]);
        useProjectStore.setState({ currentProject: project });
        useDialogueAudioRequests.setState({ [key]: { recovering: true, instructions: "whisper" } });
        getProject.mockResolvedValue({ ...project, frames: [] });
        const view = render(<StoryboardR2V />);
        try {
            await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
            expect(screen.getByLabelText("audio state")).toHaveTextContent("failed");
            expect(useProjectStore.getState().currentProject!.frames[0]).toMatchObject({ dialogue: "Keep dialogue", audio_url: "old.mp3", image_generation_status: "failed" });
            expect(screen.getByRole("textbox", { name: "shot prompt" })).toHaveValue("Keep writing");
            await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
            expect(getProject).toHaveBeenCalledOnce();
        } finally { view.unmount(); useDialogueAudioRequests.setState({}, true); vi.useRealTimers(); }
    });

    it("recovers a persisted first-frame render after reload without duplicate requests or lost edits", async () => {
        vi.useFakeTimers();
        const frame = { id: "frame-render-reload", action_description: "Original", workbench_tab_mode: "t2i_i2v", t2i_image_urls: ["old.png"], t2i_selected_index: 0, image_generation_status: "processing", image_generation_id: "render-reload" };
        const project = { ...useProjectStore.getState().currentProject!, frames: [frame] };
        useProjectStore.setState({ currentProject: project });
        let finishRead!: (value: unknown) => void;
        getProject.mockImplementation(() => new Promise(resolve => { finishRead = resolve; }));
        const view = render(<StoryboardR2V />);
        try {
            expect(screen.getByLabelText("first frame state")).toHaveTextContent("processing");
            fireEvent.click(screen.getByRole("button", { name: "generate first frame" }));
            for (let index = 0; index < 6; index++) {
                fireEvent.change(screen.getByRole("textbox", { name: "shot prompt" }), { target: { value: `New edit ${index}` } });
                await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
            }
            await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
            expect(getProject).toHaveBeenCalledOnce();
            expect(renderFrame).not.toHaveBeenCalled();
            await act(async () => finishRead({ ...project, frames: [{ ...frame, image_generation_status: "completed", rendered_image_url: "recovered.png", t2i_image_urls: ["old.png", "recovered.png"], t2i_selected_index: 1 }] }));
            expect(screen.getByLabelText("first frame")).toHaveTextContent("recovered.png");
            expect(screen.getByLabelText("first frame state")).toHaveTextContent("completed");
            expect(screen.getByRole("textbox", { name: "shot prompt" })).toHaveValue("New edit 5");
            await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
            expect(getProject).toHaveBeenCalledOnce();
        } finally { view.unmount(); vi.useRealTimers(); }
    });

    it("checks server state after an image request times out and retains the image until completion", async () => {
        vi.useFakeTimers();
        const frame = { id: "frame-render-timeout", action_description: "Original", workbench_tab_mode: "t2i_i2v", t2i_image_urls: ["old.png"], t2i_selected_index: 0 };
        const project = { ...useProjectStore.getState().currentProject!, frames: [frame] };
        useProjectStore.setState({ currentProject: project });
        renderFrame.mockRejectedValueOnce(Object.assign(new Error("timeout"), { code: "ECONNABORTED" }));
        getProject.mockResolvedValueOnce({ ...project, frames: [{ ...frame, image_generation_status: "processing", image_generation_id: "render-timeout" }] });
        const view = render(<StoryboardR2V />);
        try {
            await act(async () => { fireEvent.click(screen.getByRole("button", { name: "generate first frame" })); });
            await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
            expect(screen.getByLabelText("first frame state")).toHaveTextContent("processing");
            expect(screen.getByLabelText("first frame")).toHaveTextContent("old.png");
            fireEvent.click(screen.getByRole("button", { name: "generate first frame" }));
            getProject.mockResolvedValueOnce({ ...project, frames: [{ ...frame, image_generation_status: "completed", image_generation_id: "render-timeout", rendered_image_url: "finished.png", t2i_image_urls: ["finished.png"] }] });
            await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
            expect(screen.getByLabelText("first frame")).toHaveTextContent("finished.png");
            expect(screen.getByLabelText("first frame state")).toHaveTextContent("completed");
            expect(screen.getByLabelText("first frame error")).toBeEmptyDOMElement();
            expect(renderFrame).toHaveBeenCalledOnce();
        } finally { view.unmount(); vi.useRealTimers(); }
    });

    it("stops waiting if a rendering frame was deleted elsewhere while preserving the local content", async () => {
        vi.useFakeTimers();
        const frame = { id: "frame-render-deleted", action_description: "Keep my writing", workbench_tab_mode: "t2i_i2v", t2i_image_urls: ["old.png"], image_generation_status: "processing", image_generation_id: "deleted-render" };
        const project = { ...useProjectStore.getState().currentProject!, frames: [frame] };
        useProjectStore.setState({ currentProject: project });
        getProject.mockResolvedValueOnce({ ...project, frames: [] });
        const view = render(<StoryboardR2V />);
        try {
            await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
            expect(screen.getByLabelText("first frame state")).toHaveTextContent("failed");
            expect(screen.getByLabelText("first frame error")).toHaveTextContent("t2iFrameMissing");
            expect(screen.getByLabelText("first frame")).toHaveTextContent("old.png");
            expect(screen.getByRole("textbox", { name: "shot prompt" })).toHaveValue("Keep my writing");
            await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
            expect(getProject).toHaveBeenCalledOnce();
        } finally { view.unmount(); vi.useRealTimers(); }
    });

    it("adopts the freshly rendered image from a full project response without overwriting new edits", async () => {
        useProjectStore.setState(state => ({ currentProject: { ...state.currentProject!, frames: [{ id: "frame-1", action_description: "First prompt", workbench_tab_mode: "t2i_i2v", t2i_image_urls: ["old.png"], t2i_selected_index: 0 }] } }));
        let finish!: (value: unknown) => void;
        renderFrame.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
        render(<StoryboardR2V />);
        fireEvent.click(screen.getByRole("button", { name: "generate first frame" }));
        await waitFor(() => expect(renderFrame).toHaveBeenCalled());
        fireEvent.change(screen.getByRole("textbox", { name: "shot prompt" }), { target: { value: "New writing while rendering" } });
        await act(async () => finish({ id: "project-1", frames: [{ id: "frame-1", action_description: "First prompt", rendered_image_url: "storyboard/new.png", t2i_image_urls: ["old.png", "storyboard/new.png"], t2i_selected_index: 1, status: "completed" }] }));
        expect(screen.getByLabelText("first frame")).toHaveTextContent("storyboard/new.png");
        expect(screen.getByLabelText("first frame state")).toHaveTextContent("completed");
        expect(screen.getByRole("textbox", { name: "shot prompt" })).toHaveValue("New writing while rendering");
        expect(useProjectStore.getState().currentProject!.frames[0].t2i_image_urls).toEqual(["old.png", "storyboard/new.png"]);
        expect(getTaskStatus).not.toHaveBeenCalled();
    });

    it("keeps first-frame generation pending across navigation without duplicate dispatch or lost output", async () => {
        useProjectStore.setState(state => ({ currentProject: { ...state.currentProject!, frames: [{ id: "frame-render-nav", action_description: "Keep writing", workbench_tab_mode: "t2i_i2v" }] } }));
        let finish!: (value: unknown) => void;
        renderFrame.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
        const view = render(<StoryboardR2V />);
        fireEvent.click(screen.getByRole("button", { name: "generate first frame" }));
        await waitFor(() => expect(renderFrame).toHaveBeenCalledOnce());
        view.unmount();
        render(<StoryboardR2V />);
        expect(screen.getByLabelText("first frame state")).toHaveTextContent("processing");
        fireEvent.click(screen.getByRole("button", { name: "generate first frame" }));
        await act(async () => finish({ id: "project-1", frames: [{ id: "frame-render-nav", rendered_image_url: "returned.png", t2i_image_urls: ["returned.png"], t2i_selected_index: 0, status: "completed" }] }));
        expect(renderFrame).toHaveBeenCalledOnce();
        expect(screen.getByLabelText("first frame")).toHaveTextContent("returned.png");
        expect(screen.getByLabelText("first frame state")).toHaveTextContent("completed");
        expect(screen.getByRole("textbox", { name: "shot prompt" })).toHaveValue("Keep writing");
    });

    it("keeps the previous first frame after an invalid result and isolates a retry from a new workspace", async () => {
        const auth = useAuthStore.getState();
        useProjectStore.setState(state => ({ currentProject: { ...state.currentProject!, frames: [{ id: "frame-render-scope", action_description: "Old workspace", t2i_image_urls: ["old.png"], t2i_selected_index: 0 }] } }));
        renderFrame.mockResolvedValueOnce({ id: "project-1", frames: [] });
        render(<StoryboardR2V />);
        fireEvent.click(screen.getByRole("button", { name: "generate first frame" }));
        await waitFor(() => expect(screen.getByLabelText("first frame error")).toHaveTextContent("t2iFailed"));
        expect(screen.getByLabelText("first frame")).toHaveTextContent("old.png");
        let finish!: (value: unknown) => void;
        renderFrame.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
        fireEvent.click(screen.getByRole("button", { name: "generate first frame" }));
        await waitFor(() => expect(renderFrame).toHaveBeenCalledTimes(2));
        await act(async () => {
            useAuthStore.setState({ activeWorkspace: { id: "another-render-workspace" } as never });
            useProjectStore.setState(state => ({ currentProject: { ...state.currentProject!, frames: [{ id: "frame-render-scope", action_description: "New workspace", t2i_image_urls: ["other.png"], t2i_selected_index: 0 }] } }));
            finish({ id: "project-1", frames: [{ id: "frame-render-scope", rendered_image_url: "late.png", t2i_image_urls: ["late.png"], t2i_selected_index: 0, status: "completed" }] });
        });
        expect(screen.getByLabelText("first frame")).toHaveTextContent("other.png");
        expect(screen.getByRole("textbox", { name: "shot prompt" })).toHaveValue("New workspace");
        act(() => useAuthStore.setState({ activeWorkspace: auth.activeWorkspace }));
    });

    it("keeps an uploaded first frame when reopening the workbench", async () => {
        useProjectStore.setState(state => ({ currentProject: { ...state.currentProject!, frames: [{ id: "frame-upload", action_description: "Upload here", workbench_tab_mode: "t2i_i2v" }] } }));
        uploadT2IFrame.mockResolvedValueOnce({ id: "frame-upload", t2i_image_urls: ["uploaded.png"], t2i_selected_index: 0 });
        const view = render(<StoryboardR2V />);
        fireEvent.click(screen.getByRole("button", { name: "upload first frame" }));
        await waitFor(() => expect(screen.getByLabelText("first frame")).toHaveTextContent("uploaded.png"));
        view.unmount();
        render(<StoryboardR2V />);
        expect(screen.getByLabelText("first frame")).toHaveTextContent("uploaded.png");
    });

    it("finishes saving a previous first-frame edit before generating its replacement", async () => {
        useProjectStore.setState(state => ({ currentProject: { ...state.currentProject!, frames: [{ id: "frame-render-save", action_description: "Replace image", workbench_tab_mode: "t2i_i2v", t2i_image_urls: ["old.png"], t2i_selected_index: 0 }] } }));
        let finishSave!: (value: unknown) => void;
        updateFrameWorkbench.mockReturnValueOnce(new Promise(resolve => { finishSave = resolve; }));
        renderFrame.mockResolvedValueOnce({ id: "project-1", frames: [{ id: "frame-render-save", rendered_image_url: "replacement.png", t2i_image_urls: ["replacement.png"], t2i_selected_index: 0, status: "completed" }] });
        render(<StoryboardR2V />);
        fireEvent.click(screen.getByRole("button", { name: "remove first frame" }));
        fireEvent.click(screen.getByRole("button", { name: "generate first frame" }));
        await waitFor(() => expect(updateFrameWorkbench).toHaveBeenCalled());
        const dispatchedBeforeSave = renderFrame.mock.calls.length;
        await act(async () => finishSave({}));
        expect(dispatchedBeforeSave).toBe(0);
        await waitFor(() => expect(screen.getByLabelText("first frame")).toHaveTextContent("replacement.png"));
        expect(useProjectStore.getState().currentProject!.frames[0].t2i_image_urls).toEqual(["replacement.png"]);
    });

    beforeEach(() => {
        vi.clearAllMocks();
        copyFrame.mockReset();
        deleteFrame.mockReset();
        reorderFrames.mockReset();
        createFrame.mockReset();
        getProject.mockReset();
        generateDialogueAudioBatch.mockReset();
        analyzeToStoryboard.mockReset();
        refineBatchFrames.mockReset();
        useDialogueAudioRequests.setState({}, true);
        useStoryboardRequests.setState({}, true);
        renderFrame.mockReset();
        useShotDraftStore.setState({ drafts: {}, errors: {}, saving: {}, storageUnavailable: false, materializedIds: {}, refining: {}, batchRefining: {}, refinedVersions: {} });
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
