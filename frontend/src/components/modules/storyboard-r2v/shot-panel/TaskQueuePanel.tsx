"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Modal } from "@heroui/react";
import { Button, EmptyState, IconButton, LoadingState, StatusBadge, Tabs } from "@omnistudio/ui";
import { X, ArrowRight, Copy, Check, RefreshCw, ChevronDown, ChevronRight } from "lucide-react";
import type { VideoTask } from "@/lib/api";
import { useSettingsStore } from "@/store/settingsStore";
import PreviewImage from "@/components/shared/preview/PreviewImage";
import PreviewVideo from "@/components/shared/preview/PreviewVideo";
import styles from "./TaskQueuePanel.module.css";

type TabKey = "active" | "done" | "failed";
interface TaskQueuePanelProps {
    open: boolean;
    onClose: () => void;
    tasks: VideoTask[];
    refreshing?: boolean;
    refreshError?: boolean;
    onRefresh?: () => Promise<void> | void;
    shotLabelByFrameId?: Record<string, string>;
    onJumpToShot: (frameId: string) => void;
    onCancel?: (task: VideoTask) => Promise<void> | void;
    onRetry?: (task: VideoTask) => Promise<void> | void;
    retryingTaskIds?: ReadonlySet<string>;
}

export default function TaskQueuePanel({ open, onClose, tasks, refreshing, refreshError, onRefresh, shotLabelByFrameId, onJumpToShot, onCancel, onRetry, retryingTaskIds }: TaskQueuePanelProps) {
    const t = useTranslations("storyboardR2V");
    const [tab, setTab] = useState<TabKey>("active");
    const [wide, setWide] = useState(false);
    const panelRef = useRef<HTMLElement>(null);
    const reduceMotion = useReducedMotion();
    const animations = useSettingsStore(state => state.animations);
    useEffect(() => {
        const media = window.matchMedia("(min-width: 1280px)");
        const sync = () => setWide(media.matches);
        sync();
        media.addEventListener("change", sync);
        return () => media.removeEventListener("change", sync);
    }, []);
    useEffect(() => {
        if (!open || !wide) return;
        const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const frame = requestAnimationFrame(() => panelRef.current?.focus());
        return () => {
            cancelAnimationFrame(frame);
            if (trigger?.isConnected) trigger.focus();
        };
    }, [open, wide]);

    const buckets = useMemo(() => {
        const result: Record<TabKey, VideoTask[]> = { active: [], done: [], failed: [] };
        for (const task of tasks) result[task.status === "completed" ? "done" : task.status === "failed" ? "failed" : "active"].push(task);
        Object.values(result).forEach(tasks => tasks.sort((a, b) => b.created_at - a.created_at));
        return result;
    }, [tasks]);

    const body = <>
        <header className={styles.header}>
            <div><h2>{t("queueTitle")}</h2><div className={styles.headerStatus}>{refreshing ? <LoadingState inline label={t("queueRefreshing")} /> : <p>{t("queueTotal", { count: tasks.length })}</p>}</div></div>
            {onRefresh && <IconButton aria-label={t("queueRefresh")} isPending={refreshing} isDisabled={refreshing} onPress={() => { void onRefresh(); }}>{!refreshing && <RefreshCw size={16} />}</IconButton>}
            <IconButton aria-label={t("close")} onPress={onClose}><X size={16} /></IconButton>
        </header>
        <div className={styles.feedback}>
            {refreshError && <p role="alert">{t("queueRefreshFailed")}</p>}
        </div>
        <Tabs aria-label={t("queueTitle")} className={styles.tabs} selectedKey={tab} onSelectionChange={key => setTab(key as TabKey)} items={([
            ["active", "queueActive", "queueEmptyActive"],
            ["done", "queueDone", "queueEmptyDone"],
            ["failed", "queueFailed", "queueEmptyFailed"],
        ] as const).map(([key, label, empty]) => ({
            id: key,
            label: `${t(label)} · ${buckets[key].length}`,
            content: buckets[key].length ? <ul className={styles.list}>{buckets[key].map(task => <li key={task.id}>
                <TaskRow task={task} shotLabel={shotLabelByFrameId?.[task.frame_id ?? ""] ?? task.frame_id ?? t("queueUnassigned")}
                    hasActiveRetry={tasks.some(retry => retry.retry_of_task_id === task.id && (retry.status === "pending" || retry.status === "processing"))}
                    onJumpToShot={onJumpToShot} onCancel={onCancel} onRetry={onRetry} isRetrying={retryingTaskIds?.has(task.id)} />
            </li>)}</ul> : <EmptyState title={t(empty)} className={styles.empty} />,
        }))} />
    </>;

    if (!wide) return <Modal.Backdrop isOpen={open} onOpenChange={value => { if (!value) onClose(); }} isDismissable className={styles.backdrop}>
        <Modal.Container className={styles.mobileContainer}>
            <Modal.Dialog id="studio-task-queue" aria-label={t("queueTitle")} className={styles.mobilePanel}>{body}</Modal.Dialog>
        </Modal.Container>
    </Modal.Backdrop>;

    return <AnimatePresence>{open && <motion.aside id="studio-task-queue" role="region" aria-label={t("queueTitle")} tabIndex={-1} ref={panelRef}
        className={styles.panel} initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 16 }}
        transition={{ duration: reduceMotion || !animations ? 0 : 0.18 }} onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }}>
        {body}
    </motion.aside>}</AnimatePresence>;
}

function TaskRow({ task, shotLabel, onJumpToShot, onCancel, onRetry, isRetrying, hasActiveRetry }: {
    task: VideoTask; shotLabel: string;
    onJumpToShot: TaskQueuePanelProps["onJumpToShot"];
    onCancel?: TaskQueuePanelProps["onCancel"];
    onRetry?: TaskQueuePanelProps["onRetry"];
    isRetrying?: boolean;
    hasActiveRetry?: boolean;
}) {
    const t = useTranslations("storyboardR2V");
    const locale = useLocale();
    const [expanded, setExpanded] = useState(task.status === "failed");
    const [pending, setPending] = useState(false);
    const pendingRef = useRef(false);
    const [error, setError] = useState(false);
    const [copied, setCopied] = useState<string | null>(null);
    const [copyError, setCopyError] = useState(false);
    const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current); }, []);
    const inFlight = task.status === "pending" || task.status === "processing";
    const canceled = task.status === "failed" && task.error === "Canceled by user";
    const status = canceled ? "queueCanceled" : task.status === "completed" ? "queueDone" : task.status === "failed" ? "queueFailed" : task.status === "pending" ? "queuePending" : "queueProcessing";
    const statusTone = canceled ? "neutral" : task.status === "failed" ? "danger" : task.status === "completed" ? "success" : "info";
    const provider = task.provider_name === "dashscope" ? t("providerDashscope") : task.provider_name || "";
    const diagnose = [`Task: ${task.id}`, `Provider: ${provider}`, `Provider task: ${task.provider_task_id || "—"}`, `Request: ${task.provider_request_id || "—"}`, `Model: ${task.model || "—"}`, `Status: ${task.status}`, `Error: ${task.error || "—"}`].join("\n");
    const copy = async (field: string, value: string) => {
        setCopyError(false);
        try {
            await navigator.clipboard.writeText(value);
            setCopied(field);
            if (copyTimer.current) clearTimeout(copyTimer.current);
            copyTimer.current = setTimeout(() => setCopied(null), 1500);
        } catch { setCopyError(true); }
    };
    const run = async (action: NonNullable<TaskQueuePanelProps["onCancel"]>) => {
        if (pendingRef.current) return;
        pendingRef.current = true;
        setPending(true);
        setError(false);
        try { await action(task); } catch { setError(true); }
        finally { pendingRef.current = false; setPending(false); }
    };
    const date = Number.isFinite(task.created_at) ? new Date(task.created_at * 1000) : null;
    return <article className={styles.task}>
        <div className={styles.rowHeader}>
            <IconButton aria-label={expanded ? t("queueCollapse") : t("queueExpandDetails")} aria-expanded={expanded} onPress={() => setExpanded(value => !value)}>
                {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            </IconButton>
            <strong>{shotLabel}</strong>
            <StatusBadge tone={statusTone}>{t(status)}</StatusBadge>
            {task.frame_id && <IconButton aria-label={t("queueJumpToShot")} onPress={() => onJumpToShot(task.frame_id!)}><ArrowRight size={16} /></IconButton>}
        </div>
        <div className={styles.summary}>
            {!expanded && (task.image_url || (task.video_url && task.status === "completed")) && <div className={styles.compactPreview}>
                {task.status === "completed" && task.video_url
                    ? <PreviewVideo src={task.video_url} alt={t("queueOutput")} className="h-full w-full" hoverPlay={false} alwaysShowMagnify clickToLightbox />
                    : <PreviewImage src={task.image_url} alt={t("queueInput")} className="h-full w-full" alwaysShowMagnify clickToLightbox />}
            </div>}
            <p className={expanded ? styles.prompt : styles.promptPreview}>{task.prompt || "—"}</p>
        </div>
        <div className={styles.meta}>
            {task.model && <span>{task.model}</span>}{task.resolution && <span>{task.resolution}</span>}
            {task.duration > 0 && <span>{task.duration}s</span>}
            {date && <time dateTime={date.toISOString()}>{new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date)}</time>}
        </div>
        {expanded && <div className={styles.details}>
            {(task.image_url || task.video_url) && <div className={styles.media}>
                {task.image_url && <figure><PreviewImage src={task.image_url} alt={t("queueInput")} className={styles.preview} alwaysShowMagnify clickToLightbox /><figcaption>{t("queueInput")}</figcaption></figure>}
                {task.video_url && task.status === "completed" && <figure><PreviewVideo src={task.video_url} alt={t("queueOutput")} className={styles.preview} hoverPlay={false} alwaysShowMagnify clickToLightbox /><figcaption>{t("queueOutput")}</figcaption></figure>}
            </div>}
            <div className={styles.meta}>{typeof task.seed === "number" && <span>seed {task.seed}</span>}{task.generation_mode && <span>{task.generation_mode}</span>}{provider && <span>{provider}</span>}</div>
            {task.error && !canceled && <p className={styles.failure}>{task.error}</p>}
            <dl className={styles.ids}>
                {([[t("queueLocalId"), task.id, "local"], [t("queueProviderId"), task.provider_task_id, "provider"], [t("queueRequestId"), task.provider_request_id, "request"]] as const).map(([label, value, field]) => value && <div key={field}>
                    <dt>{label}</dt><dd><code>{value}</code><IconButton aria-label={t("queueCopyId", { label })} onPress={() => { void copy(field, value); }}>{copied === field ? <Check size={14} /> : <Copy size={14} />}</IconButton></dd>
                </div>)}
            </dl>
        </div>}
        {inFlight && onCancel && <p className={styles.hint}>{t("queueCancelHint")}</p>}
        {error && <p role="alert" className={styles.failure}>{t("queueActionFailed")}</p>}
        {copyError && <p role="alert" className={styles.failure}>{t("queueCopyFailed")}</p>}
        {copied && <span role="status" className={styles.hint}>{t("queueCopied")}</span>}
        <div className={styles.actions}>
            {expanded && <Button variant="quiet" onPress={() => { void copy("diagnose", diagnose); }}><Copy size={14} />{t("queueCopyDiagnoseShort")}</Button>}
            {inFlight && onCancel && <Button variant="secondary" aria-label={t("queueCancel")} isPending={pending} isDisabled={pending} onPress={() => { void run(onCancel); }}>{pending ? t("queueCanceling") : t("queueCancel")}</Button>}
            {task.status === "failed" && onRetry && <Button variant="secondary" aria-label={t(hasActiveRetry ? "retryInProgress" : "retry")} isPending={pending || isRetrying} isDisabled={pending || isRetrying || hasActiveRetry} onPress={() => { void run(onRetry); }}>{!pending && !isRetrying && !hasActiveRetry && <RefreshCw size={14} />}{t(pending || isRetrying ? "queueRetrying" : hasActiveRetry ? "retryInProgress" : "retry")}</Button>}
        </div>
    </article>;
}
