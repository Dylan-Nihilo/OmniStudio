import type { UnifiedJob, UnifiedJobItem, UnifiedJobStatus } from "@/lib/api";

export type TaskAction = "cancel" | "retry" | "none";

export interface TaskObjectRef {
  view?: "project" | "playground" | "sources";
  projectId?: string | null;
  episodeId?: string | null;
  frameId?: string | null;
  assetId?: string | null;
  videoTaskId?: string | null;
  generationId?: string | null;
  sourceId?: string | null;
  batchId?: string | null;
}

export interface TaskViewModel {
  id: string;
  title: string;
  kind: string;
  /** Which project this ran for; null for work that belongs to no project. */
  projectTitle?: string | null;
  status: UnifiedJobStatus;
  statusLabel: string;
  progress: number;
  failedCount: number;
  total: number;
  startedAt?: number | null;
  finishedAt?: number | null;
  /** Credits taken, plus what is still frozen while the task runs. */
  creditsSpent: number;
  creditsHeld: number;
  errorCode?: string | null;
  action: TaskAction;
  objectRef: TaskObjectRef;
  updatedAt?: number | null;
}

const statusLabels: Record<UnifiedJobStatus, string> = {
  pending: "pending",
  processing: "processing",
  succeeded: "succeeded",
  failed: "failed",
  canceled: "canceled",
  skipped: "skipped",
};

function firstItem(job: UnifiedJob): UnifiedJobItem | undefined {
  return job.items?.[0];
}

function getRef(job: UnifiedJob): TaskObjectRef {
  const item = firstItem(job);
  const payload = item?.payload ?? {};
  if (job.kind.startsWith("playground.") || ["t2i", "i2i", "t2v", "i2v", "r2v", "v2v"].includes(item?.kind ?? "")) {
    return {
      view: "playground",
      generationId: typeof payload.generation_id === "string" ? payload.generation_id : null,
    };
  }
  const value = (key: string) => typeof payload[key] === "string" ? payload[key] as string : null;
  if (item?.kind === "source_analysis" || job.kind === "production.source_analysis") {
    return {
      view: "sources",
      sourceId: value("source_document_id"),
      batchId: value("batch_id"),
    };
  }
  return {
    view: "project",
    projectId: job.project_id ?? firstItem(job)?.project_id ?? null,
    episodeId: job.episode_id ?? firstItem(job)?.episode_id ?? null,
    frameId: value("frame_id") ?? value("frameId"),
    assetId: value("asset_id") ?? value("assetId"),
    videoTaskId: value("video_task_id") ?? value("videoTaskId"),
  };
}

function deriveProgress(job: UnifiedJob): number {
  if (job.status === "failed" && job.total > 0) {
    return Math.round((job.succeeded / job.total) * 100);
  }
  if (job.items?.length) {
    return Math.round(job.items.reduce((sum, item) => sum + Math.max(0, Math.min(1, item.progress ?? 0)), 0) / job.items.length * 100);
  }
  if (job.total > 0) return Math.round((job.succeeded / job.total) * 100);
  return job.status === "succeeded" ? 100 : 0;
}

/** When the work actually began, and when the last of it finished. */
function jobTimes(job: UnifiedJob): { startedAt: number | null; finishedAt: number | null } {
  const items = job.items ?? [];
  const started = items.map((item) => item.started_at).filter((value): value is number => typeof value === "number");
  const finished = items.map((item) => item.finished_at).filter((value): value is number => typeof value === "number");
  return {
    startedAt: started.length ? Math.min(...started) : job.created_at ?? null,
    // Only report an end once every item has one; otherwise a part-finished job would
    // read as complete.
    finishedAt: finished.length === items.length && finished.length > 0 ? Math.max(...finished) : null,
  };
}

export function toTaskViewModel(job: UnifiedJob): TaskViewModel {
  const status = job.status as UnifiedJobStatus;
  const item = firstItem(job);
  const { startedAt, finishedAt } = jobTimes(job);
  return {
    id: job.id,
    // `kind` is an internal string and the id fragment meant nothing to anyone; the row
    // labels itself from the project and a translated task name instead.
    title: job.kind,
    kind: job.kind,
    projectTitle: job.project_title ?? null,
    status,
    statusLabel: statusLabels[status] ?? status,
    progress: deriveProgress(job),
    failedCount: job.failed,
    total: job.total,
    startedAt,
    finishedAt,
    creditsSpent: job.credits_spent ?? 0,
    creditsHeld: job.credits_held ?? 0,
    errorCode: item?.error_code ?? null,
    // error_message is deliberately not carried into the view: it can quote a provider
    // verbatim, and a customer-facing failure should name a cause, not a vendor. The row
    // renders a reason mapped from the code; the full text stays in the server log.
    action: status === "failed" ? "retry" : status === "pending" || status === "processing" ? "cancel" : "none",
    objectRef: getRef(job),
    updatedAt: job.updated_at ?? item?.updated_at ?? null,
  };
}

export function taskObjectHash(ref: TaskObjectRef): string | null {
  if (ref.view === "playground") return "#/playground";
  if (ref.view === "sources") return "#/sources";
  const target = ref.episodeId || ref.projectId;
  return target ? `#/project/${target}` : null;
}
