import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { VideoTask } from "@/lib/api";
import { LightboxProvider } from "@/components/shared/preview/LightboxProvider";
import CandidatesSection from "./CandidatesSection";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));

const task: VideoTask = {
    id: "take-1", project_id: "project-1", frame_id: "frame-1", image_url: "",
    video_url: "take-a.mp4", prompt: "A rooftop", status: "completed", duration: 5,
    resolution: "720p", generate_audio: false, prompt_extend: true, created_at: 1,
};

it("exposes a batch download action with the batch take ids", () => {
    const onDownloadBatch = vi.fn();
    render(<LightboxProvider><CandidatesSection
        shotId="frame-1" tasks={[task]} compareSelectedIds={new Set()}
        onClickThumb={vi.fn()} onToggleStar={vi.fn()} onSetLabel={vi.fn()}
        onDownloadBatch={onDownloadBatch}
    /></LightboxProvider>);

    fireEvent.click(screen.getByRole("button", { name: "batchDownload" }));

    expect(onDownloadBatch).toHaveBeenCalledWith([task]);
});
