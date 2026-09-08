"use client";

import { ChevronLeft } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button, NavigationMenu, SelectField } from "@omnistudio/ui";
import type { BreadcrumbSegment } from "./BreadcrumbBar";
import styles from "./PipelineSidebar.module.css";

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

export default function PipelineSidebar({ activeStep, onStepChange, steps, breadcrumbSegments, headerActions, topSlot, projectLabel, projectSubLabel }: PipelineSidebarProps) {
    const t = useTranslations("pipelineChrome");
    const parent = breadcrumbSegments?.slice(0, -1).reverse().find(segment => segment.hash);
    return <div className={styles.sidebar}>
        <header className={styles.header}>
            <p>{projectSubLabel || t("workspace")}</p>
            <h1>{projectLabel || "Omni Studio"}</h1>
            {headerActions}
        </header>
        <p className={styles.eyebrow}>{t("workflow")}</p>
        <NavigationMenu aria-label={t("workflow")} className={styles.menu} currentId={activeStep} onNavigate={href => onStepChange(href.slice(1))}
            items={steps.map((step, index) => {
                const Icon = step.icon;
                return { id: step.id, href: `#${step.id}`, label: `${step.label.replace(/^\d+\.\s*/, "")}${step.statusLabel ? ` · ${step.statusLabel}` : ""}`,
                    icon: <span className={styles.stepIcon}><span>{String(index + 1).padStart(2, "0")}</span><Icon size={17} /></span> };
            })} />
        <div className={styles.mobileWorkflow}><SelectField label={t("workflow")} value={activeStep} onChange={key => onStepChange(String(key))} options={steps.map(step => ({ id: step.id, label: step.label }))} /></div>
        {topSlot && <details className={styles.episodes}><summary>{t("switchEpisode")}</summary>{topSlot}</details>}
        <footer className={styles.footer}><Button variant="quiet" onPress={() => { window.location.hash = parent?.hash || "#/workspace"; }}><ChevronLeft size={16} />{parent?.label || t("back")}</Button></footer>
    </div>;
}
