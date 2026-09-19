"use client";
/**
 * ReconcileModal — R2V v2 Phase 4 cross-episode asset reconcile.
 *
 * Triggered after Script step "提取实体" completes (only when episode is
 * part of a series). Shows AI-suggested matches between the just-extracted
 * entities and the parent series's shared library, defaulting to accept
 * the recommendation. Per Q6 design (A2 + Q6.1):
 *   · default = all "merge_into_series" for high-confidence (≥75)
 *   · default = all "create_new_in_series" for low-confidence (<75)
 *   · User can override per-row via inline dropdown
 *   · "[全部确认]" applies in one click
 *   · "[去 Cast 查看 →]" navigates to Step 3 after apply
 */
import { SelectField, Dialog, Button, LoadingState } from "@omnistudio/ui";
import { useEffect, useMemo, useState, useRef } from "react";
import { Check, X, Users, MapPin, Box, ArrowRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { api, type ReconcileSuggestion, type ReconcileAction } from "@/lib/api";
import ConfirmDialog from "@/components/shared/ConfirmDialog";
import WorkflowActionButton from "@/components/shared/WorkflowActionButton";

interface ReconcileModalProps {
    isOpen: boolean;
    scriptId: string | null;
    onClose: () => void;
    /** Called after successful apply. Frontend uses this to dispatch a
     *  navigateStep("cast") event if the user clicks "去 Cast 查看 →". */
    onApplied?: () => void;
}

type Kind = "character" | "scene" | "prop";

interface Row {
    kind: Kind;
    suggestion: ReconcileSuggestion;
    action: "merge_into_series" | "create_new_in_series" | "skip";
}

export default function ReconcileModal({ isOpen, scriptId, onClose, onApplied }: ReconcileModalProps) {
    const t = useTranslations("reconcile");
    const [rows, setRows] = useState<Row[] | null>(null);
    const [loading, setLoading] = useState(false);
    const [applying, setApplying] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const tc = useTranslations('common');
    const [reload, setReload] = useState(0);
    const [dirty, setDirty] = useState(false);
    const [confirmClose, setConfirmClose] = useState(false);
    const operation = useRef(false);
    const close = () => { if (operation.current) return; if (dirty) setConfirmClose(true); else onClose(); };
    // Fetch suggestions on open
    useEffect(() => {
        if (!isOpen || !scriptId) return;
        let cancelled = false;
        setLoading(true);
        setRows(null); setDirty(false); setConfirmClose(false);
        setError(null);
        api.getReconcileSuggestions(scriptId)
            .then(data => {
                if (cancelled) return;
                const init: Row[] = [];
                const seed = (kind: Kind, list: ReconcileSuggestion[]) => {
                    for (const s of list) {
                        init.push({
                            kind,
                            suggestion: s,
                            // Default: high-confidence (>=75) → merge; else → new
                            action: s.confidence >= 75 && s.suggested_series_id
                                ? "merge_into_series"
                                : "create_new_in_series",
                        });
                    }
                };
                seed("character", data.characters);
                seed("scene", data.scenes);
                seed("prop", data.props);
                setRows(init);
            })
            .catch(err => {
                if (cancelled) return;
                setError(err?.response?.data?.detail || err?.message || "Load failed");
            })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [isOpen, scriptId, reload]);

    const counts = useMemo(() => {
        const base = { total: 0, merge: 0, create: 0, skip: 0 };
        if (!rows) return base;
        base.total = rows.length;
        for (const r of rows) {
            if (r.action === "merge_into_series") base.merge++;
            else if (r.action === "create_new_in_series") base.create++;
            else base.skip++;
        }
        return base;
    }, [rows]);

    const handleSetAction = (idx: number, action: Row["action"]) => {
        setDirty(true);
        setRows(prev => prev?.map((r, i) => i === idx ? { ...r, action } : r) ?? null);
    };

    const buildPayload = (): { characters: ReconcileAction[]; scenes: ReconcileAction[]; props: ReconcileAction[] } => {
        const payload = { characters: [] as ReconcileAction[], scenes: [] as ReconcileAction[], props: [] as ReconcileAction[] };
        for (const r of rows ?? []) {
            const act: ReconcileAction = {
                local_id: r.suggestion.local_id,
                action: r.action,
                target_series_id: r.action === "merge_into_series" ? (r.suggestion.suggested_series_id ?? undefined) : undefined,
            };
            if (r.kind === "character") payload.characters.push(act);
            else if (r.kind === "scene") payload.scenes.push(act);
            else payload.props.push(act);
        }
        return payload;
    };

    const handleApply = async (navigateToCast: boolean) => {
        if (!scriptId || !rows || operation.current) return;
        operation.current = true;
        setApplying(true);
        setError(null);
        try {
            await api.applyReconcile(scriptId, buildPayload());
            onApplied?.();
            onClose();
            if (navigateToCast) {
                document.dispatchEvent(new CustomEvent("omni_studio:navigateStep", { detail: "cast" }));
            }
        } catch (err: any) {
            setError(err?.response?.data?.detail || err?.message || "Apply failed");
        } finally {
            operation.current = false;
            setApplying(false);
        }
    };

    return <><Dialog isOpen={isOpen} title={t('title')} closeLabel={tc('close')} isDismissable={!applying}
        onOpenChange={open => { if (!open) close(); }} className="!w-[min(850px,calc(100vw-2rem))] !max-w-none" footer={<>
                            <span className="flex-1 font-mono text-[0.65625rem] uppercase tracking-[0.16em] text-text-muted">
                                {counts.merge > 0 && <span className="text-primary mr-2">↳ {counts.merge} merge</span>}
                                {counts.create > 0 && <span className="text-pink-300 mr-2">+ {counts.create} new</span>}
                                {counts.skip > 0 && <span className="text-text-muted">⊘ {counts.skip} skip</span>}
                            </span>
                            <WorkflowActionButton
                                variant="ghost"
                                size="sm"
                                onClick={close} disabled={applying}
                            >
                                {t("cancel")}
                            </WorkflowActionButton>
                            <WorkflowActionButton
                                variant="secondary"
                                size="sm"
                                loading={applying}
                                onClick={() => handleApply(false)}
                                disabled={applying || loading || !rows || rows.length === 0}
                            >
                                {t("confirmAll")}
                            </WorkflowActionButton>
                            <WorkflowActionButton
                                variant="primary"
                                size="sm"
                                loading={applying}
                                rightIcon={<ArrowRight />}
                                onClick={() => handleApply(true)}
                                disabled={applying || loading || !rows || rows.length === 0}
                            >
                                {t("confirmAndGoCast")}
                            </WorkflowActionButton>
                        </>}>
        {error && <div role="alert">{error}{!rows && <Button onPress={() => setReload(n=>n+1)}>{tc('retry')}</Button>}</div>}
        <fieldset disabled={applying}>
                        {/* Body */}
                        <div className="flex-1 overflow-y-auto px-6 py-4 custom-scrollbar">
                            {loading ? (
                                <LoadingState label={t("loading")} />
                            ) : !rows || rows.length === 0 ? (
                                <p className="text-center text-text-muted py-12 text-sm">{t("noEntities")}</p>
                            ) : (
                                <div className="space-y-1.5">
                                    {rows.map((row, idx) => (
                                        <ReconcileRow
                                            key={`${row.kind}-${row.suggestion.local_id}`}
                                            row={row}
                                            onActionChange={(action) => handleSetAction(idx, action)}
                                        />
                                    ))}
                                </div>
                            )}
                        </div>

        </fieldset>
    </Dialog><ConfirmDialog open={confirmClose} title={tc('unsavedChangesTitle')} message={tc('unsavedChangesMessage')}
        confirmLabel={tc('discardChanges')} cancelLabel={tc('keepEditing')} onCancel={() => setConfirmClose(false)} onConfirm={() => { setConfirmClose(false); onClose(); }} /></>;
}

function ReconcileRow({ row, onActionChange }: { row: Row; onActionChange: (a: Row["action"]) => void }) {
    const t = useTranslations("reconcile");
    const Icon = row.kind === "character" ? Users : row.kind === "scene" ? MapPin : Box;
    const isHighConf = row.suggestion.confidence >= 75;
    const isMediumConf = row.suggestion.confidence > 0 && row.suggestion.confidence < 75;
    const conf = row.suggestion.confidence;
    return (
        <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-glass-border bg-glass">
            <Icon size={14} className="shrink-0 text-text-muted" />
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                    <span className="font-sans text-[0.8125rem] font-medium text-foreground truncate">{row.suggestion.local_name}</span>
                {row.suggestion.suggested_series_id && (
                        <>
                            <span className="font-mono text-[0.625rem] text-text-muted">→</span>
                            <span className={`font-sans text-[0.8125rem] truncate ${isHighConf ? 'text-foreground' : 'text-text-secondary'}`}>
                                {row.suggestion.suggested_series_name}
                            </span>
                            <span
                                className={`font-mono text-[0.59375rem] px-1.5 py-0.5 rounded-full ${
                                    isHighConf ? "bg-primary/15 text-primary" :
                                    isMediumConf ? "bg-amber-400/15 text-amber-300" :
                                    "bg-glass text-text-muted"
                                }`}
                            >
                                {conf}%
                            </span>
                        </>
                    )}
                    {!row.suggestion.suggested_series_id && (
                        <span className="font-mono text-[0.59375rem] px-1.5 py-0.5 rounded-full bg-pink-400/15 text-pink-300">
                            {t("new")}
                        </span>
                    )}
                </div>
                {row.suggestion.differences?.length ? (
                    <div className="mt-1 space-y-0.5 text-[0.6875rem] text-amber-200/80" aria-label={t("differences")}>
                        {row.suggestion.differences.map(difference => (
                            <p key={difference.field}>
                                {t(`difference_${difference.field}`)}: {difference.local_value || t("emptyValue")} → {difference.series_value || t("emptyValue")}
                            </p>
                        ))}
                    </div>
                ) : null}
            </div>
            {/* Action selector */}
            <div className="shrink-0">
                <SelectField label={row.suggestion.local_name} className="[&>label]:sr-only" value={row.action} onChange={value => onActionChange(value as Row["action"])}
                    options={[...(row.suggestion.suggested_series_id ? [{ id: "merge_into_series", label: t("actionMerge") }] : []), { id: "create_new_in_series", label: t("actionCreateNew") }, { id: "skip", label: t("actionSkip") }]} />
            </div>
            {/* Status checkmark */}
            <div className="shrink-0 w-5 grid place-items-center">
                {row.action !== "skip" ? (
                    <Check size={14} className={row.action === "merge_into_series" ? "text-primary" : "text-pink-300"} />
                ) : (
                    <X size={14} className="text-text-muted" />
                )}
            </div>
        </div>
    );
}
