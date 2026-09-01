"use client";

import { motion } from "framer-motion";
import {
    ChevronRight,
    ChevronLeft,
    Lock,
    Check
} from "lucide-react";
import clsx from "clsx";
import { useTranslations } from "next-intl";
import OmniStudioBranding from "./OmniStudioBranding";
import type { BreadcrumbSegment } from "./BreadcrumbBar";

interface Step {
    id: string;
    label: string;
    icon: any;
    comingSoon?: boolean;
    /** Per-step status for the rail's stage model (not a wizard done-check).
     *  'ready' = has content (teal check); 'warn' = partial / needs attention
     *  (amber dot); 'idle' = not started (muted hollow); 'gated' = blocked by
     *  an upstream step (muted + lock, still clickable). */
    status?: "ready" | "warn" | "idle" | "gated";
    statusLabel?: string;
}

interface PipelineSidebarProps {
    activeStep: string;
    onStepChange: (stepId: string) => void;
    steps: Step[];
    breadcrumbSegments?: BreadcrumbSegment[];
    headerActions?: React.ReactNode;
    /** Optional content rendered between the header and the steps
     *  nav. Used for the EpisodeMiniList when the current project
     *  belongs to a series, so users can switch episodes without
     *  leaving the pipeline shell. */
    topSlot?: React.ReactNode;
    /** Real project title for the footer card (replaces the "Project Alpha"
     *  stub). Sub-label is a short context line (e.g. "EP.03"); omitted →
     *  falls back to the version stub. */
    projectLabel?: string;
    projectSubLabel?: string;
}

export const getActiveStepIndicatorClasses = () =>
    "absolute left-0 inset-y-[20%] w-1 rounded-r-sm bg-primary shadow-[var(--glow-primary)]";

export const getStepMetaClasses = () =>
    "flex w-full min-w-0 items-start gap-1.5 font-mono text-[9px] leading-tight tracking-[0.08em] text-text-muted";

export default function PipelineSidebar({ activeStep, onStepChange, steps, breadcrumbSegments, headerActions, topSlot, projectLabel, projectSubLabel }: PipelineSidebarProps) {
    const tc = useTranslations("common");
    const tp = useTranslations("pipeline");
    const handleBack = () => {
        if (!breadcrumbSegments) return;
        if (breadcrumbSegments.length >= 2 && breadcrumbSegments[breadcrumbSegments.length - 2].hash) {
            window.location.hash = breadcrumbSegments[breadcrumbSegments.length - 2].hash!;
        } else if (breadcrumbSegments[0]?.hash) {
            window.location.hash = breadcrumbSegments[0].hash;
        } else {
            window.location.hash = "";
        }
    };

    return (
        <motion.aside
            initial={{ x: -100, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            className="w-64 flex-1 min-h-0 border-r border-glass-border bg-surface backdrop-blur-xl flex flex-col z-50"
        >
            {/* Header: breadcrumb navigation or branding */}
            <div className="p-5 border-b border-glass-border">
                {breadcrumbSegments ? (
                    <div className="space-y-3">
                        {/* Breadcrumb row */}
                        <div className="flex items-center gap-1.5">
                            <button
                                onClick={handleBack}
                                className="flex-shrink-0 text-text-secondary hover:text-foreground transition-colors"
                                title={tc("back")}
                            >
                                <ChevronLeft size={16} />
                            </button>
                            <nav className="flex items-center gap-1 text-xs min-w-0 flex-1">
                                {breadcrumbSegments.map((seg, i) => {
                                    const isLast = i === breadcrumbSegments.length - 1;
                                    return (
                                        <span key={i} className="flex items-center gap-1 min-w-0">
                                            {i > 0 && <span className="text-text-muted flex-shrink-0">&rsaquo;</span>}
                                            {seg.hash && !isLast ? (
                                                <a
                                                    href={seg.hash}
                                                    className="text-text-muted hover:text-foreground transition-colors truncate"
                                                >
                                                    {seg.label}
                                                </a>
                                            ) : (
                                                <span className={clsx(
                                                    "truncate",
                                                    isLast ? "text-foreground font-medium" : "text-text-muted"
                                                )}>
                                                    {seg.label}
                                                </span>
                                            )}
                                        </span>
                                    );
                                })}
                            </nav>
                        </div>
                        {/* Actions row */}
                        {headerActions && (
                            <div className="flex items-center gap-1">
                                {headerActions}
                            </div>
                        )}
                    </div>
                ) : (
                    <OmniStudioBranding size="sm" />
                )}
            </div>

            {topSlot}
            <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
                {steps.map((step, index) => {
                    const isActive = activeStep === step.id;
                    const isLast = index === steps.length - 1;
                    const Icon = step.icon;

                    return (
                        <button
                            key={step.id}
                            onClick={() => onStepChange(step.id)}
                            className={clsx(
                                "w-full relative flex items-center gap-3 px-4 py-3 rounded-[14px] transition-all duration-200 group overflow-hidden",
                                isActive
                                    ? "bg-primary/10 text-primary border border-primary/20"
                                    : "text-text-secondary hover:text-foreground hover:bg-glass",
                                step.status === "gated" && !isActive && "opacity-60"
                            )}
                        >
                            {/* connector line to the next step (mock .rail-nav .rstep::after) */}
                            {!isLast && (
                                <span
                                    aria-hidden="true"
                                    className="pointer-events-none absolute left-[25px] top-[38px] bottom-[-8px] w-[1.5px] bg-foreground/10"
                                />
                            )}
                            {isActive && (
                                <motion.div
                                    layoutId="active-pill"
                                    className={getActiveStepIndicatorClasses()}
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                />
                            )}

                            <Icon size={20} className={clsx(
                                "transition-colors",
                                step.comingSoon ? "opacity-50" : "",
                                isActive ? "text-primary" : "group-hover:text-foreground"
                            )} />

                            <div className="flex flex-col items-start gap-0.5 text-sm flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                    <span className={clsx("font-medium", step.comingSoon && "opacity-70")}>{step.label}</span>
                                    {step.comingSoon && (
                                        <span className="text-[0.5rem] px-1.5 py-0.5 rounded-full bg-accent/20 text-accent border border-accent/30 font-medium">
                                            {tp("beta")}
                                        </span>
                                    )}
                                </div>
                                {/* rsub — wraps only when the rail is too narrow for the full status. */}
                                <span className={getStepMetaClasses()}>
                                    <span className="shrink-0 whitespace-nowrap opacity-70">{tp("stepIndex", { number: index + 1 })}</span>
                                    {step.statusLabel ? (
                                        <>
                                            <span className="shrink-0 opacity-50">·</span>
                                            <span className="min-w-0 break-words text-left">{step.statusLabel}</span>
                                        </>
                                    ) : null}
                                </span>
                            </div>

                            {/* right rail: 3-state dot (ready/warn/idle), done check,
                                gated lock, or active chevron — mock .rdot/.rcheck/.rlock */}
                            {isActive ? (
                                <ChevronRight size={16} className="ml-auto shrink-0 opacity-50" />
                            ) : step.status === "gated" ? (
                                <Lock size={13} className="ml-auto shrink-0 text-text-muted/50" aria-label={tp("gatedTooltip")} />
                            ) : step.status === "ready" ? (
                                <Check size={16} strokeWidth={2.6} className="ml-auto shrink-0 text-primary" aria-label={tp("doneTooltip")} />
                            ) : step.status ? (
                                <span
                                    aria-hidden="true"
                                    className={clsx(
                                        "ml-auto shrink-0 h-2 w-2 rounded-full",
                                        step.status === "warn" && "bg-accent shadow-[0_0_6px_rgba(255,169,77,0.5)]",
                                        step.status === "idle" && "border-[1.5px] border-text-muted/60 opacity-60",
                                    )}
                                />
                            ) : null}
                        </button>
                    );
                })}
            </nav>

            <div className="p-4 border-t border-glass-border">
                <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-glass border border-border-subtle">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-primary to-accent" />
                    <div className="flex flex-col">
                        <span className="text-sm font-medium text-foreground truncate">{projectLabel ?? "Project Alpha"}</span>
                        <span className="text-xs text-text-muted">{projectSubLabel ?? "v0.1.0"}</span>
                    </div>
                </div>
            </div>
        </motion.aside>
    );
}
