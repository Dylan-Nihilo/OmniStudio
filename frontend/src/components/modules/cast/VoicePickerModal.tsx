"use client";
/**
 * VoicePickerModal — PR-3g Stage B #5
 *
 * Voice catalog picker for Cast character binding. Tabbed layout
 * (Q15.5 B + Q3 C):
 *   Tab 1 系统音色 — recommended (L1.5 gender-curated 4) + grouped
 *                   (CosyVoice / Qwen3 标准 / 方言 / 国际)
 *   Tab 2 我的复刻 — placeholder (PR-3h ships voice clone)
 *   Tab 3 我的设计 — placeholder (PR-3i ships voice design)
 *
 * Each voice card:
 *   - name + gender + dialect/lang tag
 *   - inline ▶ preview (calls api.previewVoice + plays audio)
 *   - selected state: primary border + ✓ corner
 *
 * Preview cache: backend memcache (md5 keyed) — first ▶ ~1-2s, repeats
 * instant. Only one audio plays at a time (selecting another voice
 * stops prior preview).
 *
 * Spec: r2v-workflow-v3-unified.md §4.2 + Q2-Q5 + Q15
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X, Play, Pause, Check, Sparkles, Loader2, Trash2 } from "lucide-react";
import { Button, Dialog } from "@omnistudio/ui";
import { useTranslations } from "next-intl";
import { api, type VoiceMeta, type CustomVoice, type VoiceRecommendation } from "@/lib/api";
import { getAssetUrl } from "@/lib/utils";
import ConfirmDialog from "@/components/shared/ConfirmDialog";
import VoiceCloneModal from "./VoiceCloneModal";
import VoiceDesignModal from "./VoiceDesignModal";

// L1.5 推荐: gender-based curated 4 voices (Q4 推荐)
// Hard-coded "通用最不会出错"组合。LLM-based L4 推荐 stub for future PR.
const RECOMMENDED_BY_GENDER: Record<string, string[]> = {
    Male: ["longcheng_v2", "longze_v2", "longshu_v2", "longxiaocheng_v2"],
    Female: ["longxiaochun_v2", "longyue_v2", "longfeifei_v2", "longwan_v2"],
};

interface VoicePickerModalProps {
    isOpen: boolean;
    onClose: () => void;
    characterName: string;
    characterGender?: string;
    /** Sample text override — pass character's actual dialogue when available
     *  (Q5 A3 preferred). When null/undefined, uses character-name template. */
    previewText?: string;
    currentVoiceId?: string;
    onApply: (voiceId: string, voiceName: string) => void | Promise<void>;
    /** PR-3h · Series id enables the 我的复刻 / 我的设计 tabs. When null,
     *  those tabs show "请先关联到系列" message (orphan projects). */
    seriesId?: string | null;
    /** PR-3i · Character description for 一键转 voice_prompt LLM helper. */
    characterDescription?: string;
}

type Tab = "system" | "clone" | "design";

export default function VoicePickerModal({
    isOpen,
    onClose,
    characterName,
    characterGender,
    previewText,
    currentVoiceId,
    onApply,
    seriesId,
    characterDescription,
}: VoicePickerModalProps) {
    const t = useTranslations("voicePicker");
    const tc = useTranslations("common");
    const [tab, setTab] = useState<Tab>("system");
    const [voices, setVoices] = useState<VoiceMeta[]>([]);
    const [recommendations, setRecommendations] = useState<VoiceRecommendation[]>([]);
    const [customVoices, setCustomVoices] = useState<CustomVoice[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [selectedId, setSelectedId] = useState<string | undefined>(currentVoiceId);
    const [playingId, setPlayingId] = useState<string | null>(null);
    const [previewingId, setPreviewingId] = useState<string | null>(null);
    const [cloneModalOpen, setCloneModalOpen] = useState(false);
    const [designModalOpen, setDesignModalOpen] = useState(false);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);
    const [deleteError, setDeleteError] = useState(false);
    const [applying, setApplying] = useState(false);
    const [applyError, setApplyError] = useState('');
    const [reload, setReload] = useState(0);
    const [confirmClose, setConfirmClose] = useState(false);
    const submitting = useRef(false);
    const close = () => { if (submitting.current) return; if (selectedId !== currentVoiceId) setConfirmClose(true); else onClose(); };
    const apply = async () => {
        if (!selectedId || submitting.current) return;
        submitting.current = true; setApplying(true); setApplyError('');
        try {
            const name = voices.find(v => v.id === selectedId)?.name || customVoices.find(v => v.id === selectedId)?.label || selectedId;
            await onApply(selectedId, name); onClose();
        } catch (e) { setApplyError(e instanceof Error ? e.message : tc('actionFailed')); }
        finally { submitting.current = false; setApplying(false); }
    };
    const audioRef = useRef<HTMLAudioElement | null>(null);

    // Sync selected when current changes / modal opens
    useEffect(() => {
        if (isOpen) setSelectedId(currentVoiceId);
    }, [isOpen, currentVoiceId]);

    // PR-3h · refresh custom voices list (called on open + after clone)
    const refreshCustomVoices = useCallback(async () => {
        if (!seriesId) return;
        try {
            const list = await api.listCustomVoices(seriesId);
            setCustomVoices(list);
        } catch (e) {
            console.error("Failed to load custom voices:", e);
        }
    }, [seriesId]);

    // Load voices once when modal opens
    useEffect(() => {
        if (!isOpen) return;
        let cancelled = false;
        setLoading(true);
        setError(null);
        Promise.all([
            api.getVoices(),
            seriesId ? api.listCustomVoices(seriesId) : Promise.resolve([]),
        ])
            .then(([vs, customs]) => {
                if (!cancelled) {
                    setVoices(vs);
                    setCustomVoices(customs);
                    if (api.recommendVoices) {
                        void api.recommendVoices({ character_gender: characterGender, character_description: characterDescription, preview_text: previewText, limit: 8 })
                            .then((result) => { if (!cancelled) setRecommendations(result.recommendations || []); })
                            .catch(() => { if (!cancelled) setRecommendations([]); });
                    }
                }
            })
            .catch((e) => { if (!cancelled) setError(e?.message || "Failed to load voices"); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [isOpen, seriesId, reload]);

    // PR-3h · handle clone result — refresh list + auto-select new clone
    const handleCloneCreated = async (newVoice: CustomVoice) => {
        await refreshCustomVoices();
        setSelectedId(newVoice.id);
        setTab("clone"); // ensure we're showing the clone tab so user sees their new voice
    };

    // PR-3i · handle design result — refresh list + auto-select new design
    const handleDesignCreated = async (newVoice: CustomVoice) => {
        await refreshCustomVoices();
        setSelectedId(newVoice.id);
        setTab("design");
    };

    // PR-3h · delete a custom voice (Tab 2/3 trash icon)
    const handleDeleteCustom = async () => {
        if (!seriesId || !deletingId || isDeleting) return;
        setIsDeleting(true);
        setDeleteError(false);
        try {
            await api.deleteCustomVoice(seriesId, deletingId);
            setCustomVoices(current => current.filter(voice => voice.id !== deletingId));
            if (selectedId === deletingId) setSelectedId(undefined);
            setDeletingId(null);
        } catch { setDeleteError(true); }
        finally { setIsDeleting(false); }
    };

    // Stop any in-flight audio when closing
    useEffect(() => {
        if (!isOpen && audioRef.current) {
            audioRef.current.pause();
            audioRef.current = null;
            setPlayingId(null);
        }
    }, [isOpen]);

    // Preview sample text — Q5 A2 fallback when character has no dialogue yet.
    // Prefer explicit previewText (Q5 A3); otherwise build from character name.
    const sampleText =
        previewText ||
        (characterName
            ? t("previewTextNamed", { name: characterName })
            : t("previewTextDefault"));

    // PR-3h · unified preview-by-id (works for both system VoiceMeta and CustomVoice)
    const handlePreviewById = async (voiceId: string) => {
        if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current = null;
            if (playingId === voiceId) {
                setPlayingId(null);
                return;  // toggle off
            }
            setPlayingId(null);
        }
        setPreviewingId(voiceId);
        try {
            const { url } = await api.previewVoice({
                voice_id: voiceId,
                text: sampleText,
            });
            const audio = new Audio(getAssetUrl(url));
            audio.onended = () => {
                setPlayingId(null);
                if (audioRef.current === audio) audioRef.current = null;
            };
            audio.onerror = () => {
                setPlayingId(null);
                setError(t("playFailed"));
            };
            audioRef.current = audio;
            setPlayingId(voiceId);
            await audio.play();
        } catch (e: any) {
            setError(e?.message || "Preview failed");
        } finally {
            setPreviewingId(null);
        }
    };

    const handlePreview = (voice: VoiceMeta) => handlePreviewById(voice.id);
    const handlePreviewCustom = (cv: CustomVoice) => handlePreviewById(cv.id);

    // L1.5 recommended subset based on character gender
    const recommended = useMemo<VoiceMeta[]>(() => {
        if (!voices.length) return [];
        if (recommendations.length) {
            return recommendations.map((recommendation) => voices.find((voice) => voice.id === recommendation.voice_id)).filter((voice): voice is VoiceMeta => !!voice);
        }
        const genderKey = characterGender === "Female" || characterGender === "女" || characterGender === "female"
            ? "Female"
            : characterGender === "Male" || characterGender === "男" || characterGender === "male"
                ? "Male"
                : null;
        if (!genderKey) {
            // No gender → show 4 curated male + 4 curated female mixed
            const ids = [...(RECOMMENDED_BY_GENDER.Male ?? []), ...(RECOMMENDED_BY_GENDER.Female ?? [])];
            return ids
                .map((id) => voices.find((v) => v.id === id))
                .filter((v): v is VoiceMeta => !!v);
        }
        return (RECOMMENDED_BY_GENDER[genderKey] ?? [])
            .map((id) => voices.find((v) => v.id === id))
            .filter((v): v is VoiceMeta => !!v);
    }, [voices, characterGender, recommendations]);

    const recommendationReasons = useMemo(
        () => new Map(recommendations.map((recommendation) => [
            recommendation.voice_id,
            recommendation.reasons.map((reason) => t(`recommendationReasons.${reason}`)),
        ])),
        [recommendations, t],
    );

    // Group system voices by sub-category for the catalog area
    const groups = useMemo(() => {
        const systemVoices = voices.filter((v) => v.origin === "system");
        const cosy = systemVoices.filter((v) => v.family === "cosyvoice");
        const qwenAudio = systemVoices.filter((v) => v.family === "qwen_audio");
        const qwenStandard = systemVoices.filter((v) => v.family === "qwen3" && !v.dialect && !v.lang_primary);
        const qwenDialect = systemVoices.filter((v) => v.family === "qwen3" && v.dialect);
        const qwenIntl = systemVoices.filter((v) => v.family === "qwen3" && v.lang_primary);
        return { cosy, qwenAudio, qwenStandard, qwenDialect, qwenIntl };
    }, [voices]);

    if (!isOpen) return null;

    return (
        <>
        <Dialog isOpen title={`${t('title')} — ${characterName}`} closeLabel={t('close')} isDismissable={!applying}
            className="!w-[min(900px,calc(100vw-2rem))] !max-w-none" onOpenChange={open => { if (!open) close(); }} footer={<>
                    <span className="font-mono text-[0.625rem] uppercase tracking-[0.14em] text-text-muted">
                        {selectedId
                            ? voices.find(v => v.id === selectedId)?.name || selectedId
                            : t("noSelection")}
                    </span>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={close} disabled={applying}
                            className="inline-flex items-center px-4 py-2 rounded-md bg-glass border border-glass-border text-text-secondary hover:text-foreground hover:bg-hover-bg transition-colors text-[0.75rem]"
                        >
                            {t("cancel")}
                        </button>
                        <button
                            onClick={() => void apply()}
                            disabled={applying || !selectedId || selectedId === currentVoiceId}
                            className="inline-flex items-center px-4 py-2 rounded-md bg-primary text-white border border-[rgba(100,108,255,0.65)] shadow-[inset_0_1.5px_0_rgba(255,255,255,0.14)] hover:bg-primary-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-[0.75rem] font-semibold"
                        >
                            {t("apply")}
                        </button>
                    </div>
                </>}>
            {applyError && <p role="alert">{applyError}</p>}
                {/* Tabs */}
                <div className="flex items-center gap-1 px-6 pt-3 border-b border-glass-border">
                    {[
                        { id: "system" as const, label: t("tabSystem") },
                        { id: "clone" as const, label: t("tabClone") },
                        { id: "design" as const, label: t("tabDesign") },
                    ].map((tabDef) => (
                        <button
                            key={tabDef.id}
                            onClick={() => setTab(tabDef.id)}
                            className={`relative px-3 pb-2 font-mono text-[0.6875rem] uppercase tracking-[0.16em] transition-colors ${
                                tab === tabDef.id
                                    ? "text-foreground"
                                    : "text-text-muted hover:text-text-secondary"
                            }`}
                        >
                            {tabDef.label}
                            {tab === tabDef.id && (
                                <span className="absolute bottom-0 left-2 right-2 h-px bg-primary" aria-hidden="true" />
                            )}
                        </button>
                    ))}
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto px-6 py-4 custom-scrollbar">
                    {loading && (
                        <div className="grid place-items-center py-12 text-text-muted">
                            <Loader2 className="animate-spin" size={20} />
                        </div>
                    )}
                    {error && (
                        <div className="rounded-md border border-status-failed-border bg-status-failed-bg p-3 text-body-sm text-status-failed-fg" role="alert">
                            {error}<Button variant="secondary" onPress={() => setReload(n => n + 1)}>{tc("retry")}</Button>
                        </div>
                    )}

                    {!loading && !error && tab === "system" && (
                        <div className="space-y-6">
                            {/* Recommended row */}
                            {recommended.length > 0 && (
                                <section>
                                    <h3 className="mb-2 flex items-center gap-2 font-mono text-[0.625rem] uppercase tracking-[0.18em] text-text-muted">
                                        <Sparkles size={11} className="text-primary" />
                                        {t("recommended")}
                                        <span className="text-text-muted/60">· {t("basedOnCharacter", { gender: characterGender || "?" })}</span>
                                    </h3>
                                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
                                        {recommended.map((v) => (
                                            <VoiceCard
                                                key={v.id}
                                                voice={v}
                                                selected={selectedId === v.id}
                                                playing={playingId === v.id}
                                                previewing={previewingId === v.id}
                                                onSelect={() => setSelectedId(v.id)}
                                                onPreview={() => handlePreview(v)}
                                                recommendationReasons={recommendationReasons.get(v.id)}
                                            />
                                        ))}
                                    </div>
                                </section>
                            )}

                            {/* Grouped catalog */}
                            <VoiceGroup label="Qwen Audio 3.0 Plus" voices={groups.qwenAudio} selectedId={selectedId} playingId={playingId} previewingId={previewingId} onSelect={setSelectedId} onPreview={handlePreview} recommendationReasons={recommendationReasons} />
                            <VoiceGroup label={t("groupCosyvoice")} voices={groups.cosy} selectedId={selectedId} playingId={playingId} previewingId={previewingId} onSelect={setSelectedId} onPreview={handlePreview} recommendationReasons={recommendationReasons} />
                            <VoiceGroup label={t("groupStandardZh")} voices={groups.qwenStandard} selectedId={selectedId} playingId={playingId} previewingId={previewingId} onSelect={setSelectedId} onPreview={handlePreview} recommendationReasons={recommendationReasons} />
                            <VoiceGroup label={t("groupDialect")} voices={groups.qwenDialect} selectedId={selectedId} playingId={playingId} previewingId={previewingId} onSelect={setSelectedId} onPreview={handlePreview} recommendationReasons={recommendationReasons} />
                            <VoiceGroup label={t("groupInternational")} voices={groups.qwenIntl} selectedId={selectedId} playingId={playingId} previewingId={previewingId} onSelect={setSelectedId} onPreview={handlePreview} recommendationReasons={recommendationReasons} />
                        </div>
                    )}

                    {!loading && !error && tab === "clone" && (
                        seriesId ? (
                            <CustomVoiceList
                                t={t}
                                voices={customVoices.filter((cv) => cv.origin === "clone")}
                                selectedId={selectedId}
                                playingId={playingId}
                                previewingId={previewingId}
                                onSelect={setSelectedId}
                                onPreview={(cv) => handlePreviewCustom(cv)}
                                onDelete={id => { setDeleteError(false); setDeletingId(id); }}
                                onCreate={() => setCloneModalOpen(true)}
                                createLabel={t("cloneCreateBtn")}
                                emptyTitle={t("cloneEmptyTitle")}
                                emptyBody={t("cloneEmptyBody")}
                            />
                        ) : (
                            <NeedsSeriesPlaceholder
                                title={t("cloneEmptyTitle")}
                                body={t("cloneNeedsSeries")}
                            />
                        )
                    )}

                    {!loading && !error && tab === "design" && (
                        seriesId ? (
                            <CustomVoiceList
                                t={t}
                                voices={customVoices.filter((cv) => cv.origin === "design")}
                                selectedId={selectedId}
                                playingId={playingId}
                                previewingId={previewingId}
                                onSelect={setSelectedId}
                                onPreview={(cv) => handlePreviewCustom(cv)}
                                onDelete={id => { setDeleteError(false); setDeletingId(id); }}
                                onCreate={() => setDesignModalOpen(true)}
                                createLabel={t("designCreateBtn")}
                                emptyTitle={t("designEmptyTitle")}
                                emptyBody={t("designEmptyBody")}
                            />
                        ) : (
                            <NeedsSeriesPlaceholder
                                title={t("designEmptyTitle")}
                                body={t("designNeedsSeries")}
                            />
                        )
                    )}
                </div>

        </Dialog>


            {seriesId && (
                <VoiceCloneModal
                    isOpen={cloneModalOpen}
                    onClose={() => setCloneModalOpen(false)}
                    seriesId={seriesId}
                    characterName={characterName}
                    characterDescription={characterDescription}
                    onCreated={handleCloneCreated}
                />
            )}
            {seriesId && (
                <VoiceDesignModal
                    isOpen={designModalOpen}
                    onClose={() => setDesignModalOpen(false)}
                    seriesId={seriesId}
                    characterName={characterName}
                    characterDescription={characterDescription}
                    onCreated={handleDesignCreated}
                />
            )}
            <ConfirmDialog open={confirmClose} title={tc("unsavedChangesTitle")} message={tc("unsavedChangesMessage")} confirmLabel={tc("discardChanges")} cancelLabel={tc("keepEditing")} onCancel={() => setConfirmClose(false)} onConfirm={onClose} />
            <Dialog isOpen={Boolean(deletingId)} className="voice-delete-confirmation" title={tc("delete")} closeLabel={tc("close")} isDismissable={!isDeleting}
                onOpenChange={open => { if (!open && !isDeleting) setDeletingId(null); }}
                footer={<><Button variant="secondary" isDisabled={isDeleting} onPress={() => setDeletingId(null)}>{tc("cancel")}</Button><Button variant="danger" isPending={isDeleting} onPress={() => void handleDeleteCustom()}>{tc("confirm")}</Button></>}>
                <p>{t("confirmDelete")}</p>
                {deleteError && <p role="alert" className="mt-3 text-sm text-status-failed-fg">{t("deleteFailed")}</p>}
            </Dialog>
        </>
    );
}

// ──────────────────────────────────────────────────────────────────
// Sub-components
// ──────────────────────────────────────────────────────────────────

function VoiceGroup({
    label,
    voices,
    selectedId,
    playingId,
    previewingId,
    onSelect,
    onPreview,
    recommendationReasons,
}: {
    label: string;
    voices: VoiceMeta[];
    selectedId?: string;
    playingId: string | null;
    previewingId: string | null;
    onSelect: (id: string) => void;
    onPreview: (voice: VoiceMeta) => void;
    recommendationReasons?: Map<string, string[]>;
}) {
    if (!voices.length) return null;
    return (
        <section>
            <h3 className="mb-2 flex items-center gap-2 font-mono text-[0.625rem] uppercase tracking-[0.18em] text-text-muted">
                {label} <span className="text-text-muted/60">({voices.length})</span>
            </h3>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
                {voices.map((v) => (
                    <VoiceCard
                        key={v.id}
                        voice={v}
                        selected={selectedId === v.id}
                        playing={playingId === v.id}
                        previewing={previewingId === v.id}
                        onSelect={() => onSelect(v.id)}
                        onPreview={() => onPreview(v)}
                        recommendationReasons={recommendationReasons?.get(v.id)}
                    />
                ))}
            </div>
        </section>
    );
}

function VoiceCard({
    voice,
    selected,
    playing,
    previewing,
    onSelect,
    onPreview,
    recommendationReasons,
}: {
    voice: VoiceMeta;
    selected: boolean;
    playing: boolean;
    previewing: boolean;
    onSelect: () => void;
    onPreview: () => void;
    recommendationReasons?: string[];
}) {
    return (
        <div
            onClick={onSelect}
            className={`relative cursor-pointer rounded-lg border p-3 transition-colors ${
                selected
                    ? "border-primary bg-[rgba(100,108,255,0.10)]"
                    : "border-glass-border bg-glass hover:border-foreground/30"
            }`}
        >
            <div className="flex items-start justify-between gap-2">
                <button type="button" aria-label={voice.name} aria-pressed={selected} onClick={event => { event.stopPropagation(); onSelect(); }} className="min-w-0 flex-1 text-left">
                    <p className="truncate text-[0.8125rem] font-medium text-foreground" title={voice.name}>
                        {voice.name}
                    </p>
                    <p className="mt-0.5 font-mono text-[0.59375rem] uppercase tracking-[0.14em] text-text-muted">
                        {voice.gender}
                        {voice.dialect ? ` · ${voice.dialect}` : ""}
                        {voice.lang_primary ? ` · ${voice.lang_primary}` : ""}
                        {voice.supports_instruction ? " · instr" : ""}
                    </p>
                    {recommendationReasons?.length ? <p className="mt-1 text-[0.625rem] text-primary/80">{recommendationReasons.join(" · ")}</p> : null}
                </button>
                <button
                    onClick={(e) => { e.stopPropagation(); onPreview(); }}
                    aria-label={playing ? "Stop preview" : "Play preview"}
                    className={`shrink-0 inline-flex h-7 w-7 items-center justify-center rounded-md border transition-colors ${
                        playing
                            ? "border-primary bg-primary/15 text-primary"
                            : "border-glass-border bg-black/30 text-text-secondary hover:border-foreground/30 hover:text-foreground"
                    }`}
                >
                    {previewing ? (
                        <Loader2 size={12} className="animate-spin" />
                    ) : playing ? (
                        <Pause size={12} />
                    ) : (
                        <Play size={12} />
                    )}
                </button>
            </div>
            {selected && (
                <div className="absolute top-1.5 right-1.5 grid h-5 w-5 place-items-center rounded-full bg-primary text-white">
                    <Check size={11} strokeWidth={2.5} />
                </div>
            )}
        </div>
    );
}

function NeedsSeriesPlaceholder({ title, body }: { title: string; body: string }) {
    return (
        <div className="grid place-items-center py-16 text-center">
            <Sparkles size={32} className="text-text-muted/40 mb-3" />
            <p className="text-foreground font-medium">{title}</p>
            <p className="mt-1 text-body-sm text-text-secondary max-w-md">{body}</p>
        </div>
    );
}

/** PR-3h · List of CustomVoices with create button + per-card delete. */
function CustomVoiceList({
    t,
    voices,
    selectedId,
    playingId,
    previewingId,
    onSelect,
    onPreview,
    onDelete,
    onCreate,
    createLabel,
    emptyTitle,
    emptyBody,
}: {
    t: (key: string) => string;
    voices: CustomVoice[];
    selectedId?: string;
    playingId: string | null;
    previewingId: string | null;
    onSelect: (id: string) => void;
    onPreview: (voice: CustomVoice) => void;
    onDelete: (id: string) => void;
    onCreate: () => void;
    createLabel: string;
    emptyTitle: string;
    emptyBody: string;
}) {
    return (
        <div className="space-y-4">
            {/* Create button (always visible at top) */}
            <button
                onClick={onCreate}
                className="w-full inline-flex items-center justify-center gap-2 rounded-lg border border-dashed border-primary/40 bg-primary/5 px-4 py-3 text-[0.8125rem] font-medium text-primary hover:bg-primary/10 hover:border-primary/60 transition-colors"
            >
                {createLabel}
            </button>

            {voices.length === 0 ? (
                <div className="grid place-items-center py-10 text-center">
                    <p className="text-foreground font-medium">{emptyTitle}</p>
                    <p className="mt-1 text-body-sm text-text-secondary max-w-md">{emptyBody}</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3">
                    {voices.map((cv) => {
                        const isSelected = selectedId === cv.id;
                        const isPlaying = playingId === cv.id;
                        const isPreviewing = previewingId === cv.id;
                        return (
                            <div
                                key={cv.id}
                                onClick={() => onSelect(cv.id)}
                                className={`relative cursor-pointer rounded-lg border p-3 transition-colors ${
                                    isSelected
                                        ? "border-primary bg-[rgba(100,108,255,0.10)]"
                                        : "border-glass-border bg-glass hover:border-foreground/30"
                                }`}
                            >
                                <div className="flex items-start justify-between gap-2">
                                    <button type="button" aria-label={cv.label} aria-pressed={isSelected} onClick={event => { event.stopPropagation(); onSelect(cv.id); }} className="min-w-0 flex-1 text-left">
                                        <p className="truncate text-[0.8125rem] font-medium text-foreground" title={cv.label}>
                                            {cv.label}
                                        </p>
                                        <p className="mt-0.5 font-mono text-[0.59375rem] uppercase tracking-[0.14em] text-text-muted">
                                            {cv.origin === "clone" ? t("originClone") : t("originDesign")}
                                            <span className="mx-1 text-text-muted/40">·</span>
                                            {cv.target_model}
                                        </p>
                                    </button>
                                    <div className="flex shrink-0 items-center gap-1">
                                        <button
                                            onClick={(e) => { e.stopPropagation(); onPreview(cv); }}
                                            aria-label="Play preview"
                                            className={`inline-flex h-7 w-7 items-center justify-center rounded-md border transition-colors ${
                                                isPlaying
                                                    ? "border-primary bg-primary/15 text-primary"
                                                    : "border-glass-border bg-black/30 text-text-secondary hover:border-foreground/30 hover:text-foreground"
                                            }`}
                                        >
                                            {isPreviewing ? <Loader2 size={12} className="animate-spin" /> : isPlaying ? <Pause size={12} /> : <Play size={12} />}
                                        </button>
                                        <button
                                            onClick={(e) => { e.stopPropagation(); onDelete(cv.id); }}
                                            aria-label="Delete custom voice"
                                            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-glass-border bg-black/30 text-text-muted hover:border-danger/40 hover:bg-danger/10 hover:text-danger transition-colors"
                                        >
                                            <Trash2 size={11} />
                                        </button>
                                    </div>
                                </div>
                                {isSelected && (
                                    <div className="absolute top-1.5 right-1.5 grid h-5 w-5 place-items-center rounded-full bg-primary text-white">
                                        <Check size={11} strokeWidth={2.5} />
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
