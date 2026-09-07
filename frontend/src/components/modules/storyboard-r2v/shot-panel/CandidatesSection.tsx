"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, RotateCcw, Film } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button, EmptyState, IconButton, LoadingState, SelectField, StatusBadge } from "@omnistudio/ui";
import type { VideoTask } from "@/lib/api";
import SectionShell from "./SectionShell";
import { usePanelSectionState } from "./usePanelSectionState";
import CandidateThumb from "./CandidateThumb";
import styles from "./CandidatesSection.module.css";

interface CandidatesSectionProps {
    shotId: string;
    tasks: VideoTask[];
    activeModel?: string;
    compareSelectedIds: Set<string>;
    dubbedVideoUrl?: string;
    dubbedVideoTaskId?: string;
    onClickThumb: (task: VideoTask, modifiers: { shift: boolean; meta: boolean }) => void;
    onToggleStar: (task: VideoTask, next: boolean) => Promise<void> | void;
    onSetLabel: (task: VideoTask, next: string | null) => Promise<void> | void;
    onSetActive?: (task: VideoTask) => Promise<void> | void;
    activeTaskId?: string | null;
    isPinned?: boolean;
    isSelecting?: boolean;
    onCancel?: (task: VideoTask) => Promise<void> | void;
    onRetry?: (task: VideoTask) => Promise<void> | void;
    onReuseBatchParams?: (batch: BatchSummary) => void;
    onOpenCompare?: () => void;
    onClearCompare?: () => void;
    resolveUrl?: (url: string) => string;
}

export interface BatchSummary {
    /** Synthetic id derived from earliest task's id. */
    id: string;
    tasks: VideoTask[];
    createdAt: number;
    model: string;
    summary: string;
}

type FilterMode = "all" | "starred" | "this-model";
type SortMode = "time" | "model";

// ponytail: tasks have no batch ID; keep the existing 15s grouping until the API provides one.
const BATCH_GAP_MS = 15_000;

function groupIntoBatches(tasks: VideoTask[]): BatchSummary[] {
    if (tasks.length === 0) return [];
    // Sort by created_at asc first so clustering can walk forward.
    const sorted = [...tasks].sort((a, b) => a.created_at - b.created_at);
    const batches: VideoTask[][] = [];
    let current: VideoTask[] = [sorted[0]];
    for (let i = 1; i < sorted.length; i++) {
        const prev = current[current.length - 1];
        const next = sorted[i];
        const sameCluster =
            (next.created_at - prev.created_at) * 1000 < BATCH_GAP_MS &&
            next.model === prev.model &&
            next.prompt === prev.prompt &&
            (next.negative_prompt ?? "") === (prev.negative_prompt ?? "");
        if (sameCluster) {
            current.push(next);
        } else {
            batches.push(current);
            current = [next];
        }
    }
    batches.push(current);
    return batches.map((bt) => {
        const first = bt[0];
        const parts: string[] = [];
        if (first.negative_prompt) parts.push(`neg="${first.negative_prompt.slice(0, 24)}"`);
        if (first.resolution) parts.push(first.resolution);
        if (first.ratio) parts.push(first.ratio);
        const summary = parts.join(" · ");
        return {
            id: `batch-${first.id}`,
            tasks: bt,
            createdAt: first.created_at,
            model: first.model || "",
            summary,
        };
    });
}

export default function CandidatesSection(props: CandidatesSectionProps) {
    const { shotId, tasks, activeModel, compareSelectedIds, isSelecting, onOpenCompare, onClearCompare } = props;
    const t = useTranslations("storyboardR2V");
    const [open, setOpen] = usePanelSectionState(shotId, "candidates", true);
    const [filter, setFilter] = useState<FilterMode>("all");
    const [sort, setSort] = useState<SortMode>("time");
    const allBatches = useMemo(() => groupIntoBatches(tasks).reverse(), [tasks]);
    const batches = useMemo(() => {
        // Keep batch identity stable when a filter removes its earliest task.
        const out = allBatches.map(batch => ({ ...batch, tasks: batch.tasks.filter(task =>
            filter === "starred" ? task.is_starred : filter !== "this-model" || !activeModel || task.model === activeModel,
        ) })).filter(batch => batch.tasks.length);
        return sort === "model" ? out.sort((a, b) => a.model.localeCompare(b.model) || b.createdAt - a.createdAt) : out;
    }, [allBatches, filter, sort, activeModel]);
    const compareCount = compareSelectedIds.size;
    return <SectionShell title={t("candidates")} subtitle={tasks.length ? t("candidatesCount", { count: tasks.length }) : undefined} open={open} onToggle={() => setOpen(!open)}>
        {tasks.length > 0 && <div className={styles.toolbar}>
            <SelectField label={t("candidateFilter")} value={filter} onChange={value => setFilter(value as FilterMode)} options={[
                { id: "all", label: t("filterAll") },
                { id: "starred", label: t("candidateStarredOnly") },
                ...(activeModel ? [{ id: "this-model", label: t("filterThisModel") }] : []),
            ]} />
            <SelectField label={t("candidateSort")} value={sort} onChange={value => setSort(value as SortMode)} options={[
                { id: "time", label: t("sortByTime") }, { id: "model", label: t("sortByModel") },
            ]} />
        </div>}
        <div className={styles.selectionFeedback}>{isSelecting && <LoadingState inline label={t("candidateAdopting")} />}</div>
        {compareCount > 0 && <div className={styles.compare}>
            <p>{t("compareSelected", { count: compareCount })}<span>{t("candidateCompareLimit")}</span></p>
            <div>
                {onClearCompare && <Button variant="quiet" onPress={onClearCompare}>{t("candidateClearCompare")}</Button>}
                <Button variant="secondary" isDisabled={compareCount < 2 || !onOpenCompare} onPress={onOpenCompare}>{t("compareGo", { count: compareCount })}</Button>
            </div>
        </div>}
        {tasks.length === 0 ? <EmptyState title={t("noCandidatesTitle")} description={t("candidateEmptyHint")} media={<Film size={24} />} />
            : batches.length === 0 ? <EmptyState title={t("noMatches")} action={<Button variant="quiet" onPress={() => setFilter("all")}>{t("candidateResetFilter")}</Button>} />
            : <div className={styles.batches}>{batches.map(batch => <BatchBlock key={batch.id} {...props} batch={batch} defaultOpen={batch.id === allBatches[0]?.id} />)}</div>}
    </SectionShell>;
}

function BatchBlock({ batch, defaultOpen, compareSelectedIds, activeTaskId, isPinned, isSelecting, dubbedVideoUrl, dubbedVideoTaskId, resolveUrl, onClickThumb, onToggleStar, onSetLabel, onSetActive, onCancel, onRetry, onReuseBatchParams }: CandidatesSectionProps & { batch: BatchSummary; defaultOpen: boolean }) {
    const t = useTranslations("storyboardR2V");
    const [open, setOpen] = useState(defaultOpen);
    const runningCount = batch.tasks.filter(task => task.status === "pending" || task.status === "processing").length;
    const failedCount = batch.tasks.filter(task => task.status === "failed").length;
    const ageSeconds = Math.max(0, Math.floor(Date.now() / 1000 - batch.createdAt));
    const age = ageSeconds < 60 ? t("batchAgeSeconds", { s: ageSeconds }) : ageSeconds < 3600 ? t("batchAgeMinutes", { m: Math.floor(ageSeconds / 60) }) : ageSeconds < 86400 ? t("batchAgeHours", { h: Math.floor(ageSeconds / 3600) }) : t("batchAgeDays", { d: Math.floor(ageSeconds / 86400) });
    return <section className={styles.batch}>
        <div className={styles.batchHeader}>
            <Button variant="quiet" className={styles.batchToggle} aria-expanded={open} onPress={() => setOpen(!open)}>
                {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                <span><strong>{batch.model || t("candidateUnknownModel")}</strong><span>{t("candidatesCount", { count: batch.tasks.length })} · {age}</span></span>
            </Button>
            {onReuseBatchParams && <IconButton aria-label={t("batchReuse")} onPress={() => onReuseBatchParams(batch)}><RotateCcw size={16} /></IconButton>}
        </div>
        <div className={styles.batchSummary}>
            {batch.summary && <span>{batch.summary}</span>}
            {runningCount > 0 && <StatusBadge tone="info">{t("candidateRunningCount", { count: runningCount })}</StatusBadge>}
            {failedCount > 0 && <StatusBadge tone="danger">{t("candidateFailedCount", { count: failedCount })}</StatusBadge>}
        </div>
        {open && <div className={styles.grid}>
            {batch.tasks.map(task => <CandidateThumb key={task.id} task={task}
                isCompareSelected={compareSelectedIds.has(task.id)} compareLimitReached={compareSelectedIds.size >= 4}
                isActive={task.id === activeTaskId} isPinned={isPinned} isSelecting={isSelecting}
                dubbedVideoUrl={task.id === dubbedVideoTaskId ? dubbedVideoUrl : undefined} resolveUrl={resolveUrl}
                onClick={onClickThumb} onToggleStar={onToggleStar} onSetLabel={onSetLabel} onSetActive={onSetActive} onCancel={onCancel} onRetry={onRetry} />)}
        </div>}
    </section>;
}
