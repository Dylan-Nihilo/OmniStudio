import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { VideoTask } from "@/lib/api";
import TaskQueuePanel from "./TaskQueuePanel";

vi.mock("next-intl", () => ({
    useTranslations: () => (key: string) => key,
    useLocale: () => "en",
}));

const task: VideoTask = {
    id: "task-1", project_id: "project-1", frame_id: "frame-1", image_url: "",
    prompt: "深夜站台", status: "processing", duration: 5, resolution: "720p",
    generate_audio: false, prompt_extend: false, created_at: 1,
};

describe("TaskQueuePanel", () => {
    it("blocks duplicate cancellation, retains the task on failure and permits retry", async () => {
        let rejectCancel!: (error: Error) => void;
        const onCancel = vi.fn(() => new Promise<void>((_, reject) => { rejectCancel = reject; }));
        render(<TaskQueuePanel open onClose={vi.fn()} tasks={[task]} onJumpToShot={vi.fn()} onCancel={onCancel} />);
        const cancel = screen.getByRole("button", { name: "queueCancel" });
        fireEvent.click(cancel);
        fireEvent.click(cancel);
        expect(onCancel).toHaveBeenCalledOnce();
        expect(cancel).toBeDisabled();
        expect(cancel).toHaveTextContent("queueCanceling");
        await act(async () => { rejectCancel(new Error("network unavailable")); });
        expect(screen.getByRole("alert")).toHaveTextContent("queueActionFailed");
        expect(screen.getByText("深夜站台")).toBeVisible();
        expect(cancel).not.toBeDisabled();
        onCancel.mockResolvedValueOnce();
        fireEvent.click(cancel);
        await act(async () => {});
        expect(onCancel).toHaveBeenCalledTimes(2);
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("keeps task diagnostics visible when refresh fails and provides a loading retry", () => {
        const onRefresh = vi.fn();
        const view = render(<TaskQueuePanel open onClose={vi.fn()} tasks={[{ ...task, status: "failed", error: "provider unavailable" }]} onJumpToShot={vi.fn()} refreshError onRefresh={onRefresh} />);
        fireEvent.click(screen.getByRole("tab", { name: /queueFailed/ }));
        expect(screen.getByText("provider unavailable")).toBeVisible();
        expect(screen.getByRole("alert")).toHaveTextContent("queueRefreshFailed");
        fireEvent.click(screen.getByRole("button", { name: "queueRefresh" }));
        expect(onRefresh).toHaveBeenCalledOnce();
        view.rerender(<TaskQueuePanel open onClose={vi.fn()} tasks={[]} onJumpToShot={vi.fn()} refreshing onRefresh={onRefresh} />);
        expect(screen.getByRole("button", { name: "queueRefresh" })).toBeDisabled();
        expect(screen.getByRole("status")).toHaveTextContent("queueRefreshing");
    });
});
