"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Button, Checkbox, Dialog, IconButton, LoadingState, StatusBadge, TextField } from "@omnistudio/ui";
import { Star, Pencil, Pin, Film, RefreshCw } from "lucide-react";
import PreviewVideo from "@/components/shared/preview/PreviewVideo";
import type { VideoTask } from "@/lib/api";
import styles from "./CandidatesSection.module.css";

export interface CandidateThumbProps {
    task: VideoTask;
    isCompareSelected: boolean;
    isActive?: boolean;
    isPinned?: boolean;
    isSelecting?: boolean;
    compareLimitReached?: boolean;
    dubbedVideoUrl?: string;
    resolveUrl?: (url: string) => string;
    onClick: (task: VideoTask, modifiers: { shift: boolean; meta: boolean }) => void;
    onToggleStar: (task: VideoTask, next: boolean) => Promise<void> | void;
    onSetLabel: (task: VideoTask, next: string | null) => Promise<void> | void;
    onSetActive?: (task: VideoTask) => Promise<void> | void;
    onCancel?: (task: VideoTask) => Promise<void> | void;
    onRetry?: (task: VideoTask) => Promise<void> | void;
}

type Action = "star" | "label" | "select" | "cancel" | "retry";
export default function CandidateThumb({ task, isCompareSelected, isActive = false, isPinned = false, isSelecting = false, compareLimitReached = false, dubbedVideoUrl, resolveUrl, onClick, onToggleStar, onSetLabel, onSetActive, onCancel, onRetry }: CandidateThumbProps) {
    const t = useTranslations("storyboardR2V");
    const [editingLabel, setEditingLabel] = useState(false);
    const [labelDraft, setLabelDraft] = useState("");
    const [pending, setPending] = useState<Action | null>(null);
    const pendingRef = useRef(false);
    const [error, setError] = useState<string | null>(null);
    const inFlight = task.status === "pending" || task.status === "processing";
    const canceled = task.status === "failed" && task.error === "Canceled by user";
    const source = task.status === "completed" ? dubbedVideoUrl || task.video_url : undefined;
    const videoUrl = source && resolveUrl ? resolveUrl(source) : source;
    const status = isActive ? "candidateActive" : canceled ? "queueCanceled" : task.status === "completed" ? "queueDone" : task.status === "failed" ? "queueFailed" : task.status === "pending" ? "queuePending" : "queueProcessing";
    const run = async (action: Action, operation: () => Promise<void> | void) => {
        if (pendingRef.current) return;
        pendingRef.current = true;
        setPending(action);
        setError(null);
        try {
            await operation();
            if (action === "label") setEditingLabel(false);
        } catch { setError(t(action === "cancel" || action === "retry" ? "queueActionFailed" : "candidateSaveFailed")); }
        finally { pendingRef.current = false; setPending(null); }
    };
    const adoptLabel = isActive ? isPinned ? "candidatePinned" : "candidatePin" : "candidateAdopt";

    return <article className={styles.candidate} data-active={isActive || undefined}>
        <div className={styles.candidateHeader}>
            <StatusBadge tone={isActive ? "info" : canceled ? "neutral" : task.status === "failed" ? "danger" : task.status === "completed" ? "success" : "info"}>{t(status)}</StatusBadge>
            <IconButton aria-label={t(task.is_starred ? "candidateUnstar" : "candidateStar")} aria-pressed={!!task.is_starred} isPending={pending === "star"} isDisabled={!!pending} onPress={() => { void run("star", () => onToggleStar(task, !task.is_starred)); }}>
                {pending !== "star" && <Star size={16} fill={task.is_starred ? "currentColor" : "none"} />}
            </IconButton>
        </div>
        <div className={styles.media} onClickCapture={event => {
            if (event.shiftKey && videoUrl) { event.preventDefault(); event.stopPropagation(); onClick(task, { shift: true, meta: event.metaKey || event.ctrlKey }); }
        }}>
            {videoUrl ? <PreviewVideo src={videoUrl} alt={task.label || t("generatedVideo")} className="h-full w-full" alwaysShowMagnify clickToLightbox />
                : <div className={styles.placeholder}>{inFlight ? <LoadingState label={t(status)} inline /> : <><Film size={24} /><span>{t(canceled ? "queueCanceled" : task.status === "failed" ? "queueFailed" : "candidateMissingVideo")}</span></>}</div>}
        </div>
        <div className={styles.candidateMeta}><span>{task.resolution}</span><span>{task.duration}s</span></div>
        {task.error && !canceled && <p className={styles.error}>{task.error}</p>}
        {error && !editingLabel && <p role="alert" className={styles.error}>{error}</p>}
        <div className={styles.candidateActions}>
            {videoUrl && onSetActive && <Button variant="secondary" aria-label={t(adoptLabel)} isPending={pending === "select"} isDisabled={!!pending || isSelecting || (isActive && isPinned)} onPress={() => { void run("select", () => onSetActive(task)); }}>
                {pending !== "select" && <Pin size={14} />}{t(adoptLabel)}
            </Button>}
            {videoUrl && <Checkbox isSelected={isCompareSelected} isDisabled={!isCompareSelected && compareLimitReached} onChange={() => onClick(task, { shift: true, meta: false })}>{t("candidateCompare")}</Checkbox>}
            {inFlight && onCancel && <Button variant="secondary" isPending={pending === "cancel"} isDisabled={!!pending} onPress={() => { void run("cancel", () => onCancel(task)); }}>{t(pending === "cancel" ? "queueCanceling" : "queueCancel")}</Button>}
            {task.status === "failed" && onRetry && <Button variant="secondary" isPending={pending === "retry"} isDisabled={!!pending} onPress={() => { void run("retry", () => onRetry(task)); }}>{pending !== "retry" && <RefreshCw size={14} />}{t(pending === "retry" ? "queueRetrying" : "retry")}</Button>}
        </div>
        {inFlight && onCancel && <p className={styles.hint}>{t("queueCancelHint")}</p>}
        <Button variant="quiet" className={styles.note} aria-label={t("candidateEditNote")} isDisabled={!!pending} onPress={() => { setLabelDraft(task.label || ""); setError(null); setEditingLabel(true); }}><Pencil size={14} /><span>{task.label || t("candidateAddNote")}</span></Button>
        <Dialog isOpen={editingLabel} onOpenChange={setEditingLabel} title={t("candidateEditNote")} closeLabel={t("close")} isDismissable={!pending} footer={<>
            <Button variant="quiet" isDisabled={!!pending} onPress={() => setEditingLabel(false)}>{t("cancel")}</Button>
            <Button isPending={pending === "label"} isDisabled={!!pending} onPress={() => { void run("label", () => onSetLabel(task, labelDraft.trim() || null)); }}>{t("save")}</Button>
        </>}>
            <TextField label={t("candidateNote")} value={labelDraft} onChange={setLabelDraft} maxLength={20} description={t("candidateNoteHint")} isDisabled={!!pending} autoFocus />
            {error && <p role="alert" className={styles.error}>{error}</p>}
        </Dialog>
    </article>;
}
