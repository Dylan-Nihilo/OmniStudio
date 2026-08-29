"use client";
/**
 * PreviewVideo — same contract as PreviewImage but for `<video>` (Issue 14).
 *
 * Differences from PreviewImage:
 *   - Hover-to-play built in (mimics CandidateThumb / ShotCard video behavior);
 *     pauses + rewinds on mouse leave so the next hover starts from frame 0.
 *   - Tap to open lightbox (videos have less "select" semantic than image
 *     thumbs, so the whole element is clickable by default in addition to
 *     the explicit 🔍 button).
 *   - Loading skeleton uses video poster if available, else a neutral panel.
 *
 * onError fallback panel reuses the same sized-adaptive treatment as
 * PreviewImage so error UX is consistent across image + video previews.
 */
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, RefreshCw, Maximize2, Copy, Check, Play } from "lucide-react";
import clsx from "clsx";
import { getAssetUrl } from "@/lib/utils";
import { useTranslations } from "next-intl";
import { useLightbox, type LightboxItem } from "./LightboxProvider";

export interface PreviewVideoProps {
    src?: string;
    poster?: string;
    alt?: string;
    className?: string;
    noLightbox?: boolean;
    groupId?: string;
    groupIndex?: number;
    alwaysShowMagnify?: boolean;
    /** Whole-thumb click opens lightbox (in addition to the 🔍 button).
     *  Default false — callers like CandidateThumb own the click for select/play. */
    clickToLightbox?: boolean;
    /** Hover-to-play behavior (default on). Disable for autoplay backgrounds. */
    hoverPlay?: boolean;
    placeholder?: React.ReactNode;
}

export default function PreviewVideo({
    src, poster, alt, className, noLightbox = false,
    groupId, groupIndex, alwaysShowMagnify = false,
    clickToLightbox = false,
    hoverPlay = true, placeholder,
}: PreviewVideoProps) {
    const { open, openInGroup } = useLightbox();
    const t = useTranslations("preview");
    const [errored, setErrored] = useState(false);
    const [retryNonce, setRetryNonce] = useState(0);
    const [hasRetriedOnce, setHasRetriedOnce] = useState(false);
    const [copied, setCopied] = useState(false);
    const wrapperRef = useRef<HTMLDivElement | null>(null);
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const [sizeBucket, setSizeBucket] = useState<"micro" | "mid" | "large">("large");

    useEffect(() => {
        setErrored(false);
        setHasRetriedOnce(false);
        setRetryNonce(0);
    }, [src]);

    useEffect(() => {
        const el = wrapperRef.current;
        if (!el) return;
        const measure = () => {
            const { width, height } = el.getBoundingClientRect();
            const min = Math.min(width, height);
            if (min <= 40) setSizeBucket("micro");
            else if (min <= 120) setSizeBucket("mid");
            else setSizeBucket("large");
        };
        measure();
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    const resolved = getAssetUrl(src);
    const resolvedPoster = getAssetUrl(poster);
    const displaySrc = resolved
        ? (retryNonce > 0 ? `${resolved}${resolved.includes("?") ? "&" : "?"}__r=${retryNonce}` : resolved)
        : "";

    const handleError = () => {
        if (!hasRetriedOnce) {
            setHasRetriedOnce(true);
            setRetryNonce(n => n + 1);
        } else {
            setErrored(true);
        }
    };

    const handleManualRetry = () => {
        setErrored(false);
        setRetryNonce(n => n + 1);
    };

    const handleCopyUrl = async () => {
        if (!resolved) return;
        try {
            await navigator.clipboard.writeText(resolved);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
        } catch {
            /* clipboard blocked */
        }
    };

    const handleOpenLightbox = (e?: React.MouseEvent) => {
        if (e) e.stopPropagation();
        if (noLightbox || !src) return;
        const item: LightboxItem = { src, alt, kind: "video" };
        if (groupId && typeof groupIndex === "number") openInGroup(groupId, groupIndex);
        else open(item);
    };

    if (!src) {
        return (
            <div ref={wrapperRef} className={clsx("relative overflow-hidden", className)}>
                {placeholder ?? null}
            </div>
        );
    }

    const clickable = clickToLightbox && !noLightbox && !errored && !!src;

    return (
        <div
            ref={wrapperRef}
            className={clsx(
                "group/preview relative overflow-hidden",
                clickable && "cursor-zoom-in",
                className,
            )}
            onClick={clickable ? handleOpenLightbox : undefined}
            role={clickable ? "button" : undefined}
            tabIndex={clickable ? 0 : undefined}
            onKeyDown={clickable ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    handleOpenLightbox();
                }
            } : undefined}
            aria-label={clickable ? t("zoom") : undefined}
            onMouseEnter={() => {
                if (hoverPlay && videoRef.current) {
                    void videoRef.current.play().catch(() => {/* autoplay blocked */});
                }
            }}
            onMouseLeave={() => {
                if (hoverPlay && videoRef.current) {
                    videoRef.current.pause();
                    videoRef.current.currentTime = 0;
                }
            }}
        >
            {!errored ? (
                <>
                    <video
                        ref={videoRef}
                        src={displaySrc}
                        poster={resolvedPoster || undefined}
                        crossOrigin="use-credentials"
                        muted
                        loop
                        playsInline
                        preload="metadata"
                        onError={handleError}
                        className="h-full w-full object-cover"
                    />
                    {/* Subtle play indicator when not hovering — signals "this is a video" */}
                    {hoverPlay ? (
                        <div
                            aria-hidden="true"
                            className="pointer-events-none absolute inset-0 grid place-items-center opacity-70 transition-opacity duration-fast ease-out-quart group-hover/preview:opacity-0"
                        >
                            <div className="grid h-9 w-9 place-items-center rounded-full bg-black/55 backdrop-blur">
                                <Play size={14} className="text-foreground" fill="currentColor" />
                            </div>
                        </div>
                    ) : null}
                    {!noLightbox && sizeBucket !== "micro" ? (
                        <button
                            type="button"
                            onClick={handleOpenLightbox}
                            aria-label={t("zoom")}
                            title={t("zoom")}
                            className={clsx(
                                "absolute right-1 top-1 grid h-6 w-6 place-items-center rounded bg-black/55 text-foreground backdrop-blur transition-opacity duration-fast ease-out-quart hover:bg-black/75 focus-visible:outline-none focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-primary/55",
                                alwaysShowMagnify
                                    ? "opacity-100"
                                    : "opacity-0 group-hover/preview:opacity-100",
                            )}
                        >
                            <Maximize2 size={11} aria-hidden="true" />
                        </button>
                    ) : null}
                </>
            ) : (
                <VideoFallbackPanel
                    sizeBucket={sizeBucket}
                    url={resolved}
                    onRetry={handleManualRetry}
                    onCopyUrl={handleCopyUrl}
                    copied={copied}
                />
            )}
        </div>
    );
}

interface VideoFallbackPanelProps {
    sizeBucket: "micro" | "mid" | "large";
    url: string;
    onRetry: () => void;
    onCopyUrl: () => void;
    copied: boolean;
}

function VideoFallbackPanel({ sizeBucket, url, onRetry, onCopyUrl, copied }: VideoFallbackPanelProps) {
    const t = useTranslations("preview");
    if (sizeBucket === "micro") {
        return (
            <button
                type="button"
                onClick={onRetry}
                title={`${t("videoLoadFailedRetry")}\n${url}`}
                aria-label={t("videoLoadFailedRetry")}
                className="grid h-full w-full place-items-center bg-status-failed-bg text-status-failed-fg transition-colors duration-fast ease-out-quart hover:bg-status-failed-bg/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-status-failed-border"
            >
                <AlertTriangle size={12} aria-hidden="true" />
            </button>
        );
    }
    if (sizeBucket === "mid") {
        return (
            <div
                title={url}
                className="grid h-full w-full place-items-center gap-1 bg-status-failed-bg p-2 text-status-failed-fg"
            >
                <AlertTriangle size={16} aria-hidden="true" />
                <button
                    type="button"
                    onClick={onRetry}
                    className="inline-flex items-center gap-0.5 font-mono text-chrome-sm font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-status-failed-border"
                >
                    <RefreshCw size={10} aria-hidden="true" />
                    {t("retry")}
                </button>
            </div>
        );
    }
    return (
        <div
            role="alert"
            className="grid h-full w-full place-items-center gap-2 bg-status-failed-bg p-4 text-center text-status-failed-fg"
        >
            <AlertTriangle size={22} aria-hidden="true" />
            <div className="space-y-1">
                <p className="font-sans text-body-sm font-medium">{t("videoLoadFailed")}</p>
                <p
                    className="max-w-[26rem] truncate font-mono text-chrome-sm text-status-failed-fg/75"
                    title={url}
                >
                    {url}
                </p>
            </div>
            <div className="flex items-center gap-1.5 pt-1">
                <button
                    type="button"
                    onClick={onRetry}
                    className="inline-flex min-h-[28px] items-center gap-1 rounded border border-status-failed-border bg-status-failed-bg px-2.5 py-1 font-mono text-chrome font-medium text-status-failed-fg transition-colors duration-fast ease-out-quart hover:bg-status-failed-fg/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-status-failed-border"
                >
                    <RefreshCw size={11} aria-hidden="true" />
                    {t("retry")}
                </button>
                <button
                    type="button"
                    onClick={onCopyUrl}
                    className="inline-flex min-h-[28px] items-center gap-1 rounded border border-glass-border bg-black/30 px-2.5 py-1 font-mono text-chrome font-medium text-text-secondary transition-colors duration-fast ease-out-quart hover:bg-hover-bg hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/55"
                >
                    {copied ? <Check size={11} /> : <Copy size={11} />}
                    {copied ? t("copied") : t("copyUrl")}
                </button>
            </div>
        </div>
    );
}
