import { act, fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { VideoTask } from "@/lib/api";
import CandidateThumb from "./CandidateThumb";
import { LightboxProvider } from "@/components/shared/preview/LightboxProvider";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
const task: VideoTask = { id: "take-1", project_id: "project-1", frame_id: "frame-1", image_url: "", video_url: "take.mp4", prompt: "A rooftop", status: "completed", duration: 5, resolution: "720p", generate_audio: false, prompt_extend: true, created_at: 1 };

it("keeps a note draft on save failure and only dismisses after a successful retry", async () => {
    let rejectSave!: (error: Error) => void;
    const onSetLabel = vi.fn(() => new Promise<void>((_, reject) => { rejectSave = reject; }));
    render(<LightboxProvider><CandidateThumb task={task} isCompareSelected={false} onClick={vi.fn()} onToggleStar={vi.fn()} onSetLabel={onSetLabel} /></LightboxProvider>);
    fireEvent.click(screen.getByRole("button", { name: "candidateEditNote" }));
    const field = screen.getByRole("textbox", { name: "candidateNote" });
    fireEvent.change(field, { target: { value: "Use this camera move" } });
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    expect(screen.getByRole("button", { name: "save" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("button", { name: "close" })).toBeDisabled();
    await act(async () => { rejectSave(new Error("save failed")); });
    expect(field).toHaveValue("Use this camera move");
    expect(screen.getByRole("alert")).toHaveTextContent("candidateSaveFailed");
    onSetLabel.mockResolvedValueOnce();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "save" })); });
    expect(onSetLabel).toHaveBeenLastCalledWith(task, "Use this camera move");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("shows an adoption failure without invoking preview or compare, and allows retry", async () => {
    const onSetActive = vi.fn().mockRejectedValueOnce(new Error("selection failed")).mockResolvedValueOnce(undefined);
    const onClick = vi.fn();
    render(<LightboxProvider><CandidateThumb task={task} isCompareSelected={false} onClick={onClick} onToggleStar={vi.fn()} onSetLabel={vi.fn()} onSetActive={onSetActive} /></LightboxProvider>);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "candidateAdopt" })); });
    expect(screen.getByRole("alert")).toHaveTextContent("candidateSaveFailed");
    expect(onClick).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "candidateAdopt" })); });
    expect(onSetActive).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
