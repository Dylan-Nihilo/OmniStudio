"use client";
import { type ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Mic, Sparkles } from "lucide-react";
import { Button, LoadingState } from "@omnistudio/ui";
import { useTranslations } from "next-intl";
import type { DialogueAudioBatch, StoryboardGeneration } from "@/lib/api";

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
}
export function GenerationBanner({ state, phase1Captions, refineProgress, dialogueProgress, summary, onGenerateDialogue, batch, batchError, refreshFailed, refreshing, onRefresh, storyboard, storyboardError, storyboardRecovering, refinementCount = 0, onRefine }: GenerationBannerProps) {
    const t = useTranslations("storyboardR2V");
    const tAudio = useTranslations("dialogueAudio");
    if (state === "phase1" || state === "phase2" || storyboardError || refinementCount > 0 || storyboard?.status === "failed") {
        const pending = state === "phase1" || state === "phase2";
        const retry = storyboard?.phase === "refine";
        const error = storyboardError || (!pending && storyboard?.status === "failed" ? storyboard.error || t("storyboardInterrupted") : undefined);
        const label = storyboardRecovering ? t("storyboardChecking") : state === "phase1"
            ? phase1Captions[0] || t("genInFlight")
            : t("bannerRefineProgress", { current: refineProgress?.current ?? 0, total: refineProgress?.total ?? 0 });
        return <BannerShell>
            <div className="min-w-0 basis-full space-y-1 text-xs text-text-secondary sm:flex-1 sm:basis-0">
                {pending ? <LoadingState inline className="justify-start" label={label} />
                    : refinementCount > 0 && <p role="status">{t(retry ? "storyboardRefinementRemaining" : "storyboardReadyToRefine", { count: refinementCount })}</p>}
                {error && <p role="alert" className="break-words text-status-failed-fg">{error}</p>}
                {refreshFailed && <p role="alert">{t("storyboardRefreshFailed")}</p>}
            </div>
            {(refreshFailed || storyboardError) && onRefresh && <Button variant="quiet" isPending={refreshing} onPress={onRefresh}>{tAudio("refreshStatus")}</Button>}
            {(refinementCount > 0 || state === "phase2") && onRefine && <Button variant="quiet" isPending={pending} isDisabled={state === "dialogue"} onPress={onRefine}>
                {!pending && <Sparkles size={14} aria-hidden="true" />}{t(pending ? "refiningPrompt" : retry ? "storyboardRetryRefinement" : "storyboardContinueRefinement")}
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
        className="mx-4 mb-3 flex shrink-0 flex-wrap items-center gap-3 rounded-lg border border-glass-border bg-surface px-3 py-2 sm:mx-8">
        {children}
    </motion.div>;
}
