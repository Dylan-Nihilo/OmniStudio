"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Label, Slider } from "@heroui/react";
import { Button, Checkbox, Dialog, LoadingState, SelectField, StatusBadge } from "@omnistudio/ui";
import { Pause, Play, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import type { VideoTask } from "@/lib/api";
import styles from "./CompareModal.module.css";

interface CompareModalProps {
    tasks: VideoTask[];
    isOpen?: boolean;
    onClose: () => void;
    resolveUrl?: (url: string) => string;
}

type MediaStatus = "loading" | "seeking" | "ready" | "error";
const timeLabel = (seconds: number) => `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(1).padStart(4, "0")}`;

export default function CompareModal({ tasks, isOpen = true, onClose, resolveUrl }: CompareModalProps) {
    const t = useTranslations("storyboardR2V");
    const slots = tasks.slice(0, 4);
    const signature = slots.map(task => `${task.id}:${task.video_url}`).join("|");
    const videos = useRef<Array<HTMLVideoElement | null>>([]);
    const playRequest = useRef(0);
    const [playing, setPlaying] = useState(false);
    const [starting, setStarting] = useState(false);
    const [sync, setSync] = useState(true);
    const [soloId, setSoloId] = useState<string | null>(null);
    const [position, setPosition] = useState(0);
    const [durations, setDurations] = useState<Record<string, number>>({});
    const [status, setStatus] = useState<Record<string, MediaStatus>>({});
    const [playError, setPlayError] = useState(false);
    const duration = Math.max(0, ...slots.map(task => durations[task.id] || 0));
    const masterIndex = slots.findIndex(task => durations[task.id] === duration);
    const canSeek = slots.length > 0 && slots.every(task => durations[task.id] > 0 && (status[task.id] === "ready" || status[task.id] === "seeking"));
    const canPlay = slots.length > 0 && (sync ? slots.every(task => status[task.id] === "ready") : slots.some(task => status[task.id] === "ready"));

    // Stable ref callbacks avoid pausing videos on playback-progress renders.
    const refs = useMemo(() => slots.map((_, index) => (element: HTMLVideoElement | null) => {
        const previous = videos.current[index];
        if (previous && previous !== element) previous.pause();
        videos.current[index] = element;
    }), [signature]); // eslint-disable-line react-hooks/exhaustive-deps

    const pauseAll = useCallback(() => {
        playRequest.current += 1;
        videos.current.forEach(video => video?.pause());
        setPlaying(false);
        setStarting(false);
    }, []);

    useEffect(() => {
        pauseAll();
        if (isOpen) {
            setSync(true);
            setSoloId(null);
            setPosition(0);
            // Unchanged sources do not fire canplay again when another URL refreshes.
            const readyDurations: Record<string, number> = {};
            const readyStatus: Record<string, MediaStatus> = {};
            slots.forEach((task, index) => {
                const video = videos.current[index];
                if (video && video.readyState >= 3 && video.currentSrc === video.src && Number.isFinite(video.duration)) {
                    readyDurations[task.id] = video.duration;
                    readyStatus[task.id] = "ready";
                    if (video.currentTime !== 0) video.currentTime = 0;
                }
            });
            setDurations(readyDurations);
            setStatus(readyStatus);
            setPlayError(false);
        }
        return () => { playRequest.current += 1; };
    }, [isOpen, signature, pauseAll]);

    const seekTo = (seconds: number) => {
        pauseAll();
        const time = Math.min(Math.max(seconds, 0), duration);
        videos.current.forEach(video => {
            if (video && Number.isFinite(video.duration)) video.currentTime = Math.min(time, video.duration);
        });
        setPosition(time);
    };

    const togglePlay = async () => {
        if (playing || starting) { pauseAll(); return; }
        if (!canPlay) return;
        if (sync && position >= duration - 0.02) seekTo(0);
        const request = ++playRequest.current;
        setStarting(true);
        setPlayError(false);
        const results = await Promise.allSettled(videos.current.map((video, index) =>
            video && status[slots[index]?.id] === "ready" && (!sync || video.currentTime < video.duration)
                ? video.play() : Promise.resolve(),
        ));
        if (request !== playRequest.current) return;
        if (results.some(result => result.status === "rejected")) {
            pauseAll();
            setPlayError(true);
        } else { setStarting(false); setPlaying(true); }
    };

    // Native media clocks may drift; correct differences above 80ms while playing.
    useEffect(() => {
        if (!isOpen || !sync || !playing) return;
        let frame = 0;
        const tick = () => {
            const master = videos.current[masterIndex];
            if (master) {
                setPosition(master.currentTime);
                videos.current.forEach((video, index) => {
                    if (!video || index === masterIndex || !Number.isFinite(video.duration)) return;
                    const target = Math.min(master.currentTime, video.duration);
                    if (Math.abs(video.currentTime - target) > 0.08) video.currentTime = target;
                });
            }
            frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frame);
    }, [isOpen, sync, playing, masterIndex]);

    const cycleAudio = () => setSoloId(current => {
        const index = slots.findIndex(task => task.id === current);
        return slots[index + 1]?.id ?? null;
    });
    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.defaultPrevented || event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
        const target = event.target as HTMLElement;
        if (target.closest('button, input, textarea, select, [contenteditable="true"], [role="checkbox"], [role="slider"]') || (!sync && target.closest("video"))) return;
        if (event.key === " ") { event.preventDefault(); void togglePlay(); }
        else if (event.key.toLowerCase() === "s") { event.preventDefault(); cycleAudio(); }
    };
    const reload = (index: number) => {
        pauseAll();
        setPlayError(false);
        setStatus(previous => ({ ...previous, [slots[index].id]: "loading" }));
        videos.current[index]?.load();
    };

    return <Dialog isOpen={isOpen} onOpenChange={open => { if (!open) { pauseAll(); onClose(); } }} title={t("compareTitle", { count: slots.length })} closeLabel={t("close")} className={styles.dialog}
        footer={<div className={styles.footer}>
            {playError && <p role="alert" className={styles.error}>{t("comparePlayFailed")}</p>}
            <div className={styles.playback}>
                <Button variant="secondary" isDisabled={!canPlay && !playing && !starting} isPending={starting} onPress={() => { void togglePlay(); }}>
                    {!starting && (playing ? <Pause size={16} /> : <Play size={16} />)}{t(starting ? "compareStarting" : playing ? "comparePause" : "comparePlay")}
                </Button>
                {sync ? <Slider aria-label={t("comparePosition")} value={position} minValue={0} maxValue={duration || 1} step={0.1} isDisabled={!canSeek} onChange={value => seekTo(typeof value === "number" ? value : value[0])} className={styles.slider}>
                    <div className={styles.time}><Label>{t("comparePosition")}</Label><span>{timeLabel(position)} / {timeLabel(duration)}</span></div>
                    <Slider.Track><Slider.Fill /><Slider.Thumb /></Slider.Track>
                </Slider> : <p>{t("compareIndependentHint")}</p>}
            </div>
        </div>}>
        <div className={styles.viewer} role="group" aria-label={t("compareViewer")} tabIndex={0} onKeyDown={onKeyDown}>
            <div className={styles.toolbar}>
                <Checkbox isSelected={sync} onChange={value => { pauseAll(); setSync(value); if (value) seekTo(0); }}>{t("compareSync")}</Checkbox>
                <SelectField label={t("compareAudio")} value={soloId ?? "muted"} onChange={value => setSoloId(value === "muted" ? null : String(value))} options={[
                    { id: "muted", label: t("compareMuted") }, ...slots.map((task, index) => ({ id: task.id, label: t("compareCandidate", { number: index + 1 }) })),
                ]} />
            </div>
            <p className={styles.hint}>{t(sync ? "compareSyncHint" : "compareIndependentHint")}</p>
            <div className={styles.grid}>
                {slots.map((task, index) => {
                    const mediaStatus = task.video_url ? status[task.id] || "loading" : "error";
                    return <figure key={task.id} className={styles.candidate}>
                        <figcaption><strong>{t("compareCandidate", { number: index + 1 })}</strong>{task.is_starred && <StatusBadge tone="info">{t("filterStarred")}</StatusBadge>}</figcaption>
                        <div className={styles.media}>
                            {task.video_url && <video ref={refs[index]} src={resolveUrl ? resolveUrl(task.video_url) : task.video_url} aria-label={t("compareCandidate", { number: index + 1 })} controls={!sync} muted={soloId !== task.id} playsInline preload="auto"
                                onCanPlay={event => { const { duration: length, seeking } = event.currentTarget; setDurations(previous => ({ ...previous, [task.id]: Number.isFinite(length) ? length : 0 })); setStatus(previous => ({ ...previous, [task.id]: seeking ? "seeking" : "ready" })); }}
                                onSeeking={() => setStatus(previous => ({ ...previous, [task.id]: "seeking" }))}
                                onSeeked={event => { const ready = event.currentTarget.readyState >= 3; setStatus(previous => ({ ...previous, [task.id]: ready ? "ready" : "loading" })); }}
                                onWaiting={event => { const seeking = event.currentTarget.seeking; setStatus(previous => ({ ...previous, [task.id]: seeking ? "seeking" : "loading" })); if (sync && !seeking) pauseAll(); }}
                                onError={() => { setStatus(previous => ({ ...previous, [task.id]: "error" })); if (sync) pauseAll(); }}
                                onPlay={() => { if (!sync) setPlaying(true); }}
                                onPause={() => { if (!sync) setPlaying(videos.current.some(video => video && !video.paused && !video.ended)); }}
                                onEnded={() => { if (sync && index === masterIndex) { pauseAll(); setPosition(duration); } else if (!sync) setPlaying(videos.current.some(video => video && !video.paused && !video.ended)); }}
                                onVolumeChange={event => { if (!event.currentTarget.muted) setSoloId(task.id); else setSoloId(current => current === task.id ? null : current); }} />}
                            {mediaStatus !== "ready" && <div className={styles.mediaState}>{mediaStatus === "error" ? <><p role="alert">{t("compareLoadFailed", { number: index + 1 })}</p>{task.video_url && <Button variant="secondary" onPress={() => reload(index)}><RotateCcw size={16} />{t("compareReload")}</Button>}</> : <LoadingState label={t(mediaStatus === "seeking" ? "compareSeeking" : "compareLoading", { number: index + 1 })} />}</div>}
                        </div>
                        <p className={styles.meta}>{[task.model, task.resolution, task.seed != null ? `Seed ${task.seed}` : null].filter(Boolean).join(" · ")}</p>
                        {task.label && <p className={styles.note}>{task.label}</p>}
                    </figure>;
                })}
            </div>
            <p className={styles.hint}>{t("compareKeys")}</p>
        </div>
    </Dialog>;
}
