import { expect, it } from "vitest";
import type { Project } from "@/store/projectStore";
import { productionProgress, recentProjects, projectHref } from "@/lib/workspaceOverview";

it("orders backend and persisted dates, deduplicates projects and counts ready shots rather than candidate videos", () => {
  const old = { id: "old", created_at: 100, frames: [] } as unknown as Project;
  const current = {
    id: "current", series_id: "series", updatedAt: "2026-09-05T00:00:00Z", original_text: "Script",
    frames: [{ id: "shot", image_asset: { variants: [{ url: "/image.png" }] }, audio_url: "/audio.wav" }, { id: "empty" }],
    video_tasks: [
      { id: "a", frame_id: "shot", status: "completed", video_url: "/a.mp4" },
      { id: "b", frame_id: "shot", status: "completed", video_url: "/b.mp4" },
      { id: "c", frame_id: "empty", status: "failed" },
      { id: "d", frame_id: "empty", status: "processing" },
      { id: "d", frame_id: "empty", status: "processing" },
    ],
  } as unknown as Project;
  expect(recentProjects([old, current, old]).map((p) => p.id)).toEqual(["current", "old"]);
  expect(productionProgress(current)).toEqual({ script: true, total: 2, images: 1, videos: 1, audio: 1, queued: 1 });
  expect(productionProgress(old)).toEqual({ script: false, total: 0, images: 0, videos: 0, audio: 0, queued: 0 });
  expect(projectHref(current)).toBe("#/series/series/episode/current");
  expect(projectHref(old)).toBe("#/project/old");
});
