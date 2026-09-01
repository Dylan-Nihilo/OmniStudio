"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Play, Pause, Loader2, AlertCircle, Mic, Film, Undo2, Crosshair, ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { AnimatePresence, motion } from "framer-motion";
import { api } from "@/lib/api";
import { getAssetUrl } from "@/lib/utils";

interface DialogueAudioRowProps {
    scriptId: string;
    frameId: string;
    dialogue: string | undefined;
    voiceId: string | undefined;
    audioUrl: string | undefined;
    audioError: string | null | undefined;
    snapshotDialogue?: string;
    snapshotVoiceId?: string;
    snapshotInstructions?: string;
    onAudioUpdated?: () => void | Promise<void>;
    onUpdateDialogue?: (text: string) => void;
    videoUrl?: string;
    videoTaskId?: string;
    previewVideoUrl?: string;
    dubbedVideoUrl?: string;
    dubOffsetMs?: number;
    onPreviewDub?: (videoTaskId: string, offsetMs: number) => Promise<void>;
    onApplyDub?: () => Promise<void>;
    onRevertDub?: () => Promise<void>;
}

const EMOTION_CHIPS = [
    "neutral",
    "happy",
    "sad",
    "angry",
    "surprised",
    "calm",
    "gentle",
    "serious",
] as const;

export const getDialogueAudioRowClasses = () =>
    "w-full rounded-[14px] border border-glass-border bg-surface-inset px-3.5 py-2.5 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.035)] transition-colors hover:border-foreground/30 hover:bg-hover-bg group";

export const getDialogueWorkbenchSurfaceClasses = () =>
    "relative w-full max-w-xl mx-4 rounded-xl border border-glass-border bg-surface shadow-2xl overflow-hidden max-h-[90vh] flex flex-col";

export const getDialogueInputClasses = () =>
    "w-full rounded-md border border-glass-border bg-input-bg text-foreground placeholder:text-text-muted focus:outline-none focus:border-primary/40";

export const getDialogueInsetControlClasses = () =>
    "border-glass-border bg-surface-inset text-text-secondary hover:border-foreground/30 hover:bg-hover-bg hover:text-foreground";

export default function DialogueAudioRow({
    scriptId,
    frameId,
    dialogue,
    voiceId,
    audioUrl,
    audioError,
    snapshotInstructions,
    onAudioUpdated,
    onUpdateDialogue,
    videoUrl,
    videoTaskId,
    previewVideoUrl,
    dubbedVideoUrl,
    dubOffsetMs = 0,
    onPreviewDub,
    onApplyDub,
    onRevertDub,
}: DialogueAudioRowProps) {
    const t = useTranslations("dialogueAudio");
    const [modalOpen, setModalOpen] = useState(false);

    const hasAudio = !!audioUrl;
    const hasVideo = !!(videoUrl && videoTaskId);
    const hasDub = !!dubbedVideoUrl;
    const hasPreview = !!previewVideoUrl;

    return (
        <>
            <button
                type="button"
                onClick={() => setModalOpen(true)}
                className={getDialogueAudioRowClasses()}
            >
                <div className="flex items-center gap-2">
                    <Mic size={12} className="text-text-muted shrink-0" />
                    <span className="font-mono text-[0.625rem] uppercase tracking-[0.16em] text-text-muted">
                        {t("title")}
                    </span>

                    {audioError && (
                        <span className="px-1.5 py-0.5 rounded font-mono text-[0.59375rem] uppercase tracking-[0.14em] bg-status-failed-bg text-status-failed-fg">
                            {t("state.error")}
                        </span>
                    )}
                    {hasAudio && !audioError && (
                        <span className="px-1.5 py-0.5 rounded font-mono text-[0.59375rem] uppercase tracking-[0.14em] bg-primary/10 text-primary">
                            {t("state.ready")}
                        </span>
                    )}
                    {hasDub && (
                        <span className="px-1.5 py-0.5 rounded font-mono text-[0.59375rem] uppercase tracking-[0.14em] bg-status-completed-bg text-status-completed-fg">
                            {t("overridden")}
                        </span>
                    )}
                    {hasPreview && !hasDub && (
                        <span className="px-1.5 py-0.5 rounded font-mono text-[0.59375rem] uppercase tracking-[0.14em] bg-accent/10 text-accent">
                            {t("previewingBadge")}
                        </span>
                    )}

                    <span className={`ml-auto text-[0.6875rem] font-medium transition-colors ${hasAudio ? "text-primary" : "text-text-secondary group-hover:text-foreground"}`}>
                        {hasVideo && hasAudio ? t("openWorkbench") : t("openVoiceGen")}
                    </span>
                </div>

                {dialogue?.trim() && (
                    <p className="mt-1 text-[0.6875rem] text-text-secondary truncate">
                        「{dialogue.trim().slice(0, 60)}{dialogue.trim().length > 60 ? "..." : ""}」
                    </p>
                )}
            </button>

            <DialogueWorkbenchModal
                isOpen={modalOpen}
                onClose={() => setModalOpen(false)}
                scriptId={scriptId}
                frameId={frameId}
                dialogue={dialogue}
                voiceId={voiceId}
                audioUrl={audioUrl}
                audioError={audioError}
                snapshotInstructions={snapshotInstructions}
                onAudioUpdated={onAudioUpdated}
                onUpdateDialogue={onUpdateDialogue}
                videoUrl={videoUrl}
                videoTaskId={videoTaskId}
                previewVideoUrl={previewVideoUrl}
                dubbedVideoUrl={dubbedVideoUrl}
                dubOffsetMs={dubOffsetMs}
                onPreviewDub={onPreviewDub}
                onApplyDub={onApplyDub}
                onRevertDub={onRevertDub}
            />
        </>
    );
}


function DialogueWorkbenchModal({
    isOpen,
    onClose,
    scriptId,
    frameId,
    dialogue,
    voiceId,
    audioUrl,
    audioError,
    snapshotInstructions,
    onAudioUpdated,
    onUpdateDialogue,
    videoUrl,
    videoTaskId,
    previewVideoUrl,
    dubbedVideoUrl,
    dubOffsetMs = 0,
    onPreviewDub,
    onApplyDub,
    onRevertDub,
}: {
    isOpen: boolean;
    onClose: () => void;
    scriptId: string;
    frameId: string;
    dialogue: string | undefined;
    voiceId: string | undefined;
    audioUrl: string | undefined;
    audioError: string | null | undefined;
    snapshotInstructions?: string;
    onAudioUpdated?: () => void | Promise<void>;
    onUpdateDialogue?: (text: string) => void;
    videoUrl?: string;
    videoTaskId?: string;
    previewVideoUrl?: string;
    dubbedVideoUrl?: string;
    dubOffsetMs?: number;
    onPreviewDub?: (videoTaskId: string, offsetMs: number) => Promise<void>;
    onApplyDub?: () => Promise<void>;
    onRevertDub?: () => Promise<void>;
}) {
    const t = useTranslations("dialogueAudio");
    const [dialogueDraft, setDialogueDraft] = useState(dialogue || "");
    const [emotion, setEmotion] = useState<string>(snapshotInstructions || "");
    const [freeText, setFreeText] = useState<string>("");
    const [busy, setBusy] = useState(false);
    const [playing, setPlaying] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [offsetMs, setOffsetMs] = useState(dubOffsetMs || 0);
    const [previewing, setPreviewing] = useState(false);
    const [applying, setApplying] = useState(false);
    const [reverting, setReverting] = useState(false);

    const audioRef = useRef<HTMLAudioElement | null>(null);
    const videoRef = useRef<HTMLVideoElement>(null);

    const instructions = useMemo(() => {
        const chip = EMOTION_CHIPS.includes(emotion as any) ? emotion : "";
        const free = freeText.trim();
        if (chip && free) return `${chip}; ${free}`;
        return chip || free || undefined;
    }, [emotion, freeText]);

    const canDub = !!(audioUrl && videoUrl && videoTaskId && onPreviewDub);
    const [videoDurationMs, setVideoDurationMs] = useState(5000);

    // Determine which video to show: preview > dubbed > original
    const displayVideoUrl = previewVideoUrl || dubbedVideoUrl || videoUrl;

    useEffect(() => { setDialogueDraft(dialogue || ""); }, [dialogue]);
    useEffect(() => {
        if (isOpen) { setError(null); }
    }, [isOpen]);
    useEffect(() => { return () => { audioRef.current?.pause(); }; }, []);

    const handleSaveDialogue = () => {
        if (onUpdateDialogue && dialogueDraft.trim() !== (dialogue || "").trim()) {
            onUpdateDialogue(dialogueDraft.trim());
        }
    };

    const handlePlayAudio = async () => {
        if (!audioUrl) return;
        if (audioRef.current && playing) {
            audioRef.current.pause();
            setPlaying(false);
            return;
        }
        const audio = new Audio(getAssetUrl(audioUrl));
        audio.onended = () => { setPlaying(false); audioRef.current = null; };
        audio.onerror = () => { setPlaying(false); setError(t("playFailed")); };
        audioRef.current = audio;
        setPlaying(true);
        try { await audio.play(); } catch (e: any) { setPlaying(false); setError(e?.message || t("playFailed")); }
    };

    const handleGenerate = async () => {
        if (!voiceId) { setError(t("noVoiceBound")); return; }
        if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; setPlaying(false); }
        setError(null);
        setBusy(true);
        try {
            const result = await api.generateLineAudio(scriptId, frameId, 1.0, 1.0, 50, instructions);
            const updatedFrame = result?.frames?.find((f: any) => f.id === frameId);
            if (updatedFrame?.audio_error) {
                setError(updatedFrame.audio_error);
            } else {
                await onAudioUpdated?.();
            }
        } catch (e: any) {
            setError(e?.message || t("generateFailed"));
        } finally {
            setBusy(false);
        }
    };

    const handleMarkStart = () => {
        if (videoRef.current) {
            const ms = Math.round(videoRef.current.currentTime * 1000);
            setOffsetMs(ms);
        }
    };

    const handlePreviewDub = async () => {
        if (!onPreviewDub || !videoTaskId) return;
        setPreviewing(true);
        setError(null);
        try {
            await onPreviewDub(videoTaskId, offsetMs);
        } catch (e: any) {
            setError(e?.response?.data?.detail || e?.message || t("previewFailed"));
        } finally {
            setPreviewing(false);
        }
    };

    const handleApply = async () => {
        if (!onApplyDub) return;
        setApplying(true);
        try {
            await onApplyDub();
        } catch (e: any) {
            setError(e?.response?.data?.detail || e?.message || t("applyFailed"));
        } finally {
            setApplying(false);
        }
    };

    const handleRevert = async () => {
        if (!onRevertDub) return;
        setReverting(true);
        setError(null);
        try {
            await onRevertDub();
        } catch (e: any) {
            setError(e?.response?.data?.detail || e?.message || t("undoFailed"));
        } finally {
            setReverting(false);
        }
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    className="fixed inset-0 z-[100] flex items-center justify-center"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.15 }}
                >
                    <motion.div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

                    <motion.div
                        className={getDialogueWorkbenchSurfaceClasses()}
                        initial={{ scale: 0.95, opacity: 0, y: 10 }}
                        animate={{ scale: 1, opacity: 1, y: 0 }}
                        exit={{ scale: 0.95, opacity: 0, y: 10 }}
                        transition={{ type: "spring", stiffness: 300, damping: 28 }}
                    >
                        {/* Header */}
                        <div className="flex items-center justify-between px-5 py-4 border-b border-glass-border/50 shrink-0">
                            <div className="flex items-center gap-3">
                                <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10 border border-primary/20">
                                    <Mic size={16} className="text-primary" />
                                </div>
                                <div>
                                    <h3 className="text-[0.875rem] font-medium text-foreground">{t("workbenchTitle")}</h3>
                                    <p className="text-[0.6875rem] text-text-muted mt-0.5">{t("workbenchSubtitle")}</p>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={onClose}
                                className="inline-flex items-center justify-center w-7 h-7 rounded-md text-text-muted hover:text-foreground hover:bg-hover-bg transition-colors"
                            >
                                ×
                            </button>
                        </div>

                        {/* Scrollable body */}
                        <div className="px-5 py-4 space-y-4 overflow-y-auto flex-1">
                            {/* Step 1: Dialogue text editing */}
                            <section className="space-y-2">
                                <div className="flex items-center gap-2">
                                    <span className="text-[0.75rem] font-medium text-text-secondary">{t("stepDialogueText")}</span>
                                    {!voiceId && (
                                        <span className="text-[0.625rem] text-accent">{t("needVoiceBindingHint")}</span>
                                    )}
                                </div>
                                <textarea
                                    value={dialogueDraft}
                                    onChange={(e) => setDialogueDraft(e.target.value)}
                                    onBlur={handleSaveDialogue}
                                    placeholder={t("dialoguePlaceholder")}
                                    rows={2}
                                    className={`${getDialogueInputClasses()} px-3 py-2 text-[0.75rem] resize-none`}
                                />
                            </section>

                            {/* Step 2: Emotion + TTS generation */}
                            <section className="space-y-2">
                                <div className="flex items-center gap-2">
                                    <span className="text-[0.75rem] font-medium text-text-secondary">{t("stepEmotionGen")}</span>
                                </div>
                                <div className="flex flex-wrap items-center gap-1">
                                    {EMOTION_CHIPS.map((chip) => (
                                        <button
                                            key={chip}
                                            onClick={() => setEmotion(emotion === chip ? "" : chip)}
                                            className={`px-2 py-0.5 rounded-full border font-mono text-[0.59375rem] uppercase tracking-[0.12em] transition-colors ${
                                                emotion === chip
                                                    ? "border-primary bg-primary/15 text-primary"
                                                    : getDialogueInsetControlClasses()
                                            }`}
                                        >
                                            {t(`emotion.${chip}`)}
                                        </button>
                                    ))}
                                </div>
                                <input
                                    type="text"
                                    value={freeText}
                                    onChange={(e) => setFreeText(e.target.value.slice(0, 80))}
                                    placeholder={t("freeTextPlaceholder")}
                                    className={`${getDialogueInputClasses()} px-3 py-1.5 text-[0.6875rem]`}
                                />
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={handleGenerate}
                                        disabled={busy || !voiceId || !dialogueDraft.trim()}
                                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-primary/40 bg-primary/10 text-[0.75rem] font-medium text-primary hover:bg-primary/15 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                    >
                                        {busy ? <Loader2 size={12} className="animate-spin" /> : <Mic size={12} />}
                                        {audioUrl ? t("regenerate") : t("generate")}
                                    </button>
                                    {audioUrl && (
                                        <button
                                            onClick={handlePlayAudio}
                                            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-[0.75rem] transition-colors ${getDialogueInsetControlClasses()}`}
                                        >
                                            {playing ? <Pause size={12} /> : <Play size={12} />}
                                            {playing ? t("pause") : t("previewTts")}
                                        </button>
                                    )}
                                    {audioUrl && (
                                        <span className="text-[0.625rem] text-status-completed-fg">{t("generatedTag")}</span>
                                    )}
                                </div>
                            </section>

                            {/* Step 3: Dub — visible when audio + video both exist */}
                            {canDub && (
                                <section className="space-y-3 border-t border-glass-border/50 pt-4">
                                    <div className="flex items-center gap-2">
                                        <span className="text-[0.75rem] font-medium text-text-secondary">{t("stepOverride")}</span>
                                        {dubbedVideoUrl && !previewVideoUrl && (
                                            <span className="px-1.5 py-0.5 rounded font-mono text-[0.5625rem] uppercase tracking-[0.14em] bg-status-completed-bg text-status-completed-fg">
                                                {t("overridden")}
                                            </span>
                                        )}
                                        {previewVideoUrl && (
                                            <span className="px-1.5 py-0.5 rounded font-mono text-[0.5625rem] uppercase tracking-[0.14em] bg-accent/10 text-accent">
                                                {t("previewVersion")}
                                            </span>
                                        )}
                                    </div>

                                    {/* Video player */}
                                    <div className="relative rounded-lg overflow-hidden border border-glass-border bg-black">
                                        <video
                                            ref={videoRef}
                                            key={displayVideoUrl}
                                            src={getAssetUrl(displayVideoUrl!)}
                                            className="w-full max-h-[200px] object-contain"
                                            controls
                                            autoPlay={!!previewVideoUrl}
                                            onLoadedMetadata={(e) => {
                                                const dur = (e.currentTarget.duration || 5) * 1000;
                                                setVideoDurationMs(Math.round(dur));
                                            }}
                                        />
                                        {previewVideoUrl && (
                                            <div className="absolute top-2 left-2 px-2 py-0.5 rounded-full bg-accent/20 border border-accent/30 text-[0.5625rem] font-medium text-accent">
                                                {t("previewVersion")}
                                            </div>
                                        )}
                                        {dubbedVideoUrl && !previewVideoUrl && (
                                            <div className="absolute top-2 left-2 px-2 py-0.5 rounded-full bg-status-completed-bg/20 border border-status-completed-border text-[0.5625rem] font-medium text-status-completed-fg">
                                                {t("dubbedVersion")}
                                            </div>
                                        )}
                                    </div>

                                    {/* Mark start point + Offset controls */}
                                    <div className="space-y-2">
                                        <div className="flex items-center gap-2">
                                            <button
                                                type="button"
                                                onClick={handleMarkStart}
                                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-primary/30 bg-primary/5 text-[0.6875rem] font-medium text-primary hover:bg-primary/10 transition-colors"
                                            >
                                                <Crosshair size={12} />
                                                {t("markStartPoint")}
                                            </button>
                                            <span className="text-[0.625rem] text-text-muted">{t("markStartHint")}</span>
                                        </div>

                                        <div className="flex items-center gap-2">
                                            <span className="text-[0.6875rem] text-text-muted shrink-0">{t("audioPosition")}</span>
                                            <button
                                                type="button"
                                                onClick={() => setOffsetMs(Math.max(0, offsetMs - 50))}
                                                className={`w-6 h-6 flex items-center justify-center rounded border text-text-muted transition-colors ${getDialogueInsetControlClasses()}`}
                                            >
                                                <ChevronLeft size={12} />
                                            </button>
                                            <input
                                                type="number"
                                                value={offsetMs}
                                                onChange={(e) => setOffsetMs(Math.max(0, Math.min(videoDurationMs, Number(e.target.value) || 0)))}
                                                className="w-[64px] rounded border border-glass-border bg-input-bg px-1.5 py-0.5 text-center font-mono text-[0.6875rem] text-primary focus:outline-none focus:border-primary/40"
                                            />
                                            <button
                                                type="button"
                                                onClick={() => setOffsetMs(Math.min(videoDurationMs, offsetMs + 50))}
                                                className={`w-6 h-6 flex items-center justify-center rounded border text-text-muted transition-colors ${getDialogueInsetControlClasses()}`}
                                            >
                                                <ChevronRight size={12} />
                                            </button>
                                            <span className="text-[0.625rem] text-text-muted">ms</span>
                                            <input
                                                type="range"
                                                min={0}
                                                max={videoDurationMs}
                                                step={50}
                                                value={offsetMs}
                                                onChange={(e) => setOffsetMs(Number(e.target.value))}
                                                className="flex-1 accent-primary h-1 cursor-pointer"
                                            />
                                        </div>
                                    </div>

                                    {/* Action buttons — state-dependent */}
                                    <div className="flex items-center gap-2 flex-wrap">
                                        {/* 预听 — always visible */}
                                        <button
                                            type="button"
                                            onClick={handlePreviewDub}
                                            disabled={previewing}
                                            className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-md border border-primary/40 bg-primary/10 text-[0.75rem] font-medium text-primary hover:bg-primary/15 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                        >
                                            {previewing ? <Loader2 size={12} className="animate-spin" /> : <Film size={12} />}
                                            {previewing ? t("generatingPreview") : t("preview")}
                                        </button>

                                        {/* 应用覆盖 — only when preview exists */}
                                        {previewVideoUrl && onApplyDub && (
                                            <button
                                                type="button"
                                                onClick={handleApply}
                                                disabled={applying}
                                                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-md border border-status-completed-border bg-status-completed-bg text-[0.75rem] font-medium text-status-completed-fg hover:bg-status-completed-bg/60 hover:border-status-completed-border transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                            >
                                                {applying ? <Loader2 size={12} className="animate-spin" /> : <Film size={12} />}
                                                {t("applyOverride")}
                                            </button>
                                        )}

                                        {/* 撤销覆盖 — only when dubbed exists and no preview */}
                                        {dubbedVideoUrl && !previewVideoUrl && onRevertDub && (
                                            <button
                                                type="button"
                                                onClick={handleRevert}
                                                disabled={reverting}
                                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-accent/30 bg-accent/5 text-[0.75rem] text-accent hover:bg-accent/10 hover:border-accent/50 transition-colors disabled:opacity-40"
                                            >
                                                {reverting ? <Loader2 size={12} className="animate-spin" /> : <Undo2 size={12} />}
                                                {t("undoOverride")}
                                            </button>
                                        )}
                                    </div>

                                    {previewVideoUrl && (
                                        <p className="text-[0.625rem] text-text-muted">
                                            {t("previewHintBody")}
                                        </p>
                                    )}
                                </section>
                            )}

                            {/* Error display */}
                            {(audioError || error) && (
                                <div className="flex items-center gap-2 px-3 py-2 rounded-md border border-status-failed-border bg-status-failed-bg text-[0.6875rem] text-status-failed-fg">
                                    <AlertCircle size={12} className="shrink-0 text-status-failed-fg" />
                                    <span className="break-words flex-1">{audioError || error}</span>
                                    {error && (
                                        <button type="button" onClick={() => setError(null)} className="shrink-0 text-status-failed-fg/60 hover:text-status-failed-fg">×</button>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Footer */}
                        <div className="px-5 py-3 border-t border-glass-border/50 bg-surface-inset shrink-0">
                            <button
                                type="button"
                                onClick={onClose}
                                className="px-3 py-1.5 rounded-md text-[0.75rem] text-text-muted hover:text-text-secondary transition-colors"
                            >
                                {t("close")}
                            </button>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
