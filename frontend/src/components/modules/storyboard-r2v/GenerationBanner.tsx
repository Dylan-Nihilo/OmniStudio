"use client";
import { useState, type ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { ChevronDown, ChevronUp, Mic, Sparkles } from "lucide-react";
import { Button, LoadingState } from "@omnistudio/ui";
import { useTranslations } from "next-intl";
import type { DialogueAudioBatch, StoryboardGeneration } from "@/lib/api";
import styles from "./GenerationBanner.module.css";

export type BannerState = "idle" | "phase1" | "phase2" | "dialogue" | "summary";
export interface GenerationBannerProps {
    state: BannerState;
    phase1Captions: string[];
    refineProgress?: { current: number; total: number } | null;
    dialogueProgress?: { current: number; total: number } | null;
    summary?: { frameCount: number; dialogueReady: number; dialogueMissing: number } | null;
    onGenerateDialogue?: () => void;
    batch?: DialogueAudioBatch | null;
    batchError?: string;
    refreshFailed?: boolean;
    refreshing?: boolean;
    onRefresh?: () => void;
    storyboard?: StoryboardGeneration | null;
    storyboardError?: string;
    storyboardRecovering?: boolean;
    refinementCount?: number;
    onRefine?: () => void;
    refinementShots?: Array<{ id: string; number: number }>;
    onOpenShot?: (id: string) => void;
}
export function GenerationBanner({ state, phase1Captions, refineProgress, dialogueProgress, summary, onGenerateDialogue, batch, batchError, refreshFailed, refreshing, onRefresh, storyboard, storyboardError, storyboardRecovering, refinementCount = 0, onRefine, refinementShots = [], onOpenShot }: GenerationBannerProps) {
    const t = useTranslations("storyboardR2V");
    const tAudio = useTranslations("dialogueAudio");
    const [detailsOpen, setDetailsOpen] = useState(false);
    if (state === "phase1" || state === "phase2" || storyboardError || refinementCount > 0 || storyboard?.status === "failed") {
        const pending = state === "phase1" || state === "phase2";
        const retry = storyboard?.phase === "refine";
        const error = storyboardError || (!pending ? storyboard?.error || (storyboard?.status === "failed" ? t("storyboardInterrupted") : undefined) : undefined);
        const canDefer = !pending && retry && refinementCount > 0;
        const label = storyboardRecovering ? t("storyboardChecking") : state === "phase1"
            ? phase1Captions[0] || t("genInFlight")
            : t("bannerRefineProgress", { current: refineProgress?.current ?? 0, total: refineProgress?.total ?? 0 });
        return <BannerShell>
            <div className={styles.copy}>
                {pending ? <LoadingState inline className="justify-start" label={label} />
                    : refinementCount > 0 && <p role="status">{t(retry ? "storyboardRefinementRemaining" : "storyboardReadyToRefine", { count: refinementCount })}</p>}
                {canDefer && detailsOpen && <>
                    <p>{t("storyboardManualEditingHint")}</p>
                    {onOpenShot && <div className={styles.shotLinks}>{refinementShots.map(shot => <Button key={shot.id} variant="quiet" onPress={() => onOpenShot(shot.id)}>{t("storyboardOpenRefinementShot", { number: shot.number })}</Button>)}</div>}
                </>}
                {error && (canDefer ? detailsOpen && <details className={styles.errorDetails}><summary>{t("storyboardErrorDetails")}</summary><p>{error}</p></details>
                    : <p role="alert" className="break-words text-status-failed-fg">{error}</p>)}
                {refreshFailed && <p role="alert">{t("storyboardRefreshFailed")}</p>}
            </div>
            {(refreshFailed || storyboardError) && onRefresh && <Button variant="quiet" isPending={refreshing} onPress={onRefresh}>{tAudio("refreshStatus")}</Button>}
            {(refinementCount > 0 || state === "phase2") && onRefine && <span key="refine" hidden={canDefer && !detailsOpen}><Button variant="quiet" isPending={pending} isDisabled={state === "dialogue"} onPress={onRefine}>
                {!pending && <Sparkles size={14} aria-hidden="true" />}{t(pending ? "refiningPrompt" : retry ? "storyboardRetryRefinement" : "storyboardContinueRefinement")}
            </Button></span>}
            {canDefer && <Button key="details" variant="quiet" aria-expanded={detailsOpen} onPress={() => setDetailsOpen(open => !open)}>
                {t(detailsOpen ? "storyboardHideRefinement" : "storyboardShowRefinement")}{detailsOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </Button>}
        </BannerShell>;
    }
    if (state === "idle" && !batch && !batchError) return null;
    if (state === "summary" || state === "dialogue" || state === "idle") {
        const pending = state === "dialogue";
        if (!pending && !batch && !batchError && !summary?.dialogueReady && !summary?.dialogueMissing) return null;
        const results = Object.values(batch?.results ?? {});
        const failed = results.filter(result => result === "failed").length;
        const error = batchError || (batch?.status === "failed" ? batch.error || t("batchDialogueInterrupted") : undefined);
        const retry = !pending && (!!error || failed > 0);
        return <BannerShell>
            <div className="min-w-0 basis-full space-y-1 text-xs text-text-secondary sm:flex-1 sm:basis-0">
                {pending ? <LoadingState inline className="justify-start" label={dialogueProgress
                    ? t("bannerDialogueProgress", dialogueProgress)
                    : t("batchDialoguePreparing")} /> : <span role="status">
                    {batch ? t("batchDialogueResults", {
                        generated: results.filter(result => result === "generated").length,
                        skipped: results.filter(result => result === "skipped").length,
                        failed,
                    }) : t("bannerFrameCount", { count: summary?.frameCount ?? 0 })}
                    {!!summary?.dialogueReady && <> · {t("bannerDialoguePending", { count: summary.dialogueReady })}</>}
                </span>}
                {!!summary?.dialogueMissing && <p>{t("bannerDialogueMissingVoice", { count: summary.dialogueMissing })}</p>}
                {results.includes("busy") && <p>{t("batchDialogueBusy", { count: results.filter(result => result === "busy").length })}</p>}
                {error && <p role="alert" className="break-words text-status-failed-fg">{error}</p>}
                {refreshFailed && <p role="alert">{t("batchDialogueRefreshFailed")}</p>}
            </div>
            {refreshFailed && onRefresh && <Button variant="quiet" isPending={refreshing} onPress={onRefresh}>{tAudio("refreshStatus")}</Button>}
            {(pending || retry || !!summary?.dialogueReady) && onGenerateDialogue && <Button variant="quiet" isPending={pending} onPress={onGenerateDialogue}>
                {!pending && <Mic size={14} aria-hidden="true" />}{t(retry ? "batchDialogueRetry" : "bannerSynthDialogue")}
            </Button>}
        </BannerShell>;
    }
    return null;
}
function BannerShell({ children }: { children: ReactNode }) {
    const reducedMotion = useReducedMotion();
    return <motion.div initial={reducedMotion ? false : { opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reducedMotion ? 0 : .18 }}
        className={styles.shell}>
        {children}
    </motion.div>;
}
