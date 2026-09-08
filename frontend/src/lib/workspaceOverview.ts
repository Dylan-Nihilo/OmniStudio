import type { Project } from "@/store/projectStore";

export function projectUpdatedAt(project: Project): number {
  const raw = project as Project & { updated_at?: number; created_at?: number };
  const value = raw.updatedAt || raw.updated_at || raw.createdAt || raw.created_at;
  const time = typeof value === "number" ? value * 1000 : Date.parse(value || "");
  return Number.isFinite(time) ? time : 0;
}

export function recentProjects(projects: Project[]): Project[] {
  return Array.from(new Map(projects.map((project) => [project.id, project])).values())
    .sort((a, b) => projectUpdatedAt(b) - projectUpdatedAt(a));
}

export function projectHref(project: Project): string {
  return project.series_id
    ? `#/series/${project.series_id}/episode/${project.id}`
    : `#/project/${project.id}`;
}

export function productionProgress(project: Project) {
  const frames = project.frames || [];
  const tasks = Array.from(new Map((project.video_tasks || []).map((task) => [task.id, task])).values());
  const readyFrames = new Set(tasks.filter((task) => task.status === "completed" && task.video_url && task.frame_id).map((task) => task.frame_id));
  return {
    script: Boolean((project.originalText || (project as Project & { original_text?: string }).original_text || "").trim()),
    total: frames.length,
    images: frames.filter((frame) => frame.rendered_image_url || frame.image_url || frame.rendered_image_asset?.variants?.some((v: { url?: string }) => v.url) || frame.image_asset?.variants?.some((v: { url?: string }) => v.url)).length,
    videos: frames.filter((frame) => frame.video_url || frame.dubbed_video_url || readyFrames.has(frame.id)).length,
    audio: frames.filter((frame) => frame.audio_url).length,
    queued: tasks.filter((task) => task.status === "pending" || task.status === "processing").length,
  };
}
