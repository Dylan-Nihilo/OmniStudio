"use client";
/**
 * PreviousEpisodeSummary — Script step right rail ("上回书说到 / Previously on...").
 *
 * Design v2 Phase 3 (docs/design/r2v-workflow-v2.md Q7-followup):
 *   · Dual title: 中文 "上回书说到" + 英文小标题 "Previously on..."
 *   · AI summary is *on-demand only* — user clicks button to spend LLM
 *     quota. Avoid silent autoload that drains user's quota.
 *   · Raw snippet (last ~600 chars of prev episode) shown immediately,
 *     zero-LLM, zero-wait.
 *   · Cache + invalidate via revision marker on prev episode's
 *     original_text. When stale, show "上一集已更新 [刷新]" hint.
 *   · Episode 1 / no-previous: placeholder "Episode 1 · The beginning".
 *
 * Phase 3 ships v1 scope; future v2 extensions noted in docs.
 */
import { useEffect, useState } from "react";
import { Sparkles, AlertCircle, ScrollText } from "lucide-react";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { useProjectStore } from "@/store/projectStore";
import SidePanelHeader from "@/components/shared/SidePanelHeader";
import { Button, EmptyState, LoadingState, TextAreaField } from "@omnistudio/ui";

interface PreviousEpisodeSummaryProps {
    scriptId: string | null;
}

interface SummaryState {
    has_previous: boolean;
    previous_episode_id: string | null;
    previous_episode_title: string | null;
    raw_snippet: string;
    ai_summary: string | null;
    ai_summary_stale: boolean;
}

export default function PreviousEpisodeSummary({ scriptId }: PreviousEpisodeSummaryProps) {
    const t = useTranslations("previousEpisode");
    const setRunningOp = useProjectStore((s) => s.setRunningOp);
    const hookGenerating = useProjectStore((s) => !!s.runningOps[`hookGen:${scriptId}`]);
    const generating = useProjectStore((s) => !!s.runningOps[`summaryGen:${scriptId}`]);
    const [data, setData] = useState<SummaryState | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    // R2V v2 P1-b — manual edit mode
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState("");
    const [savingEdit, setSavingEdit] = useState(false);

    // R2V v2 P2-b — Next-episode hook prediction state
    const [hookData, setHookData] = useState<{ has_text: boolean; hook: string | null; stale: boolean } | null>(null);
    const [hookEditing, setHookEditing] = useState(false);
    const [hookDraft, setHookDraft] = useState("");
    const [hookSaving, setHookSaving] = useState(false);

    useEffect(() => {
        if (!scriptId) return;
        let cancelled = false;
        api.getNextEpisodeHook(scriptId)
            .then(d => { if (!cancelled) setHookData(d); })
            .catch(() => { /* ignore — non-critical */ });
        return () => { cancelled = true; };
    }, [scriptId]);

    const handleGenerateHook = async () => {
        if (!scriptId) return;
        setRunningOp(`hookGen:${scriptId}`, true);
        try {
            const result = await api.generateNextEpisodeHook(scriptId);
            setHookData(prev => prev ? { ...prev, hook: result.hook, stale: false } : prev);
        } catch (err: any) {
            setError(err?.response?.data?.detail || err?.message || "Generate failed");
        } finally {
            setRunningOp(`hookGen:${scriptId}`, false);
        }
    };

    useEffect(() => {
        if (!scriptId) return;
        let cancelled = false;
        setLoading(true);
        setError(null);
        api.getPreviousEpisodeSummary(scriptId)
            .then(d => { if (!cancelled) setData(d); })
            .catch(err => {
                if (cancelled) return;
                setError(err?.response?.data?.detail || err?.message || "Load failed");
            })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [scriptId]);

    const handleGenerate = async () => {
        if (!scriptId) return;
        setRunningOp(`summaryGen:${scriptId}`, true);
        setError(null);
        try {
            const result = await api.generatePreviousEpisodeSummary(scriptId);
            setData(prev => prev ? { ...prev, ai_summary: result.ai_summary, ai_summary_stale: false } : prev);
        } catch (err: any) {
            setError(err?.response?.data?.detail || err?.message || "Generate failed");
        } finally {
            setRunningOp(`summaryGen:${scriptId}`, false);
        }
    };

    return (
        <div className="flex h-full w-full flex-col overflow-hidden border-l border-glass-border bg-surface">
            {/* Dual-title header: 中文 main + 英文 mono subtitle */}
            <SidePanelHeader
                icon={<ScrollText />}
                title={t("titleZh")}
                subtitle={t("titleEn")}
            />

            <div className="flex-1 overflow-y-auto custom-scrollbar">
                {loading ? (
                    <LoadingState label={t("loading")} />
                ) : error ? (
                    <div className="p-6">
                        <div className="rounded-lg border border-status-failed-border/40 bg-status-failed-bg/50 px-4 py-3 flex items-start gap-2.5">
                            <AlertCircle size={14} className="text-status-failed-fg shrink-0 mt-0.5" />
                            <div>
                                <p className="text-[0.78125rem] text-status-failed-fg font-medium">{t("loadFailed")}</p>
                                <p className="text-[0.6875rem] text-status-failed-fg/80 mt-1 break-all">{error}</p>
                            </div>
                        </div>
                    </div>
                ) : !data || !data.has_previous ? (
                    // Episode 1 placeholder — but still render the
                    // forward-looking hook section since it depends on
                    // THIS episode's text, not the previous one.
                    <div className="flex flex-col">
                        <div className="py-12">
                            <EmptyState title={t("firstEpisodeTitle")} description={t("firstEpisodeBody")} />
                        </div>
                        <div className="px-5 pb-5">
                            <NextHookSection
                                hookData={hookData}
                                generating={hookGenerating}
                                editing={hookEditing}
                                draft={hookDraft}
                                saving={hookSaving}
                                onGenerate={handleGenerateHook}
                                onEditStart={() => { setHookDraft(hookData?.hook || ""); setHookEditing(true); }}
                                onEditCancel={() => setHookEditing(false)}
                                onDraftChange={setHookDraft}
                                onSave={async () => {
                                    if (!scriptId) return;
                                    setHookSaving(true);
                                    try {
                                        await api.updateNextEpisodeHook(scriptId, hookDraft.trim() || null);
                                        setHookData(prev => prev ? { ...prev, hook: hookDraft.trim() || null, stale: false } : prev);
                                        setHookEditing(false);
                                    } catch (err: any) {
                                        setError(err?.response?.data?.detail || err?.message || "Save failed");
                                    } finally { setHookSaving(false); }
                                }}
                            />
                        </div>
                    </div>
                ) : (
                    <div className="px-5 py-5 space-y-5">
                        {/* Previous episode meta */}
                        <div className="flex items-center gap-2 text-[0.6875rem] font-mono uppercase tracking-[0.16em] text-text-muted">
                            <span className="text-primary">PREV</span>
                            <span aria-hidden="true" className="h-px w-2 bg-glass-border" />
                            <span className="truncate text-text-secondary">{data.previous_episode_title || data.previous_episode_id}</span>
                        </div>

                        {/* AI summary section — collapsed by default, user opts in */}
                        <section className="space-y-2">
                            <div className="flex items-center justify-between gap-2">
                                <h4 className="font-mono text-[0.625rem] font-medium uppercase tracking-[0.18em] text-text-muted inline-flex items-center gap-1.5">
                                    <Sparkles size={11} />
                                    {t("aiSummary")}
                                </h4>
                                {data.ai_summary && data.ai_summary_stale && (
                                    <span className="font-mono text-[0.59375rem] uppercase tracking-[0.14em] text-status-pending-fg">
                                        {t("stale")}
                                    </span>
                                )}
                            </div>
                            {!data.ai_summary ? (
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    isPending={generating}
                                    onPress={handleGenerate}
                                    className="w-full justify-center"
                                >
                                    {t("generateBtn")}
                                </Button>
                            ) : editing ? (
                                <div className="rounded-lg border border-glass-border bg-elevated px-3.5 py-3 space-y-2">
                                    <TextAreaField label={t("editPlaceholder")} value={draft} onChange={setDraft} rows={6} autoFocus isDisabled={savingEdit} />
                                    <div className="flex items-center justify-end gap-2">
                                        <Button
                                            variant="quiet"
                                            size="sm"
                                            isDisabled={savingEdit} onPress={() => { setEditing(false); setDraft(data.ai_summary || ""); }}
                                        >
                                            {t("editCancel")}
                                        </Button>
                                        <Button
                                            variant="primary"
                                            size="sm"
                                            isPending={savingEdit}
                                            onPress={async () => {
                                                if (!scriptId) return;
                                                setSavingEdit(true);
                                                try {
                                                    await api.updateLastEpisodeSummary(scriptId, draft.trim() || null);
                                                    setData(prev => prev ? { ...prev, ai_summary: draft.trim() || null, ai_summary_stale: false } : prev);
                                                    setEditing(false);
                                                } catch (err: any) {
                                                    setError(err?.response?.data?.detail || err?.message || "Save failed");
                                                } finally { setSavingEdit(false); }
                                            }}
                                        >
                                            {t("editSave")}
                                        </Button>
                                    </div>
                                </div>
                            ) : (
                                <div className="rounded-lg border border-glass-border bg-elevated px-3.5 py-3 space-y-2 group/summary">
                                    <p className="text-[0.8125rem] leading-relaxed text-foreground whitespace-pre-wrap">
                                        {data.ai_summary}
                                    </p>
                                    <div className="flex items-center justify-between gap-2">
                                        {data.ai_summary_stale ? (
                                            <Button
                                                variant="quiet"
                                                size="sm"
                                                isPending={generating}
                                                onPress={handleGenerate}
                                            >
                                                {t("refreshBtn")}
                                            </Button>
                                        ) : <span />}
                                        <Button
                                            variant="quiet"
                                            size="sm"
                                            onPress={() => { setDraft(data.ai_summary || ""); setEditing(true); }}
                                        >
                                            {t("editBtn")}
                                        </Button>
                                    </div>
                                </div>
                            )}
                        </section>

                        {/* Raw snippet — always shown, zero-cost */}
                        <section className="space-y-2">
                            <h4 className="font-mono text-[0.625rem] font-medium uppercase tracking-[0.18em] text-text-muted">
                                {t("rawSnippet")}
                            </h4>
                            <div className="rounded-lg border border-glass-border bg-surface px-3.5 py-3">
                                <p className="text-[0.78125rem] leading-relaxed text-text-secondary whitespace-pre-wrap font-mono">
                                    …{data.raw_snippet}
                                </p>
                            </div>
                        </section>

                        {/* R2V v2 P2-b — Hook for next episode */}
                        <NextHookSection
                            hookData={hookData}
                            generating={hookGenerating}
                            editing={hookEditing}
                            draft={hookDraft}
                            saving={hookSaving}
                            onGenerate={handleGenerateHook}
                            onEditStart={() => { setHookDraft(hookData?.hook || ""); setHookEditing(true); }}
                            onEditCancel={() => setHookEditing(false)}
                            onDraftChange={setHookDraft}
                            onSave={async () => {
                                if (!scriptId) return;
                                setHookSaving(true);
                                try {
                                    await api.updateNextEpisodeHook(scriptId, hookDraft.trim() || null);
                                    setHookData(prev => prev ? { ...prev, hook: hookDraft.trim() || null, stale: false } : prev);
                                    setHookEditing(false);
                                } catch (err: any) {
                                    setError(err?.response?.data?.detail || err?.message || "Save failed");
                                } finally { setHookSaving(false); }
                            }}
                        />
                    </div>
                )}
            </div>
        </div>
    );
}

interface NextHookSectionProps {
    hookData: { has_text: boolean; hook: string | null; stale: boolean } | null;
    generating: boolean;
    editing: boolean;
    draft: string;
    saving: boolean;
    onGenerate: () => void;
    onEditStart: () => void;
    onEditCancel: () => void;
    onDraftChange: (v: string) => void;
    onSave: () => void;
}

function NextHookSection({ hookData, generating, editing, draft, saving, onGenerate, onEditStart, onEditCancel, onDraftChange, onSave }: NextHookSectionProps) {
    const t = useTranslations("nextHook");
    if (!hookData?.has_text) {
        // No script text yet — don't render the hook section
        return null;
    }
    return (
        <section className="space-y-2 pt-4 border-t border-glass-border">
            <div className="flex items-center justify-between gap-2">
                <h4 className="font-mono text-[0.625rem] font-medium uppercase tracking-[0.18em] text-primary inline-flex items-center gap-1.5">
                    <Sparkles size={11} />
                    {t("title")}
                </h4>
                {hookData.hook && hookData.stale && (
                    <span className="font-mono text-[0.59375rem] uppercase tracking-[0.14em] text-status-pending-fg">
                        {t("stale")}
                    </span>
                )}
            </div>
            <p className="text-[0.6875rem] text-text-muted leading-relaxed">{t("subtitle")}</p>
            {!hookData.hook && !editing ? (
                <Button
                    variant="secondary"
                    size="sm"
                    isPending={generating}
                    onPress={onGenerate}
                    className="w-full justify-center"
                >
                    {t("generateBtn")}
                </Button>
            ) : editing ? (
                <div className="rounded-lg border border-glass-border bg-elevated px-3.5 py-3 space-y-2">
                    <TextAreaField label={t("editPlaceholder")} value={draft} onChange={onDraftChange} rows={5} autoFocus isDisabled={saving} />
                    <div className="flex items-center justify-end gap-2">
                        <Button variant="quiet" size="sm" isDisabled={saving} onPress={onEditCancel}>
                            {t("editCancel")}
                        </Button>
                        <Button variant="primary" size="sm" isPending={saving} onPress={onSave}>
                            {t("editSave")}
                        </Button>
                    </div>
                </div>
            ) : (
                <div className="rounded-lg border border-glass-border bg-elevated px-3.5 py-3 space-y-2">
                    <p className="text-[0.8125rem] leading-relaxed text-foreground whitespace-pre-wrap">
                        {hookData.hook}
                    </p>
                    <div className="flex items-center justify-between gap-2">
                        {hookData.stale ? (
                            <Button variant="quiet" size="sm" isPending={generating} onPress={onGenerate}>
                                {t("refreshBtn")}
                            </Button>
                        ) : <span />}
                        <Button variant="quiet" size="sm" onPress={onEditStart}>
                            {t("editBtn")}
                        </Button>
                    </div>
                </div>
            )}
        </section>
    );
}

