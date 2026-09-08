"use client";
/**
 * SectionShell — collapsible container used by every subsection
 * inside the attached ShotPanel (Params / Candidates / Advanced).
 * Standardizes the header ▼/▶ toggle, title typography, optional
 * trailing slot (filter chips, summary count), and collapsed-state
 * spacing so the whole panel reads as a coherent unit instead of
 * a pile of bespoke headers.
 */
import { ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@omnistudio/ui";
import type { ReactNode } from "react";

interface SectionShellProps {
    title: ReactNode;
    open: boolean;
    onToggle: () => void;
    /** Right side of the header — chips, counts, action buttons.
     *  Clicks bubble independently of the toggle. */
    trailing?: ReactNode;
    /** Body is rendered only when open; allows expensive children to
     *  skip mounting until needed. */
    children: ReactNode;
    /** Optional muted one-liner under the title (e.g. metadata). */
    subtitle?: ReactNode;
    /** Override the chevron-only header with a custom layout when
     *  needed (e.g. for the Active-T2I row which has a thumb strip
     *  always visible alongside the toggle). */
    headerOverride?: ReactNode;
}

export default function SectionShell({
    title,
    open,
    onToggle,
    trailing,
    children,
    subtitle,
    headerOverride,
}: SectionShellProps) {
    return (
        <div className="border-b border-glass-border last:border-b-0 py-4">
            {headerOverride ?? (
                <div className="mb-3 flex flex-wrap items-center gap-2 px-3">
                    <Button variant="quiet" onPress={onToggle} aria-expanded={open}
                        className="min-w-0 flex-1 basis-40 justify-start gap-2 px-0 text-left">
                        {open ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
                        <span className="shrink-0 whitespace-nowrap text-xs font-medium text-text-secondary">{title}</span>
                        {subtitle && <span className="min-w-0 truncate font-mono text-[0.625rem] text-text-muted">{subtitle}</span>}
                    </Button>
                    {trailing && <div className="flex max-w-full flex-wrap items-center gap-1">{trailing}</div>}
                </div>
            )}
            {open ? <div className="px-3">{children}</div> : null}
        </div>
    );
}
