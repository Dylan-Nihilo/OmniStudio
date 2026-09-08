import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import TaskQueueButton from "./TaskQueueButton";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));

describe("TaskQueueButton", () => {
    it("announces the expanded queue and connects the toggle to its panel", () => {
        const onToggle = vi.fn();
        const view = render(<TaskQueueButton inFlightCount={2} open={false} onToggle={onToggle} />);
        const button = screen.getByRole("button", { name: "queueSummary" });
        expect(button).toHaveAttribute("aria-expanded", "false");
        fireEvent.click(button);
        expect(onToggle).toHaveBeenCalledOnce();
        view.rerender(<TaskQueueButton inFlightCount={2} open onToggle={onToggle} />);
        expect(button).toHaveAttribute("aria-expanded", "true");
        expect(button).toHaveAttribute("aria-controls", "studio-task-queue");
    });
});
