"use client";

import { useRef, useCallback, useEffect, useState, useMemo, type ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
    Trash2,
    ChevronUp,
    ChevronDown,
    Copy,
    Video,
    ImageIcon,
    AtSign,
    Maximize2,
    PanelBottomOpen,
    PanelBottomClose,
    Sparkles,
    Loader2,
    Code2,
    ChevronRight,
    PinOff,
} from "lucide-react";
import { useTranslations } from "next-intl";
import AssetChipBar from "./AssetChipBar";
import PromptExpandModal from "./PromptExpandModal";
import PolishPanel from "./PolishPanel";
import FieldTagChip, { AddFieldButton, type FieldType } from "./FieldTagChip";
import { buildAssembledPrompt } from "./buildAssembledPrompt";
import { PendingTaskAffordance } from "@/components/shared/PendingTaskAffordance";
import PreviewImage from "@/components/shared/preview/PreviewImage";
import PreviewVideo from "@/components/shared/preview/PreviewVideo";
import { useProjectStore } from "@/store/projectStore";
import { Button, ActionMenu, SelectField, LoadingState, StatusBadge } from "@omnistudio/ui";
import styles from "./ShotCard.module.css";
import { selectedVariantUrl } from "@/lib/characterImage";

export interface ShotNode {
    id: string;
    prompt: string;
    tabMode: "t2i_i2v" | "direct_r2v";

    // T2I stage (only for t2i_i2v mode). Single-task fields stay here
    // for backward compat with existing shot drafts and the legacy
    // single-image preview. New: a history of generated T2I images per
    // shot + an index for the currently-active one (the one used as
    // first-frame for I2V). Persisted in localStorage with the rest of
    // the shot state. See Storyboard R2V redesign discussion.
    t2iImageUrl?: string;
    t2iTaskId?: string;
    t2iError?: string;
    t2iOperation?: "generate" | "upload";
    t2iRecovering?: boolean;
    t2iStatus?: "pending" | "processing" | "completed" | "failed";
    /** Ordered list of every T2I image URL this shot has produced.
     *  Newest at the end. Active one is at t2iSelectedIndex (defaults
     *  to last). Bounded to T2I_HISTORY_LIMIT FIFO to keep
     *  localStorage from growing without bound. */
    t2iImageUrls?: string[];
    t2iSelectedIndex?: number;

    // Video stage (shared). The single-task fields stay for "the most
    // recent attempt" but the candidates panel reads from the shot's
    // full videoTaskIds history (cross-referenced against the script's
    // video_tasks list which is persisted server-side).
    videoUrl?: string;
    videoTaskId?: string;
    videoStatus?: "pending" | "processing" | "completed" | "failed";
    /** Issue 16 — final take selection (Z plan). Set in Assembly stage; read
     *  by Storyboard's ShotCard top preview as the canonical "this is the
     *  shipped output". Falls back to latest starred / latest completed /
     *  first frame when null. */
    finalTakeId?: string | null;
    /** Every video task this shot has spawned, oldest first. Each tab
     *  (t2i_i2v / direct_r2v) gets its own list — see videoTaskIdsByTab.
     *  Empty / missing → no history (e.g. legacy shots). */
    videoTaskIdsByTab?: {
        t2i_i2v?: string[];
        direct_r2v?: string[];
    };
    imageUrl?: string;

    // ─── Storyboard Schema v2 fields ────────────────────────────────
    duration?: number | null;
    visualDescription?: string | null;
    assembledPrompt?: string | null;
    dialogueStructured?: {
        speaker: string;
        line: string;
        emotion?: string | null;
        delivery?: string | null;
    } | null;
    cameraMovementStructured?: {
        primary: string;
        secondary?: string | null;
        speed: string;
        description?: string | null;
    } | null;
    shotSize?: string | null;
    cameraAngle?: string | null;
    transitionHint?: string | null;

    /** When true, the user has manually pinned an active take. Hero
     *  shows a "Pinned" chip; autoSelectLatestVideo skips this frame on
     *  the backend, so new completed tasks stay in Candidates without
     *  overwriting the user's pick. Sourced from frame.is_video_pinned. */
    isVideoPinned?: boolean;
}

/** Cap on T2I image history per shot. Older drops off FIFO when adding. */
export const T2I_HISTORY_LIMIT = 10;

interface ShotCardProps {
    shot: ShotNode;
    index: number;
    totalShots: number;
    characters: any[];
    scenes: any[];
    props: any[];
    onUpdatePrompt: (prompt: string) => void;
    onUpdateField: (field: string, value: string | number | null) => void;
    onGenerateT2I: () => void;
    onGenerateVideo: () => void;
    structurePending?: boolean;
    onDelete: () => void;
    onMoveUp: () => void;
    onMoveDown: () => void;
    onDuplicate: () => void;
    onSetTabMode: (mode: "t2i_i2v" | "direct_r2v") => void;
    onOpenDrawer: () => void;
    onInsertAsset: (type: string, name: string) => void;
    /** Duration editor config derived from model catalog */
    durationEditorConfig?: { min: number; max: number; step: number };
    /** Optional: Cancel CTA shown inside the pending-state affordance
     *  after the soft-stuck threshold (60 s by default). Caller should
     *  hit the backend cancel endpoint and refresh local state. */
    onCancelVideo?: () => Promise<void> | void;
    /** Issue 16 — per-shot expand state (P plan). When false, the
     *  Setup/Takes chips below the card are hidden entirely (zero chrome
     *  residue). When true, chips render. The chevron in the card's
     *  top-right corner toggles this. */
    referenceImages?: string[];
    sequence?: ReactNode;
    audio?: ReactNode;
    configuration?: ReactNode;
    candidates?: ReactNode;
    /** PR-3c · 闭环生成. Generation 移到 ShotCard 内的全宽行 (Action
     *  Bar 之后, disclosure bar 之前), 含 count selector 同行. Host
     *  传入 current count + handlers + canGenerate gate.
     *  Spec: r2v-workflow-v3-unified.md §4.3.1 / Q12. */
    generateCount?: number;
    /** At-a-glance "model · duration" summary shown in the generation row,
     *  visible even when the attached ShotPanel is collapsed (calm-default). */
    genSummary?: string;
    canGenerate?: boolean;
    onSetGenerateCount?: (count: number) => void;
    onGenerateBatch?: (count: number) => void;
    /** Active in-flight count for label flip (生成 ×N → 生成中 · N). */
    inFlightCount?: number;
    onRefineFrame?: () => void;
    isRefining?: boolean;
    onUpdateDialogue?: (text: string) => void;
    /** Active-take pin controls. When the user has manually pinned an
     *  active take (shot.isVideoPinned=true), the hero shows a "📌 Pinned"
     *  chip; clicking it fires onUnpinVideo to resume auto latest-wins. */
    onUnpinVideo?: () => void;
    isSelectingVideo?: boolean;
}

export default function ShotCard({
    shot,
    index,
    totalShots,
    characters,
    scenes,
    props,
    onUpdatePrompt,
    onUpdateField,
    onGenerateT2I,
    onGenerateVideo,
    structurePending = false,
    onDelete,
    onMoveUp,
    onMoveDown,
    onDuplicate,
    onSetTabMode,
    onOpenDrawer,
    onInsertAsset: _onInsertAsset,
    durationEditorConfig,
    onCancelVideo,
    sequence, audio, configuration, candidates, referenceImages = [],
    generateCount = 1,
    genSummary,
    canGenerate = true,
    onSetGenerateCount,
    onGenerateBatch,
    inFlightCount = 0,
    onRefineFrame,
    isRefining = false,
    onUnpinVideo,
    isSelectingVideo = false,
}: ShotCardProps) {
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const t = useTranslations("storyboardR2V");
    // Expand modal state (B5). Cmd/Ctrl+E in the small textarea
    // opens it; saving syncs back via onUpdatePrompt; cancel
    // discards the modal's draft without touching parent state.
    const [expandOpen, setExpandOpen] = useState(false);
    const [promptPreviewOpen, setPromptPreviewOpen] = useState(false);
    useEffect(() => { setExpandOpen(false); setPromptPreviewOpen(false); }, [shot.id]);
    // currentProjectId — needed by PolishPanel to look up the
    // project's PromptConfig override server-side.
    const currentProjectId = useProjectStore((state) => state.currentProject?.id);
    // r2vSlots — when R2V tab is active, derive slot context from
    // @character references in the prompt so the polish system
    // prompt knows what character1/character2 ID maps to. Dedup by
    // slot number (first-seen wins) and sort ascending so the list
    // index aligns with HappyHorse's characterN positional mapping.
    // Backend polish_r2v_prompt re-numbers with enumerate(slots),
    // which only matches the prompt's characterN tags when slots
    // are unique and ordered.
    const r2vSlots = useCallback((): { description: string }[] => {
        if (shot.tabMode !== "direct_r2v") return [];
        const bySlot = new Map<number, string>();
        const tagPattern = /\[character(\d+):([^\]]+)\]/g;
        let match;
        while ((match = tagPattern.exec(shot.prompt)) !== null) {
            const slotN = parseInt(match[1], 10);
            if (bySlot.has(slotN)) continue;
            const name = match[2];
            const char = characters.find((c: any) => c.name === name);
            bySlot.set(slotN, char?.description ? `${name}: ${char.description}` : name);
        }
        return Array.from(bySlot.entries())
            .sort((a, b) => a[0] - b[0])
            .map(([, description]) => ({ description }));
    }, [shot.tabMode, shot.prompt, characters])();

    // polishImageUrls — feed vision-capable polish (Issue 13) with the
    // images the polish actually needs to "see":
    //   • i2v: the active first frame (T2I selection if any, else the
    //     Storyboard render). No frame yet → empty → text-only polish.
    //   • r2v: each referenced character's avatar/headshot/full body
    //     image, dedup'd by id. No references → empty → text-only.
    const polishImageUrls = useCallback((): string[] => {
        if (shot.tabMode === "direct_r2v") {
            const out: string[] = [];
            const seen = new Set<string>();
            const tagPattern = /\[character\d*:([^\]]+)\]/g;
            let m;
            while ((m = tagPattern.exec(shot.prompt)) !== null) {
                const [, name] = m;
                const char = characters.find((c: any) => c.name === name);
                if (!char || seen.has(char.id)) continue;
                seen.add(char.id);
                const url = char.headshot_image_url || char.image_url || char.full_body_image_url
                    || selectedVariantUrl(char.reference_sheet)
                    || (char.full_body_asset?.variants?.[0]?.url);
                if (url) out.push(url);
            }
            return out.slice(0, 4); // cap at 4 to keep payload reasonable
        }
        // i2v: prefer active T2I image; fall back to storyboard frame.
        const active = (shot.t2iImageUrls && shot.t2iImageUrls.length > 0)
            ? shot.t2iImageUrls[Math.max(0, Math.min(shot.t2iSelectedIndex ?? 0, shot.t2iImageUrls.length - 1))]
            : (shot.t2iImageUrl || shot.imageUrl);
        return active ? [active] : [];
    }, [shot.tabMode, shot.prompt, shot.t2iImageUrls, shot.t2iSelectedIndex, shot.t2iImageUrl, shot.imageUrl, characters])();

    // castAvatars — character avatar group for the "Cast:" row above
    // the prompt textarea (L5 borrow from 火山剧创's 出镜角色). De-
    // duped by id. We accept either [character:name] or [characterN:
    // name] patterns since the asset chip bar emits both formats.
    const castAvatars = useCallback((): Array<{ id: string; name: string; avatarUrl?: string }> => {
        const out: Array<{ id: string; name: string; avatarUrl?: string }> = [];
        const seen = new Set<string>();
        const tagPattern = /\[character\d*:([^\]]+)\]/g;
        let match;
        while ((match = tagPattern.exec(shot.prompt)) !== null) {
            const [, name] = match;
            const char = characters.find((c: any) => c.name === name);
            if (!char || seen.has(char.id)) continue;
            seen.add(char.id);
            const avatarUrl =
                char.avatar_url ||
                char.headshot_image_url ||
                char.image_url ||
                char.full_body_image_url ||
                selectedVariantUrl(char.reference_sheet) ||
                (char.full_body_asset?.variants?.[0]?.url);
            out.push({ id: char.id, name: char.name, avatarUrl });
        }
        return out;
    }, [shot.prompt, characters])();

    const assembledPromptPreview = useMemo(() => buildAssembledPrompt(shot), [
        shot.prompt, shot.shotSize, shot.cameraAngle, shot.cameraMovementStructured, shot.transitionHint,
    ]);

    useEffect(() => {
        const ta = textareaRef.current;
        if (!ta) return;
        // Reset before measuring so shrinking also works (delete text).
        ta.style.height = "auto";
        const next = Math.min(ta.scrollHeight, 260);
        ta.style.height = `${next}px`;
    }, [shot.prompt]);

    const renderPreview = () => {
        if (shot.tabMode === "t2i_i2v") {
            if (shot.videoUrl) {
                return (
                    <PreviewVideo
                        src={shot.videoUrl}
                        alt={t("generatedVideo") || "Generated video"}
                        className="w-full aspect-video"
                    />
                );
            }
            if (shot.videoStatus === "processing" || shot.videoStatus === "pending") {
                return (
                    <div className="w-full aspect-video flex items-center justify-center">
                        <PendingTaskAffordance
                            statusLabel={shot.videoStatus === "pending" ? t("queued") : t("generatingVideo")}
                            taskId={shot.videoTaskId}
                            onCancel={onCancelVideo}
                        />
                    </div>
                );
            }
            if (shot.videoStatus === "failed") {
                return (
                    <div className="w-full aspect-video flex flex-col items-center justify-center gap-2">
                        <span className="text-[0.6875rem] text-status-failed-fg font-medium">{t("generationFailed")}</span>
                        <button
                            onClick={onGenerateVideo}
                            className="text-[0.6875rem] text-primary hover:text-primary/80 transition-colors font-medium"
                        >
                            {t("retry")}
                        </button>
                    </div>
                );
            }
            if (shot.t2iImageUrl) {
                // Fixed: was rendering raw `<img src={shot.t2iImageUrl}>` —
                // shot.t2iImageUrl is a relative path (e.g. "uploads/t2i_xxx.jpg")
                // which the browser resolved against the current origin → 404 →
                // broken icon + "Generated frame" alt fallback. PreviewImage
                // routes through getAssetUrl() (Issue 14).
                //
                // Issue 15: bottom badge label changed to "next: generate
                // video →" so the user knows the first frame is in place and
                // the next step is downstream, not another image gen.
                return (
                    <div className="w-full aspect-video relative">
                        <PreviewImage
                            src={shot.t2iImageUrl}
                            alt={t("t2iCompleted") || "First frame"}
                            className="w-full h-full"
                        />
                        <div className="absolute bottom-2 left-2 text-[0.625rem] px-1.5 py-0.5 rounded-full bg-status-completed-bg/90 text-white font-medium backdrop-blur-sm pointer-events-none">
                            {t("generateVideoNext")}
                        </div>
                    </div>
                );
            }
            if (shot.t2iStatus === "processing" || shot.t2iStatus === "pending") {
                return (
                    <div className="w-full aspect-video flex items-center justify-center">
                        <PendingTaskAffordance
                            statusLabel={shot.t2iStatus === "pending" ? t("queued") : t("t2iGenerating")}
                            taskId={shot.t2iTaskId}
                        />
                    </div>
                );
            }
            if (shot.t2iStatus === "failed") {
                return (
                    <div className="w-full aspect-video flex flex-col items-center justify-center gap-2">
                        <span className="text-[0.6875rem] text-status-failed-fg font-medium">{t("generationFailed")}</span>
                        <button
                            onClick={onGenerateT2I}
                            className="text-[0.6875rem] text-primary hover:text-primary/80 transition-colors font-medium"
                        >
                            {t("retry")}
                        </button>
                    </div>
                );
            }
            // I2V tab, no first frame yet — the active CTA is in the
            // Step 1 panel below (Hero state), not here. Just signal
            // "waiting for a first frame" so the user knows where to
            // act (Issue 15).
            return (
                <div className="w-full aspect-video flex flex-col items-center justify-center gap-2.5 text-text-muted">
                    <ImageIcon size={24} strokeWidth={1.6} className="opacity-50" />
                    <span className="font-mono text-[0.65625rem] uppercase tracking-[0.08em]">{t("generateImageOrUpload")}</span>
                </div>
            );
        }

        // Direct R2V mode
        if (shot.videoUrl) {
            return (
                <PreviewVideo
                    src={shot.videoUrl}
                    alt={t("generatedVideo") || "Generated video"}
                    className="w-full aspect-video"
                />
            );
        }
        if (shot.videoStatus === "processing" || shot.videoStatus === "pending") {
            return (
                <div className="w-full aspect-video flex items-center justify-center">
                    <PendingTaskAffordance
                        statusLabel={shot.videoStatus === "pending" ? t("queued") : t("generatingVideo")}
                        taskId={shot.videoTaskId}
                        onCancel={onCancelVideo}
                    />
                </div>
            );
        }
        if (shot.videoStatus === "failed") {
            return (
                <div className="w-full aspect-video flex flex-col items-center justify-center gap-2">
                    <span className="text-[0.6875rem] text-status-failed-fg font-medium">{t("generationFailed")}</span>
                    <button
                        onClick={onGenerateVideo}
                        className="text-[0.6875rem] text-primary hover:text-primary/80 transition-colors font-medium"
                    >
                        {t("retry")}
                    </button>
                </div>
            );
        }
        if (shot.imageUrl) return <PreviewImage src={shot.imageUrl} alt={t("shot") + " " + (index + 1)} className="w-full aspect-video" />;
        return (
            <div className="w-full aspect-video flex flex-col items-center justify-center gap-2.5 text-text-muted">
                <Video size={24} strokeWidth={1.6} className="opacity-50" />
                <span className="font-mono text-[0.65625rem] uppercase tracking-[0.08em]">{t("noVideoYet")}</span>
            </div>
        );
    };

    // Legacy renderGenerateButton was removed in the workbench
    // redesign (Sweep G, 2026-05-21): generation moved to the
    // ParamsSection's "Generate ×N" CTA inside the attached
    // ShotPanel, and T2I首帧 generation lives in T2ISubsection's
    // "+gen" tile. Keeping it on the ShotCard duplicated the action
    // with a different label (i18n vs English) and a different
    // batch-size semantics (×1 vs ×N) — confusing and the source of
    // the "two Generate buttons" bug report.
    // onGenerateVideo / onGenerateT2I are still wired for the inline
    // retry buttons inside renderPreview when a take fails.

    function ShotStatusBadge({ shot, t }: { shot: ShotNode; t: (key: string, values?: Record<string, number | string>) => string }) {
        const isProcessing = shot.videoStatus === "processing" || shot.t2iStatus === "processing";
        const isPending = !isProcessing && (shot.videoStatus === "pending" || shot.t2iStatus === "pending");
        const isFailed = !isProcessing && !isPending && (shot.videoStatus === "failed" || shot.t2iStatus === "failed");
        const isStarred = shot.isVideoPinned || shot.finalTakeId;
        if (isStarred) {
            return (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-status-starred-border bg-status-starred-bg px-2.5 py-1 font-mono text-[0.625rem] font-semibold uppercase tracking-[0.1em] text-status-starred-fg">
                    <span className="h-[5px] w-[5px] rounded-full bg-status-starred-solid" />
                    {t("statusStarred")}
                </span>
            );
        }
        if (isProcessing) {
            return (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-status-processing-border bg-status-processing-bg px-2.5 py-1 font-mono text-[0.625rem] font-semibold uppercase tracking-[0.1em] text-status-processing-fg">
                    <span className="h-[5px] w-[5px] rounded-full bg-status-processing-fg animate-pulse" />
                    {t("statusProcessing")}
                </span>
            );
        }
        if (isPending) {
            return (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-status-pending-border bg-status-pending-bg px-2.5 py-1 font-mono text-[0.625rem] font-semibold uppercase tracking-[0.1em] text-status-pending-fg">
                    <span className="h-[5px] w-[5px] rounded-full bg-status-pending-fg" />
                    {t("statusPending")}
                </span>
            );
        }
        if (isFailed) {
            return (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-status-failed-border bg-status-failed-bg px-2.5 py-1 font-mono text-[0.625rem] font-semibold uppercase tracking-[0.1em] text-status-failed-fg">
                    <span className="h-[5px] w-[5px] rounded-full bg-status-failed-fg" />
                    {t("statusFailed")}
                </span>
            );
        }
        return (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-glass-border bg-black/20 px-2.5 py-1 font-mono text-[0.625rem] font-semibold uppercase tracking-[0.1em] text-text-secondary">
                <span className="h-[5px] w-[5px] rounded-full bg-text-muted" />
                {t("statusReady")}
            </span>
        );
    }

    const handleInsertAssetFromChip = (_type: string, name: string) => {
        const currentPrompt = shot.prompt;
        // Each unique character gets one fixed slot number throughout this
        // prompt: slot N → reference_image_urls[N-1] in HappyHorse R2V, so
        // referencing the same actor twice must reuse the same slot —
        // otherwise the model would expect two separate reference images.
        // Examples:
        //   first @小兔子 → [character1:小兔子]
        //   then @小狗 → [character2:小狗]
        //   then @小兔子 again → [character1:小兔子]   (reuse, NOT [character3:…])
        const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const existingTagRe = new RegExp(`\\[character(\\d+):${escapedName}\\]`);
        const existingMatch = currentPrompt.match(existingTagRe);

        let slot: number;
        if (existingMatch) {
            slot = parseInt(existingMatch[1], 10);
        } else {
            // Map of (slot → name) already in the prompt; first-seen wins
            // per slot so accidental dup tags don't inflate the count.
            const usedSlotByName = new Map<number, string>();
            const slotRe = /\[character(\d+):([^\]]+)\]/g;
            let m;
            while ((m = slotRe.exec(currentPrompt)) !== null) {
                const slotN = parseInt(m[1], 10);
                if (!usedSlotByName.has(slotN)) {
                    usedSlotByName.set(slotN, m[2]);
                }
            }
            const usedSlots = Array.from(usedSlotByName.keys());
            slot = usedSlots.length > 0 ? Math.max(...usedSlots) + 1 : 1;
        }
        const tag = `[character${slot}:${name}]`;

        const textarea = textareaRef.current;
        if (textarea) {
            const start = textarea.selectionStart;
            const end = textarea.selectionEnd;
            const newPrompt = currentPrompt.slice(0, start) + tag + currentPrompt.slice(end);
            onUpdatePrompt(newPrompt);
            setTimeout(() => {
                textarea.selectionStart = textarea.selectionEnd = start + tag.length;
                textarea.focus();
            }, 0);
        } else {
            onUpdatePrompt(currentPrompt + " " + tag);
        }
    };

    return <div className={styles.layout}>
        <section className={styles.previewColumn}>
            <div className={styles.preview}>
                        {renderPreview()}
            </div>
            {shot.videoUrl && <div className={styles.previewActions}>
                <div>
                    {shot.isVideoPinned ? <StatusBadge tone="info">{t("activeTakePinned")}</StatusBadge> : shot.finalTakeId ? <StatusBadge tone="info">{t("selectedTake")}</StatusBadge> : null}
                    {shot.duration ? <span>{shot.duration}s</span> : null}
                </div>
                {shot.isVideoPinned && onUnpinVideo && <Button variant="quiet" aria-label={t("unpinActiveTake")} isPending={isSelectingVideo} isDisabled={isSelectingVideo} onPress={onUnpinVideo}>
                    {!isSelectingVideo && <PinOff size={16} />}{t("unpinActiveTakeShort")}
                </Button>}
            </div>}
            {shot.dialogueStructured?.line && <p className={styles.caption}>{shot.dialogueStructured.speaker} · {shot.dialogueStructured.line}</p>}
            {audio}
            {sequence}
        </section>
        <aside className={styles.settings} aria-busy={isRefining}>
            <header className={styles.heading}><span>{t("shot")} {String(index + 1).padStart(2, "0")}</span>{isRefining ? <LoadingState inline label={t("refiningPrompt")} /> : <ShotStatusBadge shot={shot} t={t} />}</header>
            <SelectField label={t("generationMode")} value={shot.tabMode} onChange={key => onSetTabMode(String(key) as ShotNode["tabMode"])} options={[{ id: "direct_r2v", label: t("tabDirectR2v") }, { id: "t2i_i2v", label: t("tabT2iI2v") }]} />
            <div className={styles.editor}>
                        {/* Cast avatar group */}
                        {castAvatars.length > 0 ? (
                            <div className="flex items-center gap-2">
                                <span className="font-mono text-[0.625rem] uppercase tracking-[0.1em] text-text-muted">
                                    {t("shotCast")}
                                </span>
                                <div className="flex items-center -space-x-2">
                                    {castAvatars.slice(0, 3).map((c) => (
                                        <button
                                            key={c.id}
                                            type="button"
                                            onClick={() => {
                                                document.dispatchEvent(
                                                    new CustomEvent("omni_studio:navigateStep", { detail: "cast" }),
                                                );
                                            }}
                                            title={c.name}
                                            className="grid h-[26px] w-[26px] place-items-center overflow-hidden rounded-full border-2 border-surface bg-elevated transition-all duration-fast ease-out-quart hover:z-10 hover:scale-110 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/55"
                                        >
                                            {c.avatarUrl ? (
                                                <PreviewImage
                                                    src={c.avatarUrl}
                                                    alt={c.name}
                                                    className="h-full w-full"
                                                    noLightbox
                                                />
                                            ) : (
                                                <span className="font-mono text-[0.5625rem] font-medium text-text-secondary">
                                                    {c.name.slice(0, 1)}
                                                </span>
                                            )}
                                        </button>
                                    ))}
                                    {castAvatars.length > 3 ? (
                                        <span className="grid h-[26px] w-[26px] place-items-center rounded-full border-2 border-surface bg-elevated font-mono text-[0.5625rem] font-medium text-text-secondary">
                                            +{castAvatars.length - 3}
                                        </span>
                                    ) : null}
                                </div>
                            </div>
                        ) : null}

                        {/* Prompt Editor wrapper — with left accent line */}
                        <div className="relative">
                            <textarea
                                ref={textareaRef}
                                aria-label={t("promptLabel")}
                                value={shot.prompt}
                                onChange={(e) => onUpdatePrompt(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key.toLowerCase() === "e" && (e.metaKey || e.ctrlKey)) {
                                        e.preventDefault();
                                        setExpandOpen(true);
                                    }
                                }}
                                placeholder={t("promptPlaceholder")}
                                className="w-full resize-none bg-transparent border-l-2 border-glass-border pl-3.5 pr-8 py-1 text-[13px] leading-[1.7] text-foreground placeholder:text-text-muted focus:outline-none focus:border-l-primary/40 focus:bg-glass/30 transition-all duration-200 min-h-[80px] max-h-[260px] overflow-y-auto"
                                rows={5}
                            />
                            {/* Expand-to-modal icon — top-right,
                                always visible. 24×24 hit area on
                                a 14×14 visual via padding. */}
                            <button
                                type="button"
                                onClick={() => setExpandOpen(true)}
                                aria-label={t("promptExpand")}
                                title={`${t("promptExpand")} (⌘/Ctrl + E)`}
                                className="btn-tip absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded text-text-muted/70 transition-colors duration-fast ease-out-quart hover:bg-hover-bg hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/55"
                            >
                                <Maximize2 size={12} aria-hidden="true" />
                            </button>
                        </div>

                        {/* AI Polish — bilingual prompt rewrite using
                            the project's polish system prompt
                            (storyboard_polish / video_polish /
                            r2v_polish from PromptConfig). Routes to
                            the right API by tabMode. */}
                        <PolishPanel key={shot.id}
                            prompt={shot.prompt}
                            tabMode={shot.tabMode}
                            scriptId={currentProjectId ?? ""}
                            slots={r2vSlots}
                            imageUrls={polishImageUrls}
                            onApply={onUpdatePrompt}
                        />

                        {/* Structured field tags — interactive Popover editors */}
                        <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                            {/* Duration: always visible */}
                            <FieldTagChip
                                field="duration"
                                value={shot.duration}
                                editorConfig={durationEditorConfig
                                    ? { type: "duration", ...durationEditorConfig }
                                    : { type: "duration", min: 3, max: 15, step: 1 }
                                }
                                onChange={(v) => onUpdateField("duration", v)}
                            />
                            {/* Shot size: visible when has value */}
                            {shot.shotSize !== undefined && shot.shotSize !== null && (
                                <FieldTagChip
                                    field="shotSize"
                                    value={shot.shotSize}
                                    editorConfig={{ type: "preset", presets: ["特写", "近景", "中景", "全景", "远景", "大特写"] }}
                                    onChange={(v) => onUpdateField("shotSize", v)}
                                />
                            )}
                            {/* Camera angle: visible when has value */}
                            {shot.cameraAngle !== undefined && shot.cameraAngle !== null && (
                                <FieldTagChip
                                    field="cameraAngle"
                                    value={shot.cameraAngle}
                                    editorConfig={{ type: "preset", presets: ["平视", "俯视", "仰视", "鸟瞰", "低角度"] }}
                                    onChange={(v) => onUpdateField("cameraAngle", v)}
                                />
                            )}
                            {/* Camera movement: visible when has value */}
                            {shot.cameraMovementStructured && (
                                <FieldTagChip
                                    field="cameraMovement"
                                    value={shot.cameraMovementStructured.description || shot.cameraMovementStructured.primary}
                                    editorConfig={{ type: "preset", presets: ["固定镜头", "缓慢推进", "跟随平移", "环绕旋转", "快速拉远", "缓慢上升"] }}
                                    onChange={(v) => onUpdateField("cameraMovement", v)}
                                />
                            )}
                            {/* Transition hint: visible when has value */}
                            {shot.transitionHint !== undefined && shot.transitionHint !== null && (
                                <FieldTagChip
                                    field="transitionHint"
                                    value={shot.transitionHint}
                                    editorConfig={{ type: "preset", presets: ["硬切", "淡入淡出", "溶解", "闪白", "划像"], allowCustom: true }}
                                    onChange={(v) => onUpdateField("transitionHint", v)}
                                />
                            )}
                            {/* "+" button to add optional fields */}
                            <AddFieldButton
                                onAdd={(field: FieldType) => {
                                    if (field === "cameraMovement") {
                                        onUpdateField("cameraMovement", "固定镜头");
                                    } else {
                                        onUpdateField(field, "");
                                    }
                                }}
                            />
                        </div>

                        {/* Dialogue text display (read-only — editing via 配音工作台 modal) */}
                        {shot.dialogueStructured?.line && (
                            <div className="pl-3.5 border-l-2 border-accent/40">
                                <span className="block font-mono text-[0.5625rem] uppercase tracking-[0.08em] text-text-muted">
                                    {shot.dialogueStructured.speaker}
                                </span>
                                <span className="block font-display text-[0.90625rem] italic leading-snug text-text-secondary">
                                    “{shot.dialogueStructured.line}”
                                </span>
                            </div>
                        )}

                        {/* Assembled prompt preview (read-only, collapsible) — uses buildAssembledPrompt for real-time computation */}
                        {(shot.prompt || shot.shotSize || shot.cameraMovementStructured) && (
                            <div className="mt-1">
                                <button
                                    type="button"
                                    onClick={() => setPromptPreviewOpen(v => !v)}
                                    className="inline-flex items-center gap-1 text-[0.6875rem] text-text-muted hover:text-text-secondary transition-colors"
                                >
                                    <Code2 size={12} strokeWidth={1.5} />
                                    <span>{t("viewFinalPrompt")}</span>
                                    <ChevronRight
                                        size={11}
                                        className={`transition-transform duration-200 ${promptPreviewOpen ? "rotate-90" : ""}`}
                                    />
                                </button>
                                <AnimatePresence>
                                    {promptPreviewOpen && (
                                        <motion.div
                                            initial={{ height: 0, opacity: 0 }}
                                            animate={{ height: "auto", opacity: 1 }}
                                            exit={{ height: 0, opacity: 0 }}
                                            transition={{ duration: 0.2 }}
                                            className="overflow-hidden"
                                        >
                                            <div className="mt-1.5 rounded-md border border-glass-border bg-black/20 px-3 py-2 text-[0.71875rem] leading-relaxed font-mono space-y-2">
                                                {/* Final prompt as model receives it (computed real-time) */}
                                                <p className="text-text-secondary whitespace-pre-wrap">
                                                    {assembledPromptPreview}
                                                </p>
                                                {/* Duration is the only field NOT in prompt — show as API param note */}
                                                {shot.duration && (
                                                    <p className="text-text-muted border-t border-border-subtle pt-1.5">
                                                        <span className="text-status-completed-fg/70">{t("durationLabel")}:</span> {shot.duration}s {t("durationApiNote")}
                                                    </p>
                                                )}
                                            </div>
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </div>
                        )}

                        {/* Asset Chip Bar */}
                        <AssetChipBar
                            characters={characters}
                            scenes={scenes}
                            props={props}
                            onInsertAsset={handleInsertAssetFromChip}
                        />

            </div>
            {referenceImages.length > 0 && <div className={styles.references}>{referenceImages.map((url, index) => <PreviewImage key={url} src={url} alt={t("referenceImage", { number: index + 1 })} className={styles.reference} />)}</div>}
            {configuration}
            <div className={styles.actions}>
                <ActionMenu label={t("shotActions")} items={[
                    { id: "assets", label: t("browseAssets"), onAction: onOpenDrawer },
                    { id: "up", label: t("moveUp"), onAction: onMoveUp, isDisabled: structurePending || isRefining || index === 0 },
                    { id: "down", label: t("moveDown"), onAction: onMoveDown, isDisabled: structurePending || isRefining || index === totalShots - 1 },
                    { id: "copy", label: t("duplicateShot"), onAction: onDuplicate, isDisabled: structurePending || isRefining },
                    ...(onRefineFrame ? [{ id: "refine", label: t("refineFrame"), onAction: onRefineFrame, isDisabled: isRefining || shot.id.startsWith("shot_") }] : []),
                    { id: "delete", label: t("deleteShot"), onAction: onDelete, isDisabled: structurePending || isRefining },
                ]} />
                <SelectField label={t("countLabel")} value={String(generateCount)} onChange={key => onSetGenerateCount?.(Number(key))} options={[1, 2, 4, 6].map(n => ({ id: String(n), label: String(n) }))} />
            </div>
            <Button className={styles.generate} onPress={() => onGenerateBatch?.(generateCount)} isDisabled={!canGenerate || isRefining} isPending={inFlightCount > 0}>
                {inFlightCount > 0 ? t("genClusterInFlight", { count: inFlightCount }) : t("generateBatch", { count: generateCount })}
            </Button>
            <p className={styles.summary}>{!canGenerate ? (shot.tabMode === "t2i_i2v" ? t("needFirstFrameTooltip") : t("needPromptInputTooltip")) : genSummary}</p>
            {candidates}
        </aside>
            {expandOpen ? (
                <PromptExpandModal
                    initialValue={shot.prompt}
                    shotLabel={`Shot ${index + 1}`}
                    placeholder={t("promptPlaceholder")}
                    onSave={(next) => {
                        onUpdatePrompt(next);
                        setExpandOpen(false);
                    }}
                    onClose={() => setExpandOpen(false)}
                />
            ) : null}

    </div>;
}
