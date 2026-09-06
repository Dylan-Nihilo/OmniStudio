"use client";

import { AlertCircle, CheckCircle2, ChevronRight, CircleSlash2, Clock3, Loader2, RotateCcw, StopCircle } from "lucide-react";
import clsx from "clsx";
import { useTranslations } from "next-intl";
import type { TaskViewModel } from "./taskCenterModel";

const statusIcon = {
  pending: Clock3,
  processing: Loader2,
  succeeded: CheckCircle2,
  failed: AlertCircle,
  canceled: CircleSlash2,
  skipped: CircleSlash2,
} as const;

export default function TaskCenterRow({
  task,
  onCancel,
  onRetry,
  onDetails,
  onOpenObject,
}: {
  task: TaskViewModel;
  onCancel: () => void;
  onRetry: () => void;
  onDetails: () => void;
  onOpenObject: () => void;
}) {
  const t = useTranslations("taskCenter");
  const Icon = statusIcon[task.status] ?? Clock3;
  const hasObject = Object.values(task.objectRef).some(Boolean);
  return (
    <article className="rounded-xl border border-glass-border bg-surface/60 p-4 shadow-lg shadow-black/10">
      <div className="flex items-start gap-3">
        <Icon size={19} className={clsx("mt-0.5 shrink-0", task.status === "processing" && "animate-spin", task.status === "failed" ? "text-status-failed-fg" : "text-primary")} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate font-medium text-foreground">{task.title}</h3>
            <span className="rounded-full border border-glass-border px-2 py-0.5 text-[0.6875rem] text-text-secondary">{t(task.status)}</span>
          </div>
          <div className="mt-2 flex items-center gap-2 text-xs text-text-muted">
            <div className="h-1.5 min-w-20 flex-1 overflow-hidden rounded-full bg-border-subtle">
              <div className={clsx("h-full rounded-full transition-all", task.status === "failed" ? "bg-status-failed-fg" : "bg-primary")} style={{ width: `${task.progress}%` }} />
            </div>
            <span className="w-10 text-right font-mono">{task.progress}%</span>
            <span>{task.failedCount}/{task.total}</span>
          </div>
          {task.errorCode && <p className="mt-2 text-xs text-status-failed-fg"><span className="font-mono">{task.errorCode}</span>{task.errorMessage && <span> · {task.errorMessage}</span>}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {hasObject && <button type="button" aria-label="openTaskObject" onClick={onOpenObject} className="rounded-md p-2 text-text-muted hover:bg-hover-bg hover:text-foreground"><ChevronRight size={16} /></button>}
          <button type="button" aria-label="taskDetails" onClick={onDetails} className="rounded-md px-2 py-1.5 text-xs text-text-secondary hover:bg-hover-bg hover:text-foreground">{t("details")}</button>
          {task.action === "cancel" && <button type="button" aria-label={t("cancel")} onClick={onCancel} className="rounded-md p-2 text-text-muted hover:bg-status-failed-bg hover:text-status-failed-fg"><StopCircle size={16} /></button>}
          {task.action === "retry" && <button type="button" aria-label={t("retry")} onClick={onRetry} className="rounded-md p-2 text-text-muted hover:bg-hover-bg hover:text-primary"><RotateCcw size={16} /></button>}
        </div>
      </div>
    </article>
  );
}
