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
  status: UnifiedJobStatus;
  statusLabel: string;
  progress: number;
  failedCount: number;
  total: number;
  errorCode?: string | null;
  errorMessage?: string | null;
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

export function toTaskViewModel(job: UnifiedJob): TaskViewModel {
  const status = job.status as UnifiedJobStatus;
  const item = firstItem(job);
  return {
    id: job.id,
    title: `${job.kind} · ${job.id.slice(0, 8)}`,
    kind: job.kind,
    status,
    statusLabel: statusLabels[status] ?? status,
    progress: deriveProgress(job),
    failedCount: job.failed,
    total: job.total,
    errorCode: item?.error_code ?? null,
    errorMessage: item?.error_message ?? null,
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
