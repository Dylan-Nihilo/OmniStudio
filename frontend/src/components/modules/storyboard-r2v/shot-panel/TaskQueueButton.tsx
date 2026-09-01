"use client";
/**
 * TaskQueueButton — toolbar icon with in-flight count badge. Sits in
 * Storyboard's top toolbar; clicking opens the TaskQueuePanel.
 */
import { ListChecks } from "lucide-react";

interface TaskQueueButtonProps {
    inFlightCount: number;
    open: boolean;
    onToggle: () => void;
}

export default function TaskQueueButton({ inFlightCount, open, onToggle }: TaskQueueButtonProps) {
    return (
        <button
            type="button"
            onClick={onToggle}
            aria-pressed={open}
            aria-label={`Task queue, ${inFlightCount} in flight`}
            title={`${inFlightCount} task${inFlightCount === 1 ? "" : "s"} in flight`}
            className={`relative inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 font-mono text-chrome-sm font-medium uppercase transition-colors duration-fast ease-out-quart focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/55 ${
                open
                    ? "border-primary/55 bg-primary/15 text-primary"
                    : "border-glass-border bg-glass text-text-secondary hover:border-foreground/30 hover:text-foreground"
            }`}
        >
            <ListChecks size={13} aria-hidden="true" />
            Queue
            {inFlightCount > 0 ? (
                // P3-5 polish: subtle warm glow + inset highlight,
                // tabular-nums so the badge width doesn't jitter as
                // count climbs.
                <span
                    aria-hidden="true"
                    className="ml-1 inline-flex min-w-[18px] items-center justify-center rounded-full bg-status-starred-solid px-1.5 font-display text-chrome font-semibold tabular-nums text-on-warm shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_0_8px_-2px_var(--color-status-starred-bg)] motion-safe:animate-[badgePulse_1.6s_cubic-bezier(0.22,1,0.36,1)_infinite]"
                >
                    {inFlightCount}
                </span>
            ) : null}
        </button>
    );
}
