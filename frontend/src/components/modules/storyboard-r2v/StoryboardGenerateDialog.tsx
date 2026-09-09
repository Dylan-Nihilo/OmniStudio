"use client";

import { AlertTriangle, ArrowRight, CheckCircle2, Circle, WandSparkles } from "lucide-react";
import { Button, Dialog } from "@omnistudio/ui";
import { useTranslations } from "next-intl";

interface StoryboardGenerateDialogProps {
    isOpen: boolean;
    onClose: () => void;
    project: {
        id: string;
        title?: string;
        originalText?: string;
        original_text?: string;
        characters?: any[];
        frames?: any[];
    } | null;
    existingShotCount: number;
    onConfirm: () => void;
    onJumpToScript?: () => void;
    readiness?: {
        ready: boolean;
        blockers: Array<{ code: string; message: string; frame_id?: string; previous_frame_id?: string; shot_id?: string; previous_shot_id?: string; field?: string; blocking?: boolean }>;
    } | null;
    readinessLoading?: boolean;
}

export default function StoryboardGenerateDialog({ isOpen, onClose, project, existingShotCount, onConfirm, onJumpToScript, readiness, readinessLoading = false }: StoryboardGenerateDialogProps) {
    const t = useTranslations("storyboardGen");
    const text = project?.original_text ?? project?.originalText ?? "";
    const checks = [
        { key: "text", pass: text.trim().length >= 40, label: t("checkText"), hint: t("checkTextHint") },
        { key: "characters", pass: (project?.characters?.length ?? 0) > 0, label: t("checkChars"), hint: t("checkCharsHint") },
    ];
    const ready = checks.every(check => check.pass) && !readinessLoading && (readiness?.ready ?? true);
    return <Dialog isOpen={isOpen} onOpenChange={open => { if (!open) onClose(); }} title={t("title")} closeLabel={t("close")} className="max-w-[640px]"
        footer={<>
            <Button variant="secondary" onPress={onClose}>{t("cancel")}</Button>
            <Button isDisabled={!ready} onPress={() => { if (ready) { onClose(); onConfirm(); } }}>
                <WandSparkles size={16} aria-hidden="true" />{t(existingShotCount > 0 ? "replaceAndGenerate" : "generate")}
            </Button>
        </>}>
        <div className="space-y-4">
            <p className="break-words text-sm text-text-secondary">{t("forProject")} <span className="font-medium text-foreground">{project?.title || "—"}</span></p>
            <section aria-label={t("preflightTitle")}>
                <ul className="divide-y divide-glass-border">
                    {checks.map(check => <li key={check.key} className="flex items-start gap-3 py-3">
                        {check.pass ? <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-status-completed-fg" aria-hidden="true" /> : <Circle size={18} className="mt-0.5 shrink-0 text-text-muted" aria-hidden="true" />}
                        <div className="min-w-0 space-y-1 text-sm"><p>{check.label}</p>{!check.pass && <p className="text-xs text-text-secondary">{check.hint}</p>}</div>
                    </li>)}
                </ul>
                {!ready && onJumpToScript && <Button variant="quiet" onPress={onJumpToScript}>{t("goFixInScript")}<ArrowRight size={14} aria-hidden="true" /></Button>}
                {readiness && !readiness.ready && <ul className="mt-3 space-y-2 border-t border-glass-border pt-3" aria-label="storyboard-readiness-blockers">
                    {readiness.blockers.map((blocker, index) => <li key={`${blocker.code}-${blocker.frame_id ?? index}`} className="flex items-start gap-2 text-xs text-status-failed-fg">
                        <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
                        <span>{blocker.message}{(blocker.shot_id || blocker.frame_id) ? ` · ${blocker.shot_id || blocker.frame_id}` : ""}{blocker.field ? ` · ${blocker.field}` : ""}</span>
                    </li>)}
                </ul>}
                {readinessLoading && <p role="status" className="mt-3 border-t border-glass-border pt-3 text-xs text-text-secondary">{t("checkingReadiness")}</p>}
            </section>
            {existingShotCount > 0 ? <div className="flex items-start gap-3 border-t border-glass-border pt-4 text-sm text-status-processing-fg">
                <AlertTriangle size={18} className="mt-0.5 shrink-0" aria-hidden="true" /><p>{t("willReplaceWarning", { count: existingShotCount })}</p>
            </div> : ready && <p className="text-sm text-text-secondary">{t("freshHint")}</p>}
        </div>
    </Dialog>;
}
