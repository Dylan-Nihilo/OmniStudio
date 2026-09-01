import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { VideoTask } from "@/lib/api";
import TaskQueuePanel from "./TaskQueuePanel";

vi.mock("next-intl", () => ({
    useTranslations: () => (key: string) => key,
}));

describe("TaskQueuePanel", () => {
    it("uses an opaque theme surface so the workspace backdrop cannot tint its content", () => {
        render(
            <TaskQueuePanel
                open
                onClose={vi.fn()}
                tasks={[]}
                onJumpToShot={vi.fn()}
            />,
        );

        const panel = screen.getByRole("region", { name: "Task queue" });

        expect(panel).toHaveClass("bg-surface");
        expect(panel).not.toHaveClass("bg-surface/55", "backdrop-blur-xl");
    });

    it("uses theme surfaces for expanded diagnostics while retaining failure styling", () => {
        const failedTask: VideoTask = {
            id: "task-1",
            project_id: "project-1",
            image_url: "",
            prompt: "深夜站台",
            status: "failed",
            duration: 5,
            resolution: "720p",
            generate_audio: false,
            prompt_extend: false,
            created_at: Date.now() / 1000,
            provider_name: "vidu",
            provider_task_id: "provider-task-1",
            error: "generation failed",
        };

        render(
            <TaskQueuePanel
                open
                onClose={vi.fn()}
                tasks={[failedTask]}
                onJumpToShot={vi.fn()}
                onRetry={vi.fn()}
            />,
        );

        fireEvent.click(screen.getByRole("tab", { name: /queueFailed/ }));

        const prompt = screen.getByText("深夜站台");
        const providerIds = screen.getByText("Vidu ids").parentElement;
        const copyDiagnostics = screen.getByTitle("queueCopyDiagnose");
        const retry = screen.getByRole("button", { name: "Retry task" });

        expect(prompt).toHaveClass("bg-surface-inset");
        expect(providerIds).toHaveClass("bg-surface-inset");
        expect(copyDiagnostics).toHaveClass("bg-surface-inset");
        expect(prompt).not.toHaveClass("bg-black/30");
        expect(providerIds).not.toHaveClass("bg-black/30");
        expect(copyDiagnostics).not.toHaveClass("bg-black/30");
        expect(retry).toHaveClass("bg-status-failed-bg", "text-status-failed-fg");
    });
});
