/**
 * Per-shot per-section collapse state with localStorage persistence.
 * Keys are namespaced "storyboard-shot-panel:{shotId}:{section}" so
 * multiple projects don't collide and each shot keeps its own
 * expanded/collapsed memory across page reloads.
 *
 * Default open is the caller's choice — for params panel we open by
 * default; for individual subsections (Advanced, batch history) we
 * default collapsed.
 */
import { useCallback, useEffect, useState } from "react";

function key(shotId: string, section: string): string {
    return `storyboard-shot-panel:${shotId}:${section}`;
}

function readState(shotId: string, section: string, defaultOpen: boolean): boolean {
    if (typeof window === "undefined") return defaultOpen;
    try {
        const raw = window.localStorage.getItem(key(shotId, section));
        if (raw === "1") return true;
        if (raw === "0") return false;
    } catch {
        /* private mode / quota */
    }
    return defaultOpen;
}

export function usePanelSectionState(
    shotId: string,
    section: string,
    defaultOpen: boolean,
): [boolean, (next: boolean) => void] {
    const [open, setOpen] = useState<boolean>(() => readState(shotId, section, defaultOpen));

    // Re-hydrate when shotId changes (e.g. user duplicates a shot —
    // new shot inherits its own default until they interact).
    useEffect(() => {
        setOpen(readState(shotId, section, defaultOpen));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [shotId, section]);

    // Listen for global override events (e.g. "expand all" toolbar button)
    // so externally-flipped localStorage values reflect immediately without
    // the user having to interact with each section. Same-window writes
    // do NOT fire the native 'storage' event, so we use a custom one.
    useEffect(() => {
        if (typeof window === "undefined") return;
        const handler = () => setOpen(readState(shotId, section, defaultOpen));
        window.addEventListener(PANEL_SECTION_OVERRIDE_EVENT, handler);
        return () => window.removeEventListener(PANEL_SECTION_OVERRIDE_EVENT, handler);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [shotId, section]);

    const set = useCallback((next: boolean) => {
        setOpen(next);
        if (typeof window === "undefined") return;
        try {
            window.localStorage.setItem(key(shotId, section), next ? "1" : "0");
        } catch {
            /* ignore */
        }
    }, [shotId, section]);

    return [open, set];
}

export const PANEL_SECTION_OVERRIDE_EVENT = "omni_studio:panel-section-override";

/**
 * Bulk-set every (shotId × section) pair's persisted state and notify
 * all live `usePanelSectionState` hooks to re-read. Used by the
 * Storyboard R2V toolbar's "expand all" / "collapse all" actions to
 * override sticky preferences.
 */
export function overridePanelSectionState(
    shotIds: string[],
    sections: string[],
    open: boolean,
): void {
    if (typeof window === "undefined") return;
    try {
        for (const sid of shotIds) {
            for (const sec of sections) {
                window.localStorage.setItem(key(sid, sec), open ? "1" : "0");
            }
        }
    } catch {
        /* quota / private mode — partial writes still benefit from the event */
    }
    window.dispatchEvent(new Event(PANEL_SECTION_OVERRIDE_EVENT));
}
