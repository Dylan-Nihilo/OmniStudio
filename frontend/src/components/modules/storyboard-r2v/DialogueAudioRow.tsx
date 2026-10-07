"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { create } from "zustand";
import { Label, Slider } from "@heroui/react";
import { Button, Dialog, IconButton, LoadingState, StatusBadge, TextAreaField, TextField } from "@omnistudio/ui";
import { Play, Pause, Mic, Film, Undo2, Crosshair, ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { getAssetUrl } from "@/lib/utils";
import type { DialogueLine } from "@/store/projectStore";
import { useAuthStore } from "@/store/authStore";

interface DialogueAudioRowProps {
    scriptId: string;
    frameId: string;
    dialogue?: string | null;
    dialogueLines?: DialogueLine[];
    /** The voice a speaker will be read in, resolved live from the characters. */
    resolveSpeakerVoice?: (speaker: string) => { id: string; name: string; carriesDirection?: boolean } | undefined;
    /** Segment length, so the position control works before the video reports its own. */
    frameDurationSeconds?: number | null;
    inPointSeconds?: number | null;
    outPointSeconds?: number | null;
    onUpdateDialogueLines?: (lines: DialogueLine[]) => void | Promise<void>;
    actionDescription?: string | null;
    draftDialogue?: string;
    voiceId?: string;
    voiceSpeed?: number;
    voicePitch?: number;
    voiceVolume?: number;
    audioUrl?: string;
    sfxUrl?: string | null;
    previewSfxUrl?: string | null;
    sfxFingerprint?: string | null;
    previewSfxFingerprint?: string | null;
    audioError?: string | null;
    generationStatus?: string;
    batchPending?: boolean;
    generationId?: string;
    refreshFailed?: boolean;
    refreshing?: boolean;
    onRefresh?: () => void;
    snapshotDialogue?: string;
    snapshotVoiceId?: string;
    snapshotInstructions?: string | null;
    snapshotSpeed?: number;
    snapshotPitch?: number;
    snapshotVolume?: number;
    onAudioUpdated?: (result: any) => void | Promise<void>;
    onUpdateDialogue?: (text: string) => void | Promise<void>;
    onDraftChange?: (text: string) => void;
    videoUrl?: string;
    videoTaskId?: string;
    previewVideoUrl?: string;
    previewPolicyStale?: boolean;
    previewAudioUrl?: string;
    previewVideoTaskId?: string;
    previewSourceVideoUrl?: string;
    previewOffsetMs?: number | null;
    dubGenerationStatus?: string;
    dubGenerationId?: string;
    dubError?: string | null;
    dubbedVideoUrl?: string;
    dubbedVideoTaskId?: string;
    dubbedAudioUrl?: string;
    dubOffsetMs?: number;
    allowLipSync?: boolean;
    speakerName?: string;
    speakerFaceUrl?: string | null;
    onUploadSpeakerFace?: (file: File) => Promise<void>;
    onPreviewDub?: (videoTaskId: string, offsetMs: number, lipSync?: boolean) => Promise<void>;
    onApplyDub?: () => Promise<void>;
    onRevertDub?: () => Promise<void>;
    onPreviewSfx?: () => Promise<void>;
    onApplySfx?: () => Promise<void>;
    onRevertSfx?: () => Promise<void>;
}

const EMOTIONS = ["neutral", "happy", "sad", "angry", "surprised", "calm", "gentle", "serious"];
function mediaIdentity(value?: string) {
    if (!value) return value;
    try {
        const url = new URL(value);
        // OSS display signatures expire; other query parameters can identify a media version.
        if (url.searchParams.has("OSSAccessKeyId") && url.searchParams.has("Signature")) {
            for (const key of ["OSSAccessKeyId", "Signature", "Expires", "security-token"]) url.searchParams.delete(key);
        }
        return url.href;
    } catch { return value; }
}
type Operation = "batch" | "generate" | "save" | "preview" | "apply" | "revert";
// Live operations outlive their dialog; persisted audio state is read by the workbench.
export const useDialogueAudioRequests = create<Partial<Record<string, { operation?: Operation; error?: string; recovering?: boolean; recoveryKind?: "audio" | "dub" | "sfx"; previousGenerationId?: string; instructions?: string }>>>(() => ({}));

export default function DialogueAudioRow(props: DialogueAudioRowProps) {
    const userId = useAuthStore(state => state.user?.id);
    const workspaceId = useAuthStore(state => state.activeWorkspace?.id);
    const scope = JSON.stringify([userId, workspaceId, props.scriptId, props.frameId]);
    return <DialogueWorkbench key={scope} {...props} scope={scope} />;
}

function DialogueWorkbench({ scriptId, frameId, dialogue: savedDialogue, dialogueLines, resolveSpeakerVoice, frameDurationSeconds, inPointSeconds, outPointSeconds, onUpdateDialogueLines, draftDialogue, actionDescription, voiceId, voiceSpeed = 1, voicePitch = 1, voiceVolume = 50, audioUrl, sfxUrl, previewSfxUrl, sfxFingerprint, previewSfxFingerprint, audioError, generationStatus, batchPending, generationId, refreshFailed, refreshing, onRefresh,
    snapshotDialogue, snapshotVoiceId, snapshotInstructions: savedInstructions, snapshotSpeed = 1, snapshotPitch = 1, snapshotVolume = 50, onAudioUpdated, onUpdateDialogue, onDraftChange,
    videoUrl, videoTaskId, previewVideoUrl, previewPolicyStale, previewAudioUrl, previewVideoTaskId, previewSourceVideoUrl, previewOffsetMs, dubGenerationStatus, dubGenerationId, dubError,
    dubbedVideoUrl, dubbedVideoTaskId, dubbedAudioUrl, dubOffsetMs = 0, allowLipSync = false, speakerName, speakerFaceUrl, onUploadSpeakerFace, onPreviewDub, onApplyDub, onRevertDub, onPreviewSfx, onApplySfx, onRevertSfx, scope,
}: DialogueAudioRowProps & { scope: string }) {
    const t = useTranslations("dialogueAudio");
    const dialogue = savedDialogue ?? "";
    const snapshotInstructions = savedInstructions ?? "";
    const [open, setOpen] = useState(false);
    const [draft, setDraft] = useState(draftDialogue ?? dialogue);
    // Per-speaker lines are the source of truth when the frame has them; only the words
    // are editable here — the speaker and the offset come from the production plan.
    const perLine = (dialogueLines?.length ?? 0) > 0;
    // The voice a line will be spoken in *now*, resolved from the characters. Kept strictly
    // apart from `line.voice_id`, which records the voice its existing clip was made with:
    // reading the record for display made every speaker look unassigned until the first
    // generation, and comparing the record against itself could never notice a voice being
    // reassigned. A speaker who no longer matches any character keeps its recorded id so
    // the row still says something.
    const lineVoice = (line: DialogueLine) => resolveSpeakerVoice?.(line.speaker)
        ?? (line.voice_id ? { id: line.voice_id, name: line.voice_id } : undefined);
    const speakerCount = new Set((dialogueLines ?? []).map(line => line.speaker)).size;
    const [lineDrafts, setLineDrafts] = useState<string[]>(() => (dialogueLines ?? []).map(line => line.line));
    // Each line's own emotion and delivery, edited alongside its words. A segment is a
    // conversation, and one emotion spread over all of it reads as flat as one voice did.
    const [directionDrafts, setDirectionDrafts] = useState<string[]>(() => (dialogueLines ?? []).map(line => line.instructions ?? ""));
    const previousDialogue = useRef(dialogue);
    const request = useDialogueAudioRequests(state => state[scope]);
    const parsedInstructions = useMemo(() => {
        const value = request?.instructions ?? snapshotInstructions;
        const [first, ...rest] = value.split(";");
        return EMOTIONS.includes(first.trim()) ? [first.trim(), rest.join(";").trim()] : ["", value];
    }, [request?.instructions, snapshotInstructions]);
    const [emotion, setEmotion] = useState(parsedInstructions[0]);
    const [freeText, setFreeText] = useState(parsedInstructions[1]);
    const savedOffset = previewVideoUrl ? previewOffsetMs ?? 0 : dubOffsetMs;
    const [offset, setOffset] = useState(savedOffset);
    const [duration, setDuration] = useState(0);
    const [videoLoading, setVideoLoading] = useState(true);
    const [videoError, setVideoError] = useState(false);
    const [playing, setPlaying] = useState(false);
    const [starting, setStarting] = useState(false);
    const [playError, setPlayError] = useState(false);
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const faceInputRef = useRef<HTMLInputElement | null>(null);
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const playRequest = useRef(0);
    const previewing = request?.operation === "preview" || (request?.recovering && request.recoveryKind === "dub") || dubGenerationStatus === "processing" || dubGenerationStatus === "pending";
    const busy = !!batchPending || !!request?.operation || !!request?.recovering || generationStatus === "processing" || !!previewing;
    const generating = request?.operation === "generate" || request?.recovering || generationStatus === "processing" || previewing;
    const instructions = [emotion, freeText.trim()].filter(Boolean).join("; ");
    const linesDirty = perLine && (lineDrafts.some((text, index) => text !== dialogueLines?.[index]?.line)
        || directionDrafts.some((text, index) => text.trim() !== (dialogueLines?.[index]?.instructions ?? "")));
    // What a line will actually be read with: its own direction, or the segment's when it
    // has none. Compared against what its existing clip was read with, so rewriting either
    // one shows as out of date instead of silently keeping the old reading.
    const lineDirection = (line: DialogueLine) => line.instructions?.trim() || instructions || "";
    const dirty = perLine ? linesDirty : draft !== dialogue;
    // A per-speaker frame has no single voice to compare, so the frame-level snapshot check
    // said "stale" for ever and left 预听 / 匹配口型 permanently disabled. What actually
    // dates that track is a line with no clip (never made, or its words were edited) or a
    // line whose voice has since been reassigned.
    const stale = perLine
        ? !!audioUrl && ((dialogueLines ?? []).some(line => !line.audio_url || lineVoice(line)?.id !== line.voice_id
            || line.scheduled_start_seconds == null
            // Per-line direction counts only once the clip has recorded what it was read
            // with. A clip made before that was tracked says nothing about its direction,
            // and calling it stale on that basis would strand every existing episode whose
            // voice cannot be directed — permanently out of date with regeneration refused.
            || (line.instructions_used != null && lineDirection(line) !== line.instructions_used))
            || snapshotInstructions !== instructions)
        : !!audioUrl && (snapshotDialogue !== draft || snapshotVoiceId !== voiceId || snapshotInstructions !== instructions || snapshotSpeed !== voiceSpeed || snapshotPitch !== voicePitch || snapshotVolume !== voiceVolume);
    // The offset controls only knew the length the video element reported, so they sat at 0
    // and disabled until its metadata arrived — or for ever, if it never did. The segment's
    // own length is known all along.
    const displayedOffset = previewVideoTaskId === videoTaskId && previewVideoUrl ? previewOffsetMs ?? 0
        : dubbedVideoTaskId === videoTaskId && dubbedVideoUrl ? dubOffsetMs : 0;
    const timelineMs = duration ? Math.max(0, duration - Math.max(0, -displayedOffset)) : Math.round((frameDurationSeconds ?? 0) * 1000);
    const speechEnd = perLine ? Math.max(0, ...(dialogueLines ?? []).map(line =>
        (line.scheduled_start_seconds ?? line.start_seconds ?? 0) + (line.duration ?? 0))) : 0;
    const trimStartMs = Math.round((inPointSeconds ?? 0) * 1000);
    const clipEndMs = outPointSeconds != null ? outPointSeconds * 1000
        : frameDurationSeconds ? trimStartMs + frameDurationSeconds * 1000 : Infinity;
    const requiredMs = Math.round(speechEnd * 1000) + Math.max(0, offset) - trimStartMs;
    // Negative offsets delay the video, as in the backend preview renderer.
    const availableMs = Math.max(0, Math.min(timelineMs + Math.max(0, -offset), clipEndMs) - trimStartMs);
    const audioTooLong = !stale && timelineMs > 0 && requiredMs > availableMs + 50;
    // One track, one face: lip-sync cannot be aimed at a segment where several people
    // speak. Said plainly rather than asking for a face that could only be right for one.
    const lipSyncBlocked = perLine && speakerCount > 1;
    const sfxBusy = request?.operation === "apply" || request?.operation === "revert" || (request?.operation === "preview" && request?.recoveryKind === "sfx");
    const hasSfxContext = !!actionDescription?.trim() || !!videoUrl;
    const error = request?.error || dubError || audioError;
    const appliedDubStale = !!dubbedVideoUrl && !!dubbedAudioUrl && mediaIdentity(dubbedAudioUrl) !== mediaIdentity(audioUrl);
    const currentDubbedVideoUrl = appliedDubStale ? undefined : dubbedVideoUrl;
    const displayVideo = (previewVideoTaskId === videoTaskId && previewVideoUrl) || (dubbedVideoTaskId === videoTaskId && currentDubbedVideoUrl) || videoUrl;
    const canDub = !!(audioUrl && videoUrl && videoTaskId && onPreviewDub);
    const previewChanged = !!previewPolicyStale || offset !== previewOffsetMs || stale || mediaIdentity(previewAudioUrl) !== mediaIdentity(audioUrl) || previewVideoTaskId !== videoTaskId || mediaIdentity(previewSourceVideoUrl) !== mediaIdentity(videoUrl);
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
    useEffect(() => { if (!open) { setEmotion(parsedInstructions[0]); setFreeText(parsedInstructions[1]); setOffset(savedOffset); } }, [open, parsedInstructions, savedOffset]);
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

    async function run(operation: Operation, action: () => Promise<void>, requestedRecoveryKind?: "audio" | "dub" | "sfx") {
        if (useDialogueAudioRequests.getState()[scope]?.operation || busy) return;
        stopPlayback();
        const previousGenerationId = operation === "preview" ? dubGenerationId : generationId;
        const recoveryKind = requestedRecoveryKind ?? (operation === "preview" ? "dub" : "audio");
        useDialogueAudioRequests.setState({ [scope]: { operation, recoveryKind, previousGenerationId, instructions } });
        try {
            await action();
            useDialogueAudioRequests.setState(state => {
                const next = { ...state };
                if (operation === "generate" || instructions === snapshotInstructions) delete next[scope];
                else next[scope] = { instructions };
                return next;
            }, true);
        } catch (failure: any) {
            const recovering = (operation === "generate" || operation === "preview") && ((!failure?.response && (failure?.isAxiosError || failure?.code)) || failure?.response?.status === 409 || failure?.response?.status >= 500);
            useDialogueAudioRequests.setState({ [scope]: { instructions, recovering: !!recovering, recoveryKind, previousGenerationId, error: String(failure?.response?.data?.detail || failure?.message || t("generateFailed")) } });
        }
    }
    async function saveDialogue() {
        if (perLine) {
            await onUpdateDialogueLines?.((dialogueLines ?? []).map((line, index) => ({
                ...line,
                line: lineDrafts[index] ?? line.line,
                // Cleared back to null rather than "", so the line falls through to the
                // segment's direction instead of overriding it with blankness.
                instructions: directionDrafts[index]?.trim() || null,
            })));
            return;
        }
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
            const result = await api.generateLineAudio(scriptId, frameId, voiceSpeed, voicePitch, voiceVolume, instructions);
            const frame = result?.frames?.find((frame: { id: string }) => frame.id === frameId);
            if (frame?.audio_error || !frame?.audio_url) throw new Error(frame?.audio_error || t("generateFailed"));
            await onAudioUpdated?.(result);
        });
    }
    async function previewSfx() {
        if (!onPreviewSfx || !hasSfxContext) return;
        await run("preview", onPreviewSfx, "sfx");
    }
    async function applySfx() {
        if (!onApplySfx || !previewSfxUrl) return;
        await run("apply", onApplySfx);
    }
    async function revertSfx() {
        if (!onRevertSfx || !previewSfxUrl) return;
        await run("revert", onRevertSfx);
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
    const setPosition = (value: number) => setOffset(Math.max(-10000, Math.min(10000, Number.isFinite(value) ? Math.round(value) : 0)));

    return <>
        <Button variant="quiet" className="h-auto w-full whitespace-normal rounded-lg border border-glass-border px-3 py-3 text-left" onPress={() => setOpen(true)}>
            <div className="w-full min-w-0 space-y-2">
                <div className="flex flex-wrap items-center gap-2"><Mic size={16} aria-hidden="true" /><span>{t("title")}</span>
                    <StatusBadge tone={status === "error" ? "danger" : status === "stale" ? "warning" : status === "ready" ? "success" : "neutral"}>{t(`state.${status}`)}</StatusBadge>
                    {currentDubbedVideoUrl && <StatusBadge tone="success">{t("overridden")}</StatusBadge>}
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
                    {perLine ? <>
                        <h3 className="font-medium">{t("linesTitle")}</h3>
                        {(dialogueLines ?? []).map((line, index) => (
                            <div key={`${index}:${line.speaker}`} className="rounded-lg border border-glass-border p-3 space-y-1.5">
                                {/* The speaker is the field's own label, so it is not also
                                    printed above it — one name per row, and the accessible
                                    name of the box is the person saying the line. */}
                                <TextAreaField label={line.speaker} value={lineDrafts[index] ?? line.line} rows={2}
                                    isDisabled={busy} isReadOnly={!onUpdateDialogueLines}
                                    onChange={value => setLineDrafts(current => current.map((text, i) => i === index ? value : text))} />
                                <TextField label={t("lineDirection")} value={directionDrafts[index] ?? ""}
                                    placeholder={instructions || t("lineDirectionPlaceholder")}
                                    isDisabled={busy} isReadOnly={!onUpdateDialogueLines}
                                    onChange={value => setDirectionDrafts(current => current.map((text, i) => i === index ? value.slice(0, 200) : text))} />
                                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-chrome-sm text-text-secondary">
                                    <span>{line.scheduled_start_seconds != null && line.duration != null
                                        ? t("lineTiming", { start: line.scheduled_start_seconds.toFixed(1), end: (line.scheduled_start_seconds + line.duration).toFixed(1) })
                                        : t("lineAt", { seconds: (line.start_seconds ?? 0).toFixed(1) })}</span>
                                    {line.scheduled_start_seconds != null && line.scheduled_start_seconds > (line.start_seconds ?? 0) + 0.05 &&
                                        <span>{t("lineShifted", { seconds: (line.scheduled_start_seconds - (line.start_seconds ?? 0)).toFixed(1) })}</span>}
                                    {lineVoice(line)
                                        ? <span>{t("lineVoice", { voice: lineVoice(line)!.name })}</span>
                                        : <span className="text-status-failed-fg">{t("lineNoVoice")}</span>}
                                </div>
                                {/* The direction is written but this voice has no way to act
                                    on it, so say so here — the fix is the character's voice,
                                    not anything on this line. */}
                                {lineVoice(line)?.carriesDirection === false && !!lineDirection(line) &&
                                    <p role="alert" className="text-chrome-sm text-status-failed-fg">
                                        {t("lineVoiceIgnoresDirection", { speaker: line.speaker })}
                                    </p>}
                                {line.overruns_shot && <p role="alert" className="text-chrome-sm text-status-processing-fg">{t("lineOverruns")}</p>}
                            </div>
                        ))}
                        {dirty && <Button variant="quiet" isPending={request?.operation === "save"} isDisabled={busy && request?.operation !== "save"} onPress={() => { void run("save", saveDialogue); }}>{t("saveLines")}</Button>}
                    </> : <>
                        <TextAreaField label={t("stepDialogueText")} value={draft} onChange={value => { setDraft(value); onDraftChange?.(value); }} placeholder={t("dialoguePlaceholder")} rows={3} isDisabled={busy} isReadOnly={!onUpdateDialogue} />
                        {!voiceId && <p className="text-status-failed-fg">{t("needVoiceBindingHint")}</p>}
                        {dirty && <Button variant="quiet" isPending={request?.operation === "save"} isDisabled={busy && request?.operation !== "save"} onPress={() => { void run("save", saveDialogue); }}>{t("saveDialogue")}</Button>}
                    </>}
                </section>
                <section className="space-y-3 border-t border-glass-border pt-4">
                    <h3 className="font-medium">{t("stepEmotionGen")}</h3>
                    {speakerCount > 1 && <p className="text-xs text-text-secondary">{t("emotionAppliesToAll", { count: speakerCount })}</p>}
                    <div className="grid grid-cols-4 gap-2 sm:grid-cols-8" role="group" aria-label={t("stepEmotionGen")}>
                        {EMOTIONS.map(chip => <Button key={chip} className="min-w-0 px-2" variant={emotion === chip ? "secondary" : "quiet"} aria-pressed={emotion === chip} isDisabled={busy}
                            onPress={() => changeInstructions(emotion === chip ? "" : chip, freeText)}>{t(`emotion.${chip}`)}</Button>)}
                    </div>
                    <TextField label={t("deliveryInstructions")} value={freeText} onChange={value => changeInstructions(emotion, value.slice(0, 80))} placeholder={t("freeTextPlaceholder")} isDisabled={busy} />
                    <div className="flex flex-wrap gap-2">
                        <Button variant={previewVideoUrl ? "secondary" : "primary"} isPending={request?.operation === "generate"}
                            isDisabled={(perLine ? (dialogueLines ?? []).some(line => !lineVoice(line)
                                // Refused by the server too; blocked here so the direction
                                // is not paid for and then discarded.
                                || (lineVoice(line)?.carriesDirection === false && !!lineDirection(line))) : !voiceId)
                                || !draft.trim() || (busy && request?.operation !== "generate")}
                            onPress={() => { void generate(); }}><Mic size={16} aria-hidden="true" />{audioUrl ? t("regenerate") : t("generate")}</Button>
                        {audioUrl && <Button variant="secondary" isDisabled={busy} isPending={starting} onPress={() => { void toggleAudio(); }}>
                            {playing ? <Pause size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}{playing ? t("pause") : t("previewTts")}
                        </Button>}
                    </div>
                    {audioUrl && <audio key={audioUrl} ref={bindAudio} src={getAssetUrl(audioUrl)} preload="metadata" onEnded={() => setPlaying(false)} onError={() => { setPlaying(false); setStarting(false); setPlayError(true); }} />}
                    {stale && <p className="text-status-queued-fg">{t("staleHint")}</p>}
                    {playError && <p role="alert" className="text-status-failed-fg">{t("playFailed")}</p>}
                </section>
                {hasSfxContext && onPreviewSfx && <section className="space-y-3 border-t border-glass-border pt-4">
                    <div className="flex items-center gap-2"><h3 className="font-medium">{t("stepSfx")}</h3>
                        {sfxUrl && <StatusBadge tone="success">{t("sfxApplied")}</StatusBadge>}
                        {previewSfxUrl && <StatusBadge tone="info">{t("sfxPreview")}</StatusBadge>}
                    </div>
                    {actionDescription && <p className="text-xs text-text-secondary">{actionDescription}</p>}
                    {previewSfxUrl && <audio key={previewSfxUrl} controls preload="metadata" src={getAssetUrl(previewSfxUrl)} className="w-full" />}
                    <div className="flex flex-wrap gap-2">
                        <Button variant="secondary" isPending={request?.operation === "preview" && request?.recoveryKind === "sfx"} isDisabled={busy && !sfxBusy} onPress={() => { void previewSfx(); }}>
                            <Film size={16} aria-hidden="true" />{previewSfxUrl ? t("regenerateSfx") : t("previewSfx")}
                        </Button>
                        {previewSfxUrl && onApplySfx && <Button variant="primary" isPending={request?.operation === "apply"} isDisabled={busy && request?.operation !== "apply"} onPress={() => { void applySfx(); }}>{t("applySfx")}</Button>}
                        {previewSfxUrl && onRevertSfx && <Button variant="quiet" isPending={request?.operation === "revert"} isDisabled={busy && request?.operation !== "revert"} onPress={() => { void revertSfx(); }}><Undo2 size={16} aria-hidden="true" />{t("discardSfx")}</Button>}
                    </div>
                </section>}
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
                    {(previewVideoUrl || currentDubbedVideoUrl) && <StatusBadge tone={previewVideoUrl ? "info" : "success"}>{t(previewVideoUrl ? "previewVersion" : "dubbedVersion")}</StatusBadge>}
                    <Button variant="quiet" isDisabled={busy || !timelineMs} onPress={() => { if (videoRef.current) setPosition(videoRef.current.currentTime * 1000); }}><Crosshair size={16} aria-hidden="true" />{t("markStartPoint")}</Button>
                    <p className="text-xs text-text-secondary">{t("markStartHint")}</p>
                    <div className="flex items-end gap-2">
                        <IconButton variant="secondary" aria-label={t("earlier")} isDisabled={busy || !timelineMs} onPress={() => setPosition(offset - 50)}><ChevronLeft size={16} /></IconButton>
                        <TextField label={`${t("audioPosition")} (ms)`} value={String(offset)} onChange={value => setPosition(Number(value))} inputMode="numeric" isDisabled={busy || !timelineMs} className="min-w-0 flex-1" />
                        <IconButton variant="secondary" aria-label={t("later")} isDisabled={busy || !timelineMs} onPress={() => setPosition(offset + 50)}><ChevronRight size={16} /></IconButton>
                    </div>
                    <Slider value={offset} minValue={-10000} maxValue={10000} step={50} onChange={value => setPosition(typeof value === "number" ? value : value[0])} isDisabled={busy || !timelineMs}>
                        <Label>{t("audioPosition")}</Label><Slider.Track><Slider.Fill /><Slider.Thumb /></Slider.Track>
                    </Slider>
                    <div className="flex flex-wrap gap-2">
                        <Button variant="secondary" isPending={request?.operation === "preview"} isDisabled={stale || audioTooLong || (busy && request?.operation !== "preview")}
                            onPress={() => { void run("preview", async () => { stopPlayback(); await onPreviewDub!(videoTaskId!, offset); }); }}><Film size={16} aria-hidden="true" />{t("preview")}</Button>
                        {allowLipSync && !lipSyncBlocked && <Button variant="secondary" isDisabled={stale || audioTooLong || busy || !timelineMs}
                            onPress={() => { void run("preview", async () => { stopPlayback(); await onPreviewDub!(videoTaskId!, offset, true); }); }}>{t("matchLips")}</Button>}
                        {previewVideoUrl && onApplyDub && <Button variant="primary" isPending={request?.operation === "apply"} isDisabled={previewChanged || audioTooLong || (busy && request?.operation !== "apply")}
                            onPress={() => { void run("apply", onApplyDub); }}>{t("applyOverride")}</Button>}
                        {currentDubbedVideoUrl && !previewVideoUrl && onRevertDub && <Button variant="secondary" isPending={request?.operation === "revert"} isDisabled={busy && request?.operation !== "revert"}
                            onPress={() => { void run("revert", onRevertDub); }}><Undo2 size={16} aria-hidden="true" />{t("undoOverride")}</Button>}
                    </div>
                    {audioTooLong && <p role="alert" className="text-status-failed-fg">{t("audioTooLong", { required: (requiredMs / 1000).toFixed(1), available: (availableMs / 1000).toFixed(1) })}</p>}
                    {appliedDubStale && <p className="text-status-queued-fg">{t("dubStaleHint")}</p>}
                    {allowLipSync && !lipSyncBlocked && onUploadSpeakerFace && <div className="flex items-center gap-3">
                        {speakerFaceUrl && <img src={getAssetUrl(speakerFaceUrl)} alt={speakerName ?? ""} className="h-16 w-16 rounded-lg object-cover" />}
                        <Button variant="quiet" isDisabled={busy} onPress={() => faceInputRef.current?.click()}>{t(speakerFaceUrl ? "speakerFaceReplace" : "speakerFace", { name: speakerName ?? "" })}</Button>
                        <input ref={faceInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" aria-label={t("speakerFace", { name: speakerName ?? "" })}
                            onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
                                void run("save", async () => {
                                    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 10 * 1024 * 1024) throw new Error(t("speakerFaceInvalid"));
                                    await onUploadSpeakerFace(file);
                                });
                            }} />
                    </div>}
                    {allowLipSync && !lipSyncBlocked && <p className="text-xs text-text-secondary">{t("matchLipsHint")}</p>}
                    {lipSyncBlocked && <p className="text-xs text-text-secondary">{t("matchLipsMultiSpeaker", { count: speakerCount })}</p>}
                    {previewVideoUrl && <p className="text-xs text-text-secondary">{t(previewChanged ? "previewChanged" : "previewHintBody")}</p>}
                </section>}
                {busy && <LoadingState inline label={t(batchPending ? "batchRunning" : request?.recovering ? (request.recoveryKind === "dub" ? "checkingPreview" : "checking") : previewing ? "generatingPreview" : generating ? "state.generating" : "saving")} />}
                {generating && refreshFailed && <div className="space-y-2"><p role="alert" className="text-status-failed-fg">{t("statusUnavailable")}</p>
                    <Button variant="secondary" isPending={refreshing} onPress={onRefresh}>{t("refreshStatus")}</Button></div>}
                {error && <p role="alert" className="break-words text-status-failed-fg">{error}</p>}
            </div>
        </Dialog>
    </>;
}
