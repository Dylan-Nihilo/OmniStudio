import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import TaskQueueButton from "./TaskQueueButton";

describe("TaskQueueButton", () => {
    it("uses a light theme-aware surface in its closed state", () => {
        render(
            <TaskQueueButton
                inFlightCount={0}
                open={false}
                onToggle={vi.fn()}
            />,
        );

        const button = screen.getByRole("button", { name: "Task queue, 0 in flight" });

        expect(button).toHaveClass("bg-glass", "border-glass-border", "text-text-secondary");
        expect(button).not.toHaveClass("bg-black/20");
    });
});
