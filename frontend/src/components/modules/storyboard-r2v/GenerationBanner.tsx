"use client";
import { useState, useEffect, type ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { CheckCircle2, Mic } from "lucide-react";
import { Button, LoadingState } from "@omnistudio/ui";
import { useTranslations } from "next-intl";

export type BannerState = "idle" | "phase1" | "phase2" | "dialogue" | "summary";
export interface GenerationBannerProps {
    state: BannerState;
    phase1Captions: string[];
    refineProgress?: { current: number; total: number } | null;
    dialogueProgress?: { current: number; total: number } | null;
    summary?: { frameCount: number; dialogueReady: number; dialogueMissing: number } | null;
    onGenerateDialogue?: () => void;
}
export function GenerationBanner({ state, phase1Captions, refineProgress, dialogueProgress, summary, onGenerateDialogue }: GenerationBannerProps) {
    const t = useTranslations("storyboardR2V");
    const [captionIndex, setCaptionIndex] = useState(0);
    useEffect(() => {
        setCaptionIndex(0);
        if (state !== "phase1" || phase1Captions.length < 2) return;
        const timer = setInterval(() => setCaptionIndex(index => (index + 1) % phase1Captions.length), 3000);
        return () => clearInterval(timer);
    }, [state, phase1Captions.length]);
    if (state === "idle") return null;
    if (state === "summary") {
        // The sequence shows frame count; reserve the banner for actionable audio status.
        if (!summary || (!summary.dialogueReady && !summary.dialogueMissing)) return null;
        return <BannerShell>
            <CheckCircle2 size={16} className="shrink-0 text-status-completed-fg" aria-hidden="true" />
            <span className="text-xs text-text-secondary" role="status">
                {t("bannerFrameCount", { count: summary.frameCount })}
                {summary.dialogueReady > 0 && <> · {t("bannerDialoguePending", { count: summary.dialogueReady })}</>}
                {summary.dialogueMissing > 0 && <> · {t("bannerDialogueMissingVoice", { count: summary.dialogueMissing })}</>}
            </span>
            {summary.dialogueReady > 0 && onGenerateDialogue && <Button variant="quiet" className="ml-auto" onPress={onGenerateDialogue}><Mic size={14} />{t("bannerSynthDialogue")}</Button>}
        </BannerShell>;
    }
    const progress = state === "phase2" ? refineProgress : dialogueProgress;
    const label = state === "phase1" ? phase1Captions[captionIndex] || t("genInFlight")
        : t(state === "phase2" ? "bannerRefineProgress" : "bannerDialogueProgress", { current: progress?.current ?? 0, total: progress?.total ?? 0 });
    return <BannerShell key={state}><LoadingState inline label={label} /></BannerShell>;
}
function BannerShell({ children }: { children: ReactNode }) {
    const reducedMotion = useReducedMotion();
    return <motion.div initial={reducedMotion ? false : { opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reducedMotion ? 0 : .18 }}
        className="mx-4 mb-3 flex shrink-0 flex-wrap items-center gap-3 rounded-lg border border-glass-border bg-surface px-3 py-2 sm:mx-8">
        {children}
    </motion.div>;
}
