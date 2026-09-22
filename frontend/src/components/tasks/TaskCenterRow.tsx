"use client";

import { AlertCircle, CheckCircle2, ChevronRight, CircleSlash2, Clock3, Loader2, RotateCcw, StopCircle } from "lucide-react";
import clsx from "clsx";
import { useTranslations } from "next-intl";
import { Button, IconButton, StatusBadge } from "@omnistudio/ui";
import styles from "./TaskCenter.module.css";
import type { TaskViewModel } from "./taskCenterModel";

/**
 * Failure codes we can explain. Anything else falls back to a generic line.
 *
 * Mapping rather than echoing the server's message is deliberate: the message can quote a
 * provider verbatim, and a customer has no use for a vendor's wording — they need to know
 * whether to top up, change the input, or wait. The original text stays in the server log.
 */
const FAILURE_REASONS: Record<string, string> = {
    INSUFFICIENT_CREDITS: "reasonInsufficientCredits",
    PRICING_ITEM_NOT_FOUND: "reasonUnpriced",
    PRICE_BOOK_MISSING: "reasonUnpriced",
    PROVIDER_DISPATCH_FAILED: "reasonDispatchFailed",
    PROVIDER_EMPTY_RESULT: "reasonEmptyResult",
    PROVIDER_FAILED: "reasonGenerationFailed",
    PROVIDER_TIMEOUT: "reasonTimeout",
    JOB_DISPATCH_UNAVAILABLE: "reasonServiceBusy",
    RECOVERY_UNAVAILABLE: "reasonServiceBusy",
    CANCELED: "reasonCanceled",
};

/**
 * Job kinds we have a name for. `production.<stage>` and `playground.<mode>` are internal
 * strings — showing one to a customer is the thing this row is being fixed for, so an
 * unrecognised kind falls back to a generic name rather than leaking the identifier.
 */
const TASK_NAMES: Record<string, string> = {
    "production.asset": "kindAsset",
    "production.storyboard": "kindStoryboard",
    "production.video": "kindVideo",
    "production.motion_ref": "kindVideo",
    "production.audio": "kindAudio",
    "production.tts": "kindAudio",
    "production.sfx": "kindAudio",
    "production.dialogue": "kindDialogue",
    "production.export": "kindExport",
    "production.source_analysis": "kindSourceAnalysis",
    "production.cleanup_report": "kindCleanup",
    "playground.t2i": "kindPlaygroundImage",
    "playground.i2i": "kindPlaygroundImage",
    "playground.t2v": "kindPlaygroundVideo",
    "playground.i2v": "kindPlaygroundVideo",
    "playground.r2v": "kindPlaygroundVideo",
    "playground.v2v": "kindPlaygroundVideo",
};

function formatTime(value?: number | null): string {
    if (!value) return "—";
    // Seconds since the epoch on the wire; JS wants milliseconds.
    return new Date(value * 1000).toLocaleString();
}

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
  const taskName = t(TASK_NAMES[task.kind] ?? "kindGeneric");
  const reasonKey = task.errorCode ? FAILURE_REASONS[task.errorCode] : undefined;
  const running = task.status === "processing" || task.status === "pending";
  // What it cost, or what is set aside for it while it runs.
  const credits = task.creditsSpent || task.creditsHeld;
  return (
    <article className={styles.row}>
      <div className={styles.rowBody}>
        <Icon size={19} className={clsx("mt-0.5 shrink-0", task.status === "processing" && "animate-spin motion-reduce:animate-none", task.status === "failed" ? "text-status-failed-fg" : "text-primary")} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate font-medium text-foreground">
              {task.projectTitle ? `${task.projectTitle} · ${taskName}` : taskName}
            </h3>
            <StatusBadge tone={task.status === "failed" ? "danger" : task.status === "succeeded" ? "success" : task.status === "processing" ? "info" : "neutral"}>{t(task.status)}</StatusBadge>
          </div>
          <dl className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-muted">
            <div className="flex gap-1"><dt>{t("startedAt")}</dt><dd className="text-text-secondary">{formatTime(task.startedAt)}</dd></div>
            <div className="flex gap-1"><dt>{t("finishedAt")}</dt><dd className="text-text-secondary">{formatTime(task.finishedAt)}</dd></div>
            {credits > 0 && <div className="flex gap-1">
              <dt>{task.creditsSpent ? t("creditsSpent") : t("creditsHeld")}</dt>
              <dd className="font-mono text-text-secondary">{credits}</dd>
            </div>}
          </dl>
          {/* A running task with no progress reads as stuck, so the bar stays for those. */}
          {running && <div className="mt-2 flex items-center gap-2 text-xs text-text-muted">
            <div className="h-1.5 min-w-20 flex-1 overflow-hidden rounded-full bg-border-subtle">
              <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${task.progress}%` }} />
            </div>
            <span className="w-10 text-right font-mono">{task.progress}%</span>
          </div>}
          {reasonKey ? <p className="mt-2 text-xs text-status-failed-fg">{t(reasonKey)}</p>
            : task.errorCode ? <p className="mt-2 text-xs text-status-failed-fg">{t("reasonGeneric")}</p> : null}
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
