"use client";
/**
 * PromptExpandModal — "focus editing" escape hatch for the Shot
 * prompt textarea. Triggered by the right-corner expand icon OR
 * the Cmd/Ctrl+E shortcut from inside the small textarea.
 *
 * Why: per design grill B5, the inline textarea caps at ~10 rows
 * (anything beyond scrolls). For genuinely long prompts (negative
 * descriptions + multiple @ references + scene-setting paragraphs)
 * users need a roomier surface without losing the storyboard
 * context. This modal opens a portal'd large editor synced two-way
 * with the original textarea.
 *
 * Reuses the focus-trap + Esc-to-close pattern established in
 * CompareModal.tsx so keyboard nav stays consistent.
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, Minimize2 } from "lucide-react";
import { useTranslations } from "next-intl";

interface PromptExpandModalProps {
    /** Current prompt text. Modal owns its own draft until commit so
     *  the user can Cancel without polluting upstream state. */
    initialValue: string;
    /** Display label for the shot the user is editing
     *  (e.g. "Shot 3"); pure context, not editable. */
    shotLabel: string;
    placeholder?: string;
    /** Commit and close — the host should update the underlying
     *  shot.prompt with the returned value. */
    onSave: (next: string) => void;
    /** Discard draft and close. */
    onClose: () => void;
}

export const getPromptExpandTextareaClasses = () =>
    "flex-1 w-full resize-none rounded-md border border-glass-border bg-input-bg px-4 py-3 font-sans text-body text-foreground leading-relaxed placeholder:text-text-muted outline-none transition-colors duration-fast ease-out-quart focus:border-primary/55 focus-visible:ring-2 focus-visible:ring-primary/45";

export default function PromptExpandModal({
    initialValue,
    shotLabel,
    placeholder,
    onSave,
    onClose,
}: PromptExpandModalProps) {
    const t = useTranslations("storyboardR2V");
    const [draft, setDraft] = useState(initialValue);
    const dialogRef = useRef<HTMLDivElement | null>(null);
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);
    const previouslyFocused = useRef<HTMLElement | null>(null);

    // Sync draft when initialValue changes (e.g. parent updates while
    // modal is open). Rare but safe.
    useEffect(() => {
        setDraft(initialValue);
    }, [initialValue]);

    // Focus the textarea on mount; restore previous focus on unmount
    // (matches the CompareModal pattern).
    useEffect(() => {
        previouslyFocused.current = document.activeElement as HTMLElement | null;
        const t = window.setTimeout(() => {
            const ta = textareaRef.current;
            if (ta) {
                ta.focus();
                // Place caret at end of existing text so the user can
                // immediately continue writing.
                ta.setSelectionRange(ta.value.length, ta.value.length);
            }
        }, 0);
        return () => {
            window.clearTimeout(t);
            previouslyFocused.current?.focus?.();
        };
    }, []);

    // Keyboard: Esc closes; Cmd/Ctrl+Enter saves; Cmd/Ctrl+E also
    // saves (symmetric with the open shortcut).
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                e.preventDefault();
                onClose();
            } else if (
                (e.key === "Enter" && (e.metaKey || e.ctrlKey))
                || (e.key.toLowerCase() === "e" && (e.metaKey || e.ctrlKey))
            ) {
                e.preventDefault();
                onSave(draft);
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [draft, onSave, onClose]);

    const handleTrapTab = (e: React.KeyboardEvent<HTMLDivElement>) => {
        if (e.key !== "Tab") return;
        const root = dialogRef.current;
        if (!root) return;
        const focusables = root.querySelectorAll<HTMLElement>(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
        }
    };

    if (typeof window === "undefined") return null;

    const modal = (
        <>
            <div
                aria-hidden="true"
                className="fixed inset-0 z-[60] bg-black/75 backdrop-blur-sm motion-safe:animate-[fadeInBackdrop_180ms_cubic-bezier(0.22,1,0.36,1)_both]"
                onClick={onClose}
            />
            <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-label={t("promptExpandTitle", { shot: shotLabel })}
                onKeyDown={handleTrapTab}
                className="fixed left-1/2 top-1/2 z-[61] flex h-[80vh] w-[min(800px,92vw)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[12px] border border-glass-border bg-surface shadow-[0_24px_60px_-22px_rgba(0,0,0,0.9)] motion-safe:animate-[compareModalIn_240ms_cubic-bezier(0.22,1,0.36,1)_both]"
            >
                <header className="flex shrink-0 items-center justify-between gap-3 border-b border-glass-border px-4 py-3">
                    <div className="flex items-center gap-2">
                        <div className="font-display text-display font-semibold tracking-tight text-foreground">
                            {t("promptExpandTitle", { shot: shotLabel })}
                        </div>
                        <div className="font-mono text-chrome-sm font-medium uppercase text-text-muted">
                            {draft.length} {t("promptExpandChars")}
                        </div>
                    </div>
                    <div className="flex items-center gap-1">
                        <button
                            type="button"
                            onClick={() => onSave(draft)}
                            className="btn-tip inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 font-display text-display-sm font-semibold text-white shadow-[var(--btn-pri-glow),inset_0_1px_0_0_rgba(255,255,255,0.22)] transition-all duration-fast ease-out-quart hover:bg-primary/92 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/65"
                            title={t("promptExpandSaveHint")}
                        >
                            <Minimize2 size={13} aria-hidden="true" />
                            {t("promptExpandSave")}
                        </button>
                        <button
                            type="button"
                            onClick={onClose}
                            aria-label={t("close")}
                            className="-m-1 grid h-9 w-9 place-items-center rounded text-text-muted transition-colors duration-fast ease-out-quart hover:bg-hover-bg hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/55"
                        >
                            <X size={14} aria-hidden="true" />
                        </button>
                    </div>
                </header>
                <div className="flex flex-1 flex-col overflow-hidden px-4 py-4">
                    <textarea
                        ref={textareaRef}
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        placeholder={placeholder}
                        spellCheck={false}
                        className={getPromptExpandTextareaClasses()}
                    />
                </div>
                <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-glass-border px-4 py-2.5 font-mono text-chrome-sm tracking-tight text-text-muted">
                    <span>{t("promptExpandHotkeys")}</span>
                    <span>{t("promptExpandShortcut")}</span>
                </footer>
            </div>
        </>
    );

    return createPortal(modal, document.body);
}
