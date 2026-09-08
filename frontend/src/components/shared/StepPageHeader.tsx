"use client";
// Shared editorial heading for both production workflows.
import type { ReactNode } from "react";

export interface StepPageHeaderProps {
    /** 1-based step number; rendered as the primary-colored eyebrow numeral. */
    stepNumber: number;
    /** English chrome name (e.g. "Script" / "Storyboard R2V"). */
    englishName: string;
    /** Localized title. */
    title: string;
    /** Localized subtitle one-liner. */
    subtitle: string;
    /** Info pills row, sits inline with the title (画风 / 模型 / 计数 …).
     *  Each pill should use the shared capsule style; caller composes them. */
    pills?: ReactNode;
    /** Right-aligned actions (queue button, generate CTA, counters …). */
    trailing?: ReactNode;
}

export default function StepPageHeader({
    stepNumber,
    englishName,
    title,
    subtitle,
    pills,
    trailing,
}: StepPageHeaderProps) {
    const stepStr = String(stepNumber).padStart(2, "0");
    return (
        <header className="shrink-0 border-b border-border-default bg-surface px-4 py-5 sm:px-7">
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex-1 min-w-[min(100%,16rem)]">
                    <div className="font-mono text-[0.59375rem] font-normal uppercase tracking-[0.22em] text-text-muted">
                        <span>STEP</span>
                        <span className="ml-1.5 font-medium text-primary">{stepStr}</span>
                        <span className="mx-1.5">·</span>
                        <span>{englishName}</span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-baseline gap-3.5">
                        <h1 className="font-sans text-xl font-semibold leading-7 text-foreground">
                            {title}
                        </h1>
                        {pills ? <div className="flex items-center gap-2">{pills}</div> : null}
                    </div>
                    <p className="mt-1.5 text-[0.8125rem] text-text-secondary">{subtitle}</p>
                </div>
                {trailing ? (
                    <div className="flex max-w-full flex-wrap items-center gap-2">{trailing}</div>
                ) : null}
            </div>
        </header>
    );
}

/** Shared pill capsule — callers compose <Pill key="…" value="…" /> for each
 *  info chip so all steps share one visual. */
export function StepPill({ label, value }: { label: string; value: ReactNode }) {
    return (
        <span className="inline-flex items-center gap-1.5 rounded-lg border border-border-default bg-surface-inset px-2.5 py-1 font-mono text-[0.59375rem] text-text-secondary">
            <span className="text-text-muted">{label}</span>
            <span className="text-primary">{value}</span>
        </span>
    );
}
