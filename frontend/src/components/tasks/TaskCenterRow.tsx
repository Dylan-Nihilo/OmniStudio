"use client";

import { AlertCircle, CheckCircle2, ChevronRight, CircleSlash2, Clock3, Loader2, RotateCcw, StopCircle } from "lucide-react";
import clsx from "clsx";
import { useTranslations } from "next-intl";
import { Button, IconButton, StatusBadge } from "@omnistudio/ui";
import styles from "./TaskCenter.module.css";
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
  isPending = false,
  isDisabled = false,
  onCancel,
  onRetry,
  onDetails,
  onOpenObject,
}: {
  task: TaskViewModel;
  isPending?: boolean;
  isDisabled?: boolean;
  onCancel: () => void;
  onRetry: () => void;
  onDetails: () => void;
  onOpenObject: () => void;
}) {
  const t = useTranslations("taskCenter");
  const Icon = statusIcon[task.status] ?? Clock3;
  const hasObject = Object.values(task.objectRef).some(Boolean);
  return (
    <article className={styles.row}>
      <div className={styles.rowBody}>
        <Icon size={19} className={clsx("mt-0.5 shrink-0", task.status === "processing" && "animate-spin motion-reduce:animate-none", task.status === "failed" ? "text-status-failed-fg" : "text-primary")} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate font-medium text-foreground">{task.title}</h3>
            <StatusBadge tone={task.status === "failed" ? "danger" : task.status === "succeeded" ? "success" : task.status === "processing" ? "info" : "neutral"}>{t(task.status)}</StatusBadge>
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
        <div className={styles.rowActions}>
          {hasObject && <IconButton aria-label={t("openObject")} onPress={onOpenObject}><ChevronRight size={16} /></IconButton>}
          <Button variant="quiet" onPress={onDetails} isDisabled={isDisabled}>{t("details")}</Button>
          {task.action === "cancel" && <IconButton aria-label={t("cancel")} isDisabled={isDisabled} onPress={onCancel}><StopCircle size={16} /></IconButton>}
          {task.action === "retry" && <IconButton aria-label={t("retry")} isPending={isPending} isDisabled={isDisabled} onPress={onRetry}><RotateCcw size={16} /></IconButton>}
        </div>
      </div>
    </article>
  );
}
