"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { create } from "zustand";
import { Label, Slider } from "@heroui/react";
import { Button, Dialog, IconButton, LoadingState, StatusBadge, TextAreaField, TextField } from "@omnistudio/ui";
import { Play, Pause, Mic, Film, Undo2, Crosshair, ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { getAssetUrl } from "@/lib/utils";
import { useAuthStore } from "@/store/authStore";

interface DialogueAudioRowProps {
    scriptId: string;
    frameId: string;
    dialogue?: string | null;
    draftDialogue?: string;
    voiceId?: string;
    audioUrl?: string;
    audioError?: string | null;
    generationStatus?: string;
    generationId?: string;
    refreshFailed?: boolean;
    refreshing?: boolean;
    onRefresh?: () => void;
    snapshotDialogue?: string;
    snapshotVoiceId?: string;
    snapshotInstructions?: string | null;
    onAudioUpdated?: (result: any) => void | Promise<void>;
    onUpdateDialogue?: (text: string) => void | Promise<void>;
    onDraftChange?: (text: string) => void;
    videoUrl?: string;
    videoTaskId?: string;
    previewVideoUrl?: string;
    dubbedVideoUrl?: string;
    dubOffsetMs?: number;
    onPreviewDub?: (videoTaskId: string, offsetMs: number) => Promise<void>;
    onApplyDub?: () => Promise<void>;
    onRevertDub?: () => Promise<void>;
}

const EMOTIONS = ["neutral", "happy", "sad", "angry", "surprised", "calm", "gentle", "serious"];
type Operation = "generate" | "save" | "preview" | "apply" | "revert";
// Live operations outlive their dialog; persisted audio state is read by the workbench.
export const useDialogueAudioRequests = create<Partial<Record<string, { operation?: Operation; error?: string; recovering?: boolean; previousGenerationId?: string; instructions?: string }>>>(() => ({}));

export default function DialogueAudioRow(props: DialogueAudioRowProps) {
    const userId = useAuthStore(state => state.user?.id);
    const workspaceId = useAuthStore(state => state.activeWorkspace?.id);
    const scope = JSON.stringify([userId, workspaceId, props.scriptId, props.frameId]);
    return <DialogueWorkbench key={scope} {...props} scope={scope} />;
}

function DialogueWorkbench({ scriptId, frameId, dialogue: savedDialogue, draftDialogue, voiceId, audioUrl, audioError, generationStatus, generationId, refreshFailed, refreshing, onRefresh,
    snapshotDialogue, snapshotVoiceId, snapshotInstructions: savedInstructions, onAudioUpdated, onUpdateDialogue, onDraftChange,
    videoUrl, videoTaskId, previewVideoUrl, dubbedVideoUrl, dubOffsetMs = 0, onPreviewDub, onApplyDub, onRevertDub, scope,
}: DialogueAudioRowProps & { scope: string }) {
    const t = useTranslations("dialogueAudio");
    const dialogue = savedDialogue ?? "";
    const snapshotInstructions = savedInstructions ?? "";
    const [open, setOpen] = useState(false);
    const [draft, setDraft] = useState(draftDialogue ?? dialogue);
    const previousDialogue = useRef(dialogue);
    const request = useDialogueAudioRequests(state => state[scope]);
    const parsedInstructions = useMemo(() => {
        const value = request?.instructions ?? snapshotInstructions;
        const [first, ...rest] = value.split(";");
        return EMOTIONS.includes(first.trim()) ? [first.trim(), rest.join(";").trim()] : ["", value];
    }, [request?.instructions, snapshotInstructions]);
    const [emotion, setEmotion] = useState(parsedInstructions[0]);
    const [freeText, setFreeText] = useState(parsedInstructions[1]);
    const [offset, setOffset] = useState(dubOffsetMs);
    const [duration, setDuration] = useState(0);
    const [videoLoading, setVideoLoading] = useState(true);
    const [videoError, setVideoError] = useState(false);
    const [playing, setPlaying] = useState(false);
    const [starting, setStarting] = useState(false);
    const [playError, setPlayError] = useState(false);
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const playRequest = useRef(0);
    const busy = !!request?.operation || !!request?.recovering || generationStatus === "processing";
    const generating = request?.operation === "generate" || request?.recovering || generationStatus === "processing";
    const instructions = [emotion, freeText.trim()].filter(Boolean).join("; ");
    const dirty = draft !== dialogue;
    const stale = !!audioUrl && (snapshotDialogue !== draft || snapshotVoiceId !== voiceId || snapshotInstructions !== instructions);
    const error = request?.error || audioError;
    const displayVideo = previewVideoUrl || dubbedVideoUrl || videoUrl;
    const canDub = !!(audioUrl && videoUrl && videoTaskId && onPreviewDub);
    const previewChanged = offset !== dubOffsetMs || stale;
    const status = generating ? "generating" : error ? "error" : stale ? "stale" : audioUrl ? "ready" : "empty";
    const changeInstructions = (nextEmotion: string, nextText: string) => {
        setEmotion(nextEmotion); setFreeText(nextText);
        useDialogueAudioRequests.setState(state => ({ [scope]: { ...state[scope], instructions: [nextEmotion, nextText.trim()].filter(Boolean).join("; ") } }));
    };

    useEffect(() => {
        const previous = previousDialogue.current;
        setDraft(current => current === previous ? dialogue : current);
        previousDialogue.current = dialogue;
    }, [dialogue]);
    useEffect(() => { if (!open) { setEmotion(parsedInstructions[0]); setFreeText(parsedInstructions[1]); setOffset(dubOffsetMs); } }, [open, parsedInstructions, dubOffsetMs]);
    useEffect(() => { setDuration(0); setVideoLoading(true); setVideoError(false); }, [displayVideo]);

    const bindAudio = useCallback((node: HTMLAudioElement | null) => {
        if (audioRef.current && audioRef.current !== node) { playRequest.current++; audioRef.current.pause(); }
        audioRef.current = node;
    }, []);
    const bindVideo = useCallback((node: HTMLVideoElement | null) => {
        if (videoRef.current && videoRef.current !== node) videoRef.current.pause();
        videoRef.current = node;
    }, []);
    const stopPlayback = useCallback(() => {
        playRequest.current++;
        audioRef.current?.pause(); videoRef.current?.pause();
        setPlaying(false); setStarting(false);
    }, []);
    useEffect(() => { stopPlayback(); setPlayError(false); }, [audioUrl, open, stopPlayback]);

    async function run(operation: Operation, action: () => Promise<void>) {
        if (useDialogueAudioRequests.getState()[scope]?.operation || busy) return;
        useDialogueAudioRequests.setState({ [scope]: { operation, previousGenerationId: generationId, instructions } });
        try {
            await action();
            useDialogueAudioRequests.setState(state => {
                const next = { ...state };
                if (operation === "generate" || instructions === snapshotInstructions) delete next[scope];
                else next[scope] = { instructions };
                return next;
            }, true);
        } catch (failure: any) {
            const recovering = operation === "generate" && ((!failure?.response && (failure?.isAxiosError || failure?.code)) || failure?.response?.status === 409 || failure?.response?.status >= 500);
            useDialogueAudioRequests.setState({ [scope]: { instructions, recovering: !!recovering, previousGenerationId: generationId, error: String(failure?.response?.data?.detail || failure?.message || t("generateFailed")) } });
        }
    }
    async function saveDialogue() {
        await onUpdateDialogue?.(draft);
    }
    async function close() {
        if (request?.operation) return;
        if (dirty && !busy) await run("save", async () => { await saveDialogue(); stopPlayback(); setOpen(false); });
        else { stopPlayback(); setOpen(false); }
    }
    async function generate() {
        if (!voiceId || !draft.trim()) return;
        stopPlayback();
        await run("generate", async () => {
            await saveDialogue();
            const auth = useAuthStore.getState();
            if (JSON.stringify([auth.user?.id, auth.activeWorkspace?.id, scriptId, frameId]) !== scope) return;
            const result = await api.generateLineAudio(scriptId, frameId, 1, 1, 50, instructions);
            const frame = result?.frames?.find((frame: { id: string }) => frame.id === frameId);
            if (frame?.audio_error || !frame?.audio_url) throw new Error(frame?.audio_error || t("generateFailed"));
            await onAudioUpdated?.(result);
        });
    }
    async function toggleAudio() {
        if (playing || starting) { stopPlayback(); return; }
        const audio = audioRef.current;
        if (!audio) return;
        if (audio.error) audio.load();
        const id = ++playRequest.current;
        setStarting(true); setPlayError(false);
        try { await audio.play(); if (id === playRequest.current) setPlaying(true); }
        catch { if (id === playRequest.current) setPlayError(true); }
        finally { if (id === playRequest.current) setStarting(false); }
    }
    const setPosition = (value: number) => setOffset(Math.max(0, Math.min(duration, Number.isFinite(value) ? Math.round(value) : 0)));

    return <>
        <Button variant="quiet" className="h-auto w-full whitespace-normal rounded-lg border border-glass-border px-3 py-3 text-left" onPress={() => setOpen(true)}>
            <div className="w-full min-w-0 space-y-2">
                <div className="flex flex-wrap items-center gap-2"><Mic size={16} aria-hidden="true" /><span>{t("title")}</span>
                    <StatusBadge tone={status === "error" ? "danger" : status === "stale" ? "warning" : status === "ready" ? "success" : "neutral"}>{t(`state.${status}`)}</StatusBadge>
                    {dubbedVideoUrl && <StatusBadge tone="success">{t("overridden")}</StatusBadge>}
                    <span className="ml-auto text-xs text-text-secondary">{canDub ? t("openWorkbench") : t("openVoiceGen")}</span>
                </div>
                {draft.trim() && <p className="truncate text-sm text-text-secondary">{draft}</p>}
            </div>
        </Button>
        <Dialog isOpen={open} onOpenChange={value => { if (!value) void close(); }} title={t("workbenchTitle")} closeLabel={t("close")}
            isDismissable={!request?.operation} className="max-w-xl" footer={<Button variant="secondary" isDisabled={!!request?.operation} onPress={() => { void close(); }}>{t("close")}</Button>}>
            <div className="space-y-5 text-sm">
                <p className="text-text-secondary">{t("workbenchSubtitle")}</p>
                <section className="space-y-3">
                    <TextAreaField label={t("stepDialogueText")} value={draft} onChange={value => { setDraft(value); onDraftChange?.(value); }} placeholder={t("dialoguePlaceholder")} rows={3} isDisabled={busy} isReadOnly={!onUpdateDialogue} />
                    {!voiceId && <p className="text-status-failed-fg">{t("needVoiceBindingHint")}</p>}
                    {dirty && <Button variant="quiet" isPending={request?.operation === "save"} isDisabled={busy && request?.operation !== "save"} onPress={() => { void run("save", saveDialogue); }}>{t("saveDialogue")}</Button>}
                </section>
                <section className="space-y-3 border-t border-glass-border pt-4">
                    <h3 className="font-medium">{t("stepEmotionGen")}</h3>
                    <div className="grid grid-cols-4 gap-2 sm:grid-cols-8" role="group" aria-label={t("stepEmotionGen")}>
                        {EMOTIONS.map(chip => <Button key={chip} className="min-w-0 px-2" variant={emotion === chip ? "secondary" : "quiet"} aria-pressed={emotion === chip} isDisabled={busy}
                            onPress={() => changeInstructions(emotion === chip ? "" : chip, freeText)}>{t(`emotion.${chip}`)}</Button>)}
                    </div>
                    <TextField label={t("deliveryInstructions")} value={freeText} onChange={value => changeInstructions(emotion, value.slice(0, 80))} placeholder={t("freeTextPlaceholder")} isDisabled={busy} />
                    <div className="flex flex-wrap gap-2">
                        <Button variant={previewVideoUrl ? "secondary" : "primary"} isPending={request?.operation === "generate"} isDisabled={!voiceId || !draft.trim() || (busy && request?.operation !== "generate")}
                            onPress={() => { void generate(); }}><Mic size={16} aria-hidden="true" />{audioUrl ? t("regenerate") : t("generate")}</Button>
                        {audioUrl && <Button variant="secondary" isDisabled={busy} isPending={starting} onPress={() => { void toggleAudio(); }}>
                            {playing ? <Pause size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}{playing ? t("pause") : t("previewTts")}
                        </Button>}
                    </div>
                    {audioUrl && <audio key={audioUrl} ref={bindAudio} src={getAssetUrl(audioUrl)} preload="metadata" onEnded={() => setPlaying(false)} onError={() => { setPlaying(false); setStarting(false); setPlayError(true); }} />}
                    {stale && <p className="text-status-queued-fg">{t("staleHint")}</p>}
                    {playError && <p role="alert" className="text-status-failed-fg">{t("playFailed")}</p>}
                </section>
                {canDub && <section className="space-y-3 border-t border-glass-border pt-4">
                    <h3 className="font-medium">{t("stepOverride")}</h3>
                    <div className="relative overflow-hidden rounded-xl border border-glass-border bg-black">
                        <video key={displayVideo} ref={bindVideo} src={getAssetUrl(displayVideo!)} controls preload="metadata" className="max-h-60 w-full"
                            onLoadedMetadata={event => { const value = event.currentTarget.duration * 1000; setDuration(Number.isFinite(value) ? Math.round(value) : 0); }}
                            onLoadedData={() => setVideoLoading(false)} onError={() => { setVideoLoading(false); setVideoError(true); }} />
                    </div>
                    {videoLoading && !videoError && <LoadingState inline label={t("loadingVideo")} />}
                    {videoError && <div className="space-y-2"><p role="alert" className="text-status-failed-fg">{t("playFailed")}</p>
                        <Button variant="secondary" onPress={() => { setVideoError(false); setVideoLoading(true); videoRef.current?.load(); }}>{t("reloadVideo")}</Button></div>}
                    {(previewVideoUrl || dubbedVideoUrl) && <StatusBadge tone={previewVideoUrl ? "info" : "success"}>{t(previewVideoUrl ? "previewVersion" : "dubbedVersion")}</StatusBadge>}
                    <Button variant="quiet" isDisabled={busy || !duration} onPress={() => { if (videoRef.current) setPosition(videoRef.current.currentTime * 1000); }}><Crosshair size={16} aria-hidden="true" />{t("markStartPoint")}</Button>
                    <p className="text-xs text-text-secondary">{t("markStartHint")}</p>
                    <div className="flex items-end gap-2">
                        <IconButton variant="secondary" aria-label={t("earlier")} isDisabled={busy || !duration} onPress={() => setPosition(offset - 50)}><ChevronLeft size={16} /></IconButton>
                        <TextField label={`${t("audioPosition")} (ms)`} value={String(offset)} onChange={value => setPosition(Number(value))} inputMode="numeric" isDisabled={busy || !duration} className="min-w-0 flex-1" />
                        <IconButton variant="secondary" aria-label={t("later")} isDisabled={busy || !duration} onPress={() => setPosition(offset + 50)}><ChevronRight size={16} /></IconButton>
                    </div>
                    <Slider value={offset} minValue={0} maxValue={duration || 1} step={50} onChange={value => setPosition(typeof value === "number" ? value : value[0])} isDisabled={busy || !duration}>
                        <Label>{t("audioPosition")}</Label><Slider.Track><Slider.Fill /><Slider.Thumb /></Slider.Track>
                    </Slider>
                    <div className="flex flex-wrap gap-2">
                        <Button variant="secondary" isPending={request?.operation === "preview"} isDisabled={stale || (busy && request?.operation !== "preview")}
                            onPress={() => { void run("preview", async () => { stopPlayback(); await onPreviewDub!(videoTaskId!, offset); }); }}><Film size={16} aria-hidden="true" />{t("preview")}</Button>
                        {previewVideoUrl && onApplyDub && <Button variant="primary" isPending={request?.operation === "apply"} isDisabled={previewChanged || (busy && request?.operation !== "apply")}
                            onPress={() => { void run("apply", onApplyDub); }}>{t("applyOverride")}</Button>}
                        {dubbedVideoUrl && !previewVideoUrl && onRevertDub && <Button variant="secondary" isPending={request?.operation === "revert"} isDisabled={busy && request?.operation !== "revert"}
                            onPress={() => { void run("revert", onRevertDub); }}><Undo2 size={16} aria-hidden="true" />{t("undoOverride")}</Button>}
                    </div>
                    {previewVideoUrl && <p className="text-xs text-text-secondary">{t(previewChanged ? "previewChanged" : "previewHintBody")}</p>}
                </section>}
                {busy && <LoadingState inline label={t(request?.recovering ? "checking" : generating ? "state.generating" : request?.operation === "preview" ? "generatingPreview" : "saving")} />}
                {generating && refreshFailed && <div className="space-y-2"><p role="alert" className="text-status-failed-fg">{t("statusUnavailable")}</p>
                    <Button variant="secondary" isPending={refreshing} onPress={onRefresh}>{t("refreshStatus")}</Button></div>}
                {error && <p role="alert" className="break-words text-status-failed-fg">{error}</p>}
            </div>
        </Dialog>
    </>;
}
