"use client";
/**
 * CastWorkbenchModal — generate / iterate / pick the reference image for a
 * single Cast entity (character | scene | prop).
 *
 * Design intent (per design grill 2026-05-26):
 *   · One prompt — the legacy headshot/full_body/three_view triplet is fused
 *     into a single 'character reference sheet' composition for characters.
 *     Scenes and props each have their own template too.
 *   · Prompt template is pre-filled (entity name + entity description +
 *     composition guidance) but fully editable. The art-direction style is
 *     shown read-only above the textarea since it gets concatenated by
 *     the backend (apply_style=true).
 *   · Generated variants land in a side gallery; clicking one selects it
 *     as the entity's reference image (calls selectAssetVariant). Multiple
 *     re-rolls accumulate so the user can compare.
 *   · Per-project toast surfaces success/error across the long round-trip
 *     (asset generation can take 20-60s).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { X, Sparkles, Loader2, Check, RefreshCw, Wand2, Palette, Star } from "lucide-react";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { useProjectStore, IMAGE_MODELS } from "@/store/projectStore";
import { toast } from "@/store/toastStore";
import { getAssetUrl } from "@/lib/utils";
import PreviewImage from "@/components/shared/preview/PreviewImage";
import GroupedModelGrid from "@/components/common/GroupedModelGrid";

export type CastKind = "character" | "scene" | "prop";

// Module-level poll registry — survives modal close/reopen.
export const activePolls = new Map<string, ReturnType<typeof setInterval>>();

export const getCastPromptTextareaClasses = () =>
    "w-full min-h-[260px] max-h-[400px] rounded-md border border-glass-border bg-input-bg px-3.5 py-2.5 text-[0.875rem] text-foreground placeholder:text-text-muted focus:outline-none focus:border-primary/40 disabled:cursor-wait disabled:bg-surface-inset disabled:text-text-secondary disabled:opacity-100 resize-y leading-relaxed";

function startAssetPoll(
    entityId: string,
    taskId: string,
    projectId: string,
    kind: CastKind,
    generationType: string,
    t: ReturnType<typeof useTranslations<"castWorkbench">>,
    getStore: () => {
        updateProject: (id: string, data: any) => void;
        removeGeneratingTask: (assetId: string, generationType: string) => void;
    },
    progressToastId?: string,
) {
    if (activePolls.has(entityId)) return;
    const interval = setInterval(async () => {
        try {
            const status = await api.getTaskStatus(taskId);
            if (status?.status === "completed") {
                clearInterval(interval);
                activePolls.delete(entityId);
                if (progressToastId) toast.dismiss(progressToastId);
                const fresh = await api.getProject(projectId);
                const { updateProject, removeGeneratingTask } = getStore();
                updateProject(projectId, fresh);
                removeGeneratingTask(entityId, generationType);
                const entityPool = (kind === "character" ? fresh.characters : kind === "scene" ? fresh.scenes : fresh.props) || [];
                const updatedEntity = entityPool.find((e: any) => e.id === entityId);
                const count = updatedEntity ? readVariants(updatedEntity, kind).length : 0;
                toast.success(t("toastVariantDone"), { body: t("toastVariantDoneBody", { count }) });
            } else if (status?.status === "failed") {
                clearInterval(interval);
                activePolls.delete(entityId);
                if (progressToastId) toast.dismiss(progressToastId);
                const { removeGeneratingTask } = getStore();
                removeGeneratingTask(entityId, generationType);
                toast.error(t("toastGenErr"), { body: status?.error || t("toastGenErrUnknown") });
            }
        } catch (err) {
            clearInterval(interval);
            activePolls.delete(entityId);
            if (progressToastId) toast.dismiss(progressToastId);
            const { removeGeneratingTask } = getStore();
            removeGeneratingTask(entityId, generationType);
            toast.error(t("toastPollErr"), { body: t("toastPollErrBody") });
        }
    }, 2500);
    activePolls.set(entityId, interval);
}

interface CastWorkbenchModalProps {
    isOpen: boolean;
    kind: CastKind | null;
    entityId: string | null;
    onClose: () => void;
}

interface ImageVariant {
    id: string;
    url: string;
    is_favorited?: boolean;
}

type CharacterTemplate = "simple" | "detailed" | "design_sheet";

const CHARACTER_TEMPLATES: Record<CharacterTemplate, {
    labelKey: string;
    descKey: string;
    compositionEn: string;
    negativeAppend: string;
    comingSoon?: boolean;
    exampleImage?: string;
}> = {
    simple: {
        labelKey: "tplSimpleLabel",
        descKey: "tplSimpleDesc",
        compositionEn: "Composition: character reference sheet, single unified image, seamless layout without borders or frames, neutral gray background. Left half: large head close-up portrait (shoulders up, sharp facial details, front-facing, detailed skin texture). Right half: three equally-sized full-body standing poses arranged side by side (front view, side view, back view), head-to-toe fully visible, relaxed neutral pose. Consistent soft studio lighting across all views, no harsh shadows, even illumination.",
        negativeAppend: "text, labels, watermark, UI overlay, panel borders, frames, multiple separate images",
        exampleImage: "/assets/templates/simple-triview.png",
    },
    detailed: {
        labelKey: "tplDetailedLabel",
        descKey: "tplDetailedDesc",
        compositionEn: "Composition: detailed character reference sheet, single unified image, seamless layout without borders or frames, neutral gray background. Left section: three full-body standing views side by side (front / side / back), head-to-toe visible, neutral relaxed pose. Upper right: large face close-up portrait (shoulders up, detailed skin texture, sharp eyes, pores visible). Lower right: three smaller head shots showing different angles (front, three-quarter, profile). Consistent soft studio lighting, no harsh shadows, even illumination across all panels.",
        negativeAppend: "text, labels, watermark, UI overlay, panel borders, frames, multiple separate images",
        exampleImage: "/assets/templates/detailed-reference.png",
    },
    design_sheet: {
        labelKey: "tplDesignSheetLabel",
        descKey: "tplDesignSheetDesc",
        compositionEn: "Composition: professional character design sheet, single unified image with dark cyberpunk-themed background (deep blue-black with subtle neon circuit patterns). Layout divided into labeled panels with thin border frames: - Top left: large dramatic character portrait (bust shot, three-quarter angle, moody rim lighting, glowing blue cybernetic eye) - Center: three full-body standing views (front / side / back) with labels \"正面\" \"侧面\" \"背面\" - Top right: 4 expression close-ups in a row (neutral, smirking, intense focus, combat rage), labeled \"表情特写\" - Bottom left: 3-4 detail close-up panels showing cybernetic eye mechanism, neck circuit tattoo, armor texture, weapon holster, labeled \"细节特写\" - Bottom right: character info panel with dark translucent background containing text fields (name, age, traits, abilities). Cinematic lighting, high detail, concept art quality, game character sheet aesthetic.",
        negativeAppend: "watermark, UI overlay, signature, low quality, distorted anatomy, multiple separate images",
        comingSoon: true,
        exampleImage: "/assets/templates/design-sheet.png",
    },
};

function buildTemplate(kind: CastKind, entity: any, template?: CharacterTemplate): string {
    const name = entity?.name || "";
    const desc = entity?.description || "";
    const charDesc = `${name}${desc ? "，" + desc : ""}`;

    if (kind === "character") {
        const tpl = CHARACTER_TEMPLATES[template || "simple"];
        return `${charDesc}\n\n${tpl.compositionEn}`;
    }
    if (kind === "scene") {
        return `${name}${desc ? "：" + desc : ""}\n\nComposition: wide establishing shot of the environment on neutral gray background, single unified image, no figures in foreground. Emphasize atmosphere, architecture and terrain structure. Lighting and color palette match the scene mood. Soft volumetric lighting, depth of field.`;
    }
    return `${name}${desc ? "：" + desc : ""}\n\nComposition: product photography style on neutral gray background, single unified image, seamless layout without borders. Main view: object centered at slight angle. Secondary views: detail close-ups of material and texture. Clean even studio lighting, subtle shadow beneath object.`;
}

function getTemplateNegative(kind: CastKind, template?: CharacterTemplate): string {
    if (kind === "character") {
        const tpl = CHARACTER_TEMPLATES[template || "simple"];
        return tpl.negativeAppend;
    }
    return "text, labels, watermark, UI overlay, panel borders, frames";
}

/** Variants live in different slots depending on kind + legacy schema:
 *  · character → reference_sheet.image_variants (new) or full_body_asset.variants (legacy)
 *  · scene → image_asset.variants
 *  · prop → image_asset.variants
 *  Returns a normalized [{id, url, is_favorited?}] list. */
function readVariants(entity: any, kind: CastKind): ImageVariant[] {
    if (!entity) return [];
    if (kind === "character") {
        const sheet = entity?.reference_sheet?.image_variants ?? [];
        if (sheet.length > 0) {
            return sheet.map((v: any) => ({ id: v.id, url: v.url, is_favorited: v.is_favorited }));
        }
        const legacy = entity?.full_body_asset?.variants ?? [];
        return legacy.map((v: any) => ({ id: v.id, url: v.url, is_favorited: v.is_favorited }));
    }
    const arr = entity?.image_asset?.variants ?? [];
    return arr.map((v: any) => ({ id: v.id, url: v.url, is_favorited: v.is_favorited }));
}

function readSelectedId(entity: any, kind: CastKind): string | null {
    if (!entity) return null;
    if (kind === "character") {
        return entity?.reference_sheet?.selected_image_id
            ?? entity?.full_body_asset?.selected_id
            ?? null;
    }
    return entity?.image_asset?.selected_id ?? null;
}

export default function CastWorkbenchModal({ isOpen, kind, entityId, onClose }: CastWorkbenchModalProps) {
    const t = useTranslations("castWorkbench");
    const currentProject = useProjectStore((state) => state.currentProject);
    const currentSeries = useProjectStore((state) => state.currentSeries);
    const allProjects = useProjectStore((state) => state.projects);
    const updateProject = useProjectStore((state) => state.updateProject);
    const generatingTasks = useProjectStore((state) => state.generatingTasks);
    const addGeneratingTask = useProjectStore((state) => state.addGeneratingTask);
    const removeGeneratingTask = useProjectStore((state) => state.removeGeneratingTask);

    // Look up the live entity from the store so it stays in sync after
    // generation calls patch the project.
    const entity = useMemo(() => {
        if (!entityId || !kind || !currentProject) return null;
        const pool: any[] = kind === "character"
            ? currentProject.characters || []
            : kind === "scene"
                ? currentProject.scenes || []
                : currentProject.props || [];
        return pool.find((e: any) => e.id === entityId) ?? null;
    }, [currentProject, entityId, kind]);

    const variants = useMemo(() => readVariants(entity, kind ?? "character"), [entity, kind]);
    const selectedId = useMemo(() => readSelectedId(entity, kind ?? "character"), [entity, kind]);

    const [prompt, setPrompt] = useState("");
    const [batchSize, setBatchSize] = useState(2);
    const [aspectRatioOverride, setAspectRatioOverride] = useState<string | null>(null);
    const [modelOverride, setModelOverride] = useState<string | null>(null);
    const [positiveExpanded, setPositiveExpanded] = useState(false);
    const [negativeExpanded, setNegativeExpanded] = useState(false);
    const [finalPreviewExpanded, setFinalPreviewExpanded] = useState(true);
    const [applyStyle, setApplyStyle] = useState(true);
    const [galleryFilter, setGalleryFilter] = useState<"all" | "favorited">("all");
    const generating = generatingTasks.some((t) => t.assetId === entityId);
    // Effective t2i model — drives the "design_sheet" template gating: that
    // template only works with gpt-image-2, so it stays locked unless the
    // user has selected gpt-image-2 (override or project default).
    const selectedModelId = modelOverride || currentProject?.model_settings?.t2i_model || "wan2.1-t2i";
    const isGptImage2 = selectedModelId === "gpt-image-2";
    const [selectedTemplate, setSelectedTemplate] = useState<CharacterTemplate>("simple");
    const [pendingTemplate, setPendingTemplate] = useState<CharacterTemplate | null>(null);
    const [promptDirty, setPromptDirty] = useState(false);
    const lastSeededEntityId = useRef<string | null>(null);
    const overlayMouseDown = useRef(false);

    // Reset prompt to template ONLY when the entity changes (not on every
    // open) so the user's in-flight edits aren't clobbered if they happen
    // to flip the modal closed and back. Clearing happens via the reset
    // button or kind/entity switch.
    useEffect(() => {
        if (!isOpen || !entity || !kind) return;
        if (lastSeededEntityId.current !== entity.id) {
            setPrompt(buildTemplate(kind, entity, selectedTemplate));
            setPromptDirty(false);
            lastSeededEntityId.current = entity.id;
        }
    }, [isOpen, entity, kind, selectedTemplate]);

    const [presets, setPresets] = useState<any[]>([]);
    useEffect(() => {
        api.getStylePresets().then((res: any) => setPresets(res?.presets || res || [])).catch(() => {});
    }, []);

    if (!isOpen || !kind || !entity || !currentProject) return null;

    const resolvedArtDirection = currentProject.art_direction ?? currentSeries?.art_direction;
    const styleConfig = resolvedArtDirection?.style_config;
    const styleName = styleConfig?.name || "";
    const styleNegative = styleConfig?.negative_prompt || "";
    // Resolve positive_prompt with preset fallback (series data often omits it)
    let stylePositive = styleConfig?.positive_prompt || "";
    if (!stylePositive && styleConfig?.id && presets.length > 0) {
        const match = presets.find((p: any) => p.id === styleConfig.id);
        if (match) stylePositive = match.prompt || match.positive_prompt || "";
    }

    const ms = currentProject.model_settings;
    const defaultAspectRatio = kind === "character"
        ? (ms?.character_aspect_ratio || "9:16")
        : kind === "scene"
            ? (ms?.scene_aspect_ratio || "16:9")
            : (ms?.prop_aspect_ratio || "1:1");
    const effectiveAspectRatio = aspectRatioOverride || defaultAspectRatio;

    const handleResetTemplate = () => {
        setPrompt(buildTemplate(kind, entity, selectedTemplate));
        setPromptDirty(false);
    };

    const handleTemplateSwitch = (tpl: CharacterTemplate) => {
        if (tpl === selectedTemplate) return;
        // design_sheet (comingSoon) is gated on gpt-image-2 — the button
        // unlocks when isGptImage2, so allow the switch too.
        if (CHARACTER_TEMPLATES[tpl].comingSoon && !isGptImage2) return;
        if (promptDirty) {
            setPendingTemplate(tpl);
        } else {
            setSelectedTemplate(tpl);
            setPrompt(buildTemplate(kind, entity, tpl));
            setPromptDirty(false);
        }
    };

    const confirmTemplateSwitch = () => {
        if (!pendingTemplate) return;
        setSelectedTemplate(pendingTemplate);
        setPrompt(buildTemplate(kind, entity, pendingTemplate));
        setPromptDirty(false);
        setPendingTemplate(null);
    };

    const cancelTemplateSwitch = () => {
        setPendingTemplate(null);
    };

    const handleGenerate = async () => {
        if (!prompt.trim()) {
            toast.warning(t("toastPromptEmpty"), {
                projectId: currentProject.id,
                projectTitle: currentProject.title,
            });
            return;
        }
        // Refresh project + validate the entity still exists backend-side
        // before submitting. The store can hold a stale character that was
        // deleted server-side, which makes generateAsset 404 with
        // "Character {id} not found". Syncing here both prevents the 404
        // and self-heals the store so the stale card disappears.
        try {
            const fresh = await api.getProject(currentProject.id);
            const pool = kind === "character" ? fresh.characters : kind === "scene" ? fresh.scenes : fresh.props;
            if (!Array.isArray(pool) || !pool.some((e: any) => e.id === entity.id)) {
                toast.error(t("toastEntityGone"), {
                    projectId: currentProject.id,
                    projectTitle: currentProject.title,
                });
                updateProject(currentProject.id, fresh);
                onClose();
                return;
            }
            updateProject(currentProject.id, fresh);
        } catch {
            // Refresh failed — proceed with cached data; backend will reject
            // if the entity truly is stale and the poll surfaces the error.
        }
        const effectiveBatchSize = Math.max(1, Math.min(4, batchSize));
        addGeneratingTask(entity.id, kind === "character" ? "reference_sheet" : "all", effectiveBatchSize);

        const progressId = toast.progress(t("toastGenStart", { kind: t(`kind.${kind}`) }), {
            projectId: currentProject.id,
            projectTitle: currentProject.title,
            body: t("toastGenStartBody"),
        });

        try {
            const resp = await api.generateAsset(
                currentProject.id,
                entity.id,
                kind,
                currentProject.style_preset || "realistic",
                applyStyle ? stylePositive : "",
                kind === "character" ? "reference_sheet" : "all",
                prompt.trim(),
                applyStyle,
                [applyStyle ? styleNegative : "", getTemplateNegative(kind, selectedTemplate)].filter(Boolean).join(", "),
                effectiveBatchSize,
                modelOverride || currentProject.model_settings?.t2i_model,
                aspectRatioOverride || undefined,
            );

            const taskId = (resp as any)?._task_id;
            if (taskId) {
                const capturedEntityId = entity.id;
                const capturedKind = kind;
                const capturedProjectId = currentProject.id;
                startAssetPoll(capturedEntityId, taskId, capturedProjectId, capturedKind, kind === "character" ? "reference_sheet" : "all", t, () => ({
                    updateProject: useProjectStore.getState().updateProject,
                    removeGeneratingTask: useProjectStore.getState().removeGeneratingTask,
                }), progressId);
            } else if (resp) {
                toast.dismiss(progressId);
                updateProject(currentProject.id, resp);
                removeGeneratingTask(entity.id, kind === "character" ? "reference_sheet" : "all");
                toast.success(t("toastGenDone", { kind: t(`kind.${kind}`) }));
            }
        } catch (err: any) {
            toast.dismiss(progressId);
            removeGeneratingTask(entity.id, kind === "character" ? "reference_sheet" : "all");
            const detail = err?.response?.data?.detail || err?.message || t("toastGenErrUnknown");
            toast.error(t("toastGenErr"), { body: String(detail) });
        }
    };

    const handleSelectVariant = async (variantId: string) => {
        try {
            const updated = await api.selectAssetVariant(
                currentProject.id,
                entity.id,
                kind,
                variantId,
            );
            updateProject(currentProject.id, updated);
            toast.success(t("toastSelected"), {
                projectId: currentProject.id,
                projectTitle: currentProject.title,
                autoCloseMs: 3000,
            });
        } catch (err: any) {
            const detail = err?.response?.data?.detail || err?.message || "select failed";
            toast.error(t("toastSelectErr"), {
                projectId: currentProject.id,
                projectTitle: currentProject.title,
                body: String(detail),
            });
        }
    };

    const handleToggleFavorite = async (variantId: string, currentFav: boolean) => {
        try {
            const updated = await api.favoriteAssetVariant(
                currentProject.id,
                entity.id,
                kind,
                variantId,
                !currentFav,
            );
            updateProject(currentProject.id, updated);
        } catch { /* silent — non-critical */ }
    };

    const filteredVariants = galleryFilter === "favorited"
        ? variants.filter(v => v.is_favorited)
        : variants;

    // Per-kind accent — Tailwind JIT can't resolve dynamic `bg-${name}-500/15`,
    // so we ship full class strings per kind keyed off a static record.
    const accentClasses = {
        character: {
            headerPill: "bg-purple-500/15 text-purple-300 border-purple-500/30",
            batchActive: "border-purple-400/60 bg-purple-500/15 text-purple-200",
            variantSelected: "border-purple-400 ring-2 ring-purple-500/40",
            selectBadge: "bg-purple-500",
        },
        scene: {
            headerPill: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
            batchActive: "border-emerald-400/60 bg-emerald-500/15 text-emerald-200",
            variantSelected: "border-emerald-400 ring-2 ring-emerald-500/40",
            selectBadge: "bg-emerald-500",
        },
        prop: {
            headerPill: "bg-amber-500/15 text-amber-300 border-amber-500/30",
            batchActive: "border-amber-400/60 bg-amber-500/15 text-amber-200",
            variantSelected: "border-amber-400 ring-2 ring-amber-500/40",
            selectBadge: "bg-amber-500",
        },
    } as const;
    const accent = accentClasses[kind];

    return createPortal((
        <AnimatePresence>
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-[100] bg-overlay backdrop-blur-sm grid place-items-center p-4"
                onMouseDown={(e) => { overlayMouseDown.current = e.target === e.currentTarget; }}
                onMouseUp={(e) => { if (overlayMouseDown.current && e.target === e.currentTarget) onClose(); overlayMouseDown.current = false; }}
            >
                <motion.div
                    initial={{ scale: 0.96, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.96, opacity: 0 }}
                    transition={{ duration: 0.18 }}
                    className="w-[85vw] max-w-[96rem] h-[92vh] flex flex-col rounded-2xl border border-glass-border bg-elevated shadow-[0_24px_64px_-12px_rgba(0,0,0,0.7)] overflow-hidden"
                    onClick={(e) => e.stopPropagation()}
                >
                    {/* Header */}
                    <header className="flex items-center justify-between gap-3 px-5 py-3 border-b border-glass-border">
                        <div className="flex items-center gap-2 min-w-0">
                            <span className={`inline-flex h-7 w-7 items-center justify-center rounded-md border shrink-0 ${accent.headerPill}`}>
                                <Sparkles size={13} />
                            </span>
                            <div className="min-w-0">
                                <p className="font-mono text-[0.625rem] uppercase tracking-[0.16em] text-text-muted">
                                    {t(`kind.${kind}`)} · {variants.length} {t("variants")}
                                </p>
                                <h2 className="text-display font-medium text-foreground truncate">{entity.name}</h2>
                            </div>
                        </div>
                        <button onClick={onClose} aria-label={t("close")} className="p-1.5 rounded-lg hover:bg-hover-bg text-text-muted hover:text-foreground transition-colors">
                            <X size={15} />
                        </button>
                    </header>

                    {/* Body: context (left) + prompt editor (center) + variants gallery (right) */}
                    <div className="flex-1 grid grid-cols-1 md:grid-cols-[220px_minmax(0,1fr)_minmax(0,1.2fr)] divide-x divide-glass-border min-h-0">
                        {/* LEFT — entity context + style baseline + current reference */}
                        <div className="hidden md:flex flex-col gap-3 p-4 overflow-y-auto custom-scrollbar bg-surface/50">
                            {/* Entity metadata */}
                            <div>
                                <p className="font-mono text-[0.625rem] uppercase tracking-[0.18em] text-text-muted mb-1">
                                    {t(`kind.${kind}`)}
                                </p>
                                <p className="text-[0.875rem] font-medium text-foreground">{entity.name}</p>
                                {entity.description && (
                                    <p className="mt-1.5 text-[0.75rem] leading-relaxed text-text-secondary">
                                        {entity.description}
                                    </p>
                                )}
                            </div>

                            {/* Entity associations — which episodes */}
                            {(() => {
                                const seriesId = currentProject.series_id;
                                if (!seriesId) return null;
                                const siblingEpisodes = allProjects.filter((p: any) => p.series_id === seriesId);
                                const appearsIn = siblingEpisodes.filter((ep: any) => {
                                    const pool: any[] = kind === "character"
                                        ? ep.characters || []
                                        : kind === "scene" ? ep.scenes || [] : ep.props || [];
                                    return pool.some((e: any) => e.id === entity.id || e.name === entity.name);
                                });
                                if (appearsIn.length <= 1) return null;
                                return (
                                    <div className="pt-3 border-t border-glass-border">
                                        <p className="font-mono text-[0.625rem] uppercase tracking-[0.18em] text-text-muted mb-1.5">
                                            {t("appearsIn")} ({appearsIn.length})
                                        </p>
                                        <div className="flex flex-wrap gap-1">
                                            {appearsIn.slice(0, 6).map((ep: any) => (
                                                <span key={ep.id} className="px-1.5 py-0.5 rounded bg-elevated border border-glass-border text-[0.625rem] text-text-secondary truncate max-w-[110px]">
                                                    {ep.title}
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                );
                            })()}

                            {/* Style baseline — name + toggle + positive/negative prompts */}
                            <div className="pt-3 border-t border-glass-border">
                                <div className="flex items-center justify-between">
                                    <p className="flex items-center gap-1.5 font-mono text-[0.625rem] uppercase tracking-[0.18em] text-text-muted">
                                        <Palette size={10} /> {t("styleAppliedFrom")}
                                    </p>
                                    {styleName && (
                                        <button
                                            onClick={() => setApplyStyle(!applyStyle)}
                                            className={`relative w-7 h-4 rounded-full transition-colors ${applyStyle ? "bg-primary/60" : "bg-elevated"}`}
                                        >
                                            <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${applyStyle ? "left-3.5" : "left-0.5"}`} />
                                        </button>
                                    )}
                                </div>
                                <p className="mt-1 text-[0.75rem] text-foreground">{styleName || t("styleNotSet")}</p>
                                {!applyStyle && styleName && (
                                    <p className="text-[0.625rem] text-amber-300/70 mt-0.5">{t("styleDisabledHint")}</p>
                                )}

                                {/* Positive prompt */}
                                {applyStyle && stylePositive && (
                                    <div className="mt-2.5 rounded-md bg-primary/5 border border-primary/10 px-2.5 py-2">
                                        <p className="font-mono text-[0.5625rem] uppercase tracking-[0.14em] text-primary/70 mb-1">{t("positiveLabel")}</p>
                                        <p className={`text-[0.6875rem] leading-relaxed text-text-secondary ${!positiveExpanded ? "line-clamp-3" : ""}`}>
                                            {stylePositive}
                                        </p>
                                        {stylePositive.length > 80 && (
                                            <button
                                                onClick={() => setPositiveExpanded(!positiveExpanded)}
                                                className="mt-1 text-[0.625rem] text-primary/60 hover:text-primary/90 transition-colors"
                                            >
                                                {positiveExpanded ? t("collapse") : t("expand")}
                                            </button>
                                        )}
                                    </div>
                                )}

                                {/* Negative prompt */}
                                {applyStyle && styleNegative && (
                                    <div className="mt-2 rounded-md bg-red-500/5 border border-red-500/10 px-2.5 py-2">
                                        <p className="font-mono text-[0.5625rem] uppercase tracking-[0.14em] text-red-400/70 mb-1">{t("negativeLabel")}</p>
                                        <p className={`text-[0.6875rem] leading-relaxed text-text-secondary ${!negativeExpanded ? "line-clamp-3" : ""}`}>
                                            {styleNegative}
                                        </p>
                                        {styleNegative.length > 80 && (
                                            <button
                                                onClick={() => setNegativeExpanded(!negativeExpanded)}
                                                className="mt-1 text-[0.625rem] text-red-400/60 hover:text-red-400/90 transition-colors"
                                            >
                                                {negativeExpanded ? t("collapse") : t("expand")}
                                            </button>
                                        )}
                                    </div>
                                )}
                            </div>

                        </div>

                        {/* CENTER — template cards → prompt → tags → preview → generation config → CTA */}
                        <div className="flex flex-col p-5 overflow-y-auto custom-scrollbar">
                            {/* Template selection cards — character only */}
                            {kind === "character" && (
                                <div className="mb-4">
                                    <p className="font-mono text-[0.625rem] uppercase tracking-[0.18em] text-text-muted mb-2.5">
                                        {t("templateSelectLabel")}
                                    </p>
                                    <div className="flex gap-3">
                                        {(Object.entries(CHARACTER_TEMPLATES) as [CharacterTemplate, typeof CHARACTER_TEMPLATES[CharacterTemplate]][]).map(([key, tpl]) => {
                                            const isActive = selectedTemplate === key;
                                            const isLocked = !!(tpl.comingSoon && !isGptImage2);
                                            return (
                                                <button
                                                    key={key}
                                                    onClick={() => !isLocked && handleTemplateSwitch(key)}
                                                    disabled={isLocked}
                                                    className={`relative flex flex-col rounded-lg border overflow-hidden transition-all flex-1 min-w-0 ${
                                                        isActive
                                                            ? "border-primary/60 ring-1 ring-primary/30 bg-primary/5"
                                                            : isLocked
                                                                ? "border-glass-border bg-surface-inset opacity-50 cursor-not-allowed"
                                                                : "border-glass-border bg-surface-inset hover:border-foreground/30 hover:bg-hover-bg"
                                                    }`}
                                                >
                                                    {/* Example thumbnail area — 4:3 ratio */}
                                                    <div className="aspect-[4/3] bg-input-bg flex items-center justify-center overflow-hidden">
                                                        {tpl.exampleImage ? (
                                                            <img src={tpl.exampleImage} alt="" className="w-full h-full object-cover" />
                                                        ) : (
                                                            <span className="text-[1.25rem] text-text-muted/40">
                                                                {isLocked ? "🔒" : "📐"}
                                                            </span>
                                                        )}
                                                    </div>
                                                    {/* Label + description */}
                                                    <div className="px-2.5 py-2">
                                                        <p className={`text-[0.6875rem] font-medium ${isActive ? "text-foreground" : "text-text-secondary"}`}>
                                                            {t(tpl.labelKey)}
                                                        </p>
                                                        <p className="text-[0.59375rem] text-text-muted mt-0.5 line-clamp-1">
                                                            {t(tpl.descKey)}
                                                        </p>
                                                    </div>
                                                    {/* Active indicator */}
                                                    {isActive && (
                                                        <span className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-primary grid place-items-center">
                                                            <Check size={9} className="text-foreground" strokeWidth={3} />
                                                        </span>
                                                    )}
                                                    {isLocked && (
                                                        <span className="absolute top-1.5 right-1.5 text-[0.5625rem] text-text-muted font-mono uppercase">Soon</span>
                                                    )}
                                                </button>
                                            );
                                        })}
                                    </div>
                                    {/* Inline confirm when switching with dirty prompt */}
                                    {pendingTemplate && (
                                        <div className="mt-2 flex items-center gap-2 px-2 py-1.5 rounded-md bg-amber-500/10 border border-amber-500/20">
                                            <span className="text-[0.6875rem] text-amber-200/90">{t("tplSwitchConfirm")}</span>
                                            <button
                                                onClick={confirmTemplateSwitch}
                                                className="px-2 py-0.5 rounded text-[0.6875rem] font-medium bg-amber-500/20 text-amber-200 hover:bg-amber-500/30 transition-colors"
                                            >
                                                {t("tplSwitchYes")}
                                            </button>
                                            <button
                                                onClick={cancelTemplateSwitch}
                                                className="px-2 py-0.5 rounded text-[0.6875rem] text-text-muted hover:text-text-secondary transition-colors"
                                            >
                                                {t("tplSwitchNo")}
                                            </button>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Prompt textarea */}
                            <div className="flex items-center justify-between mb-2">
                                <label className="font-mono text-[0.625rem] uppercase tracking-[0.18em] text-text-muted">
                                    {t("promptLabel")}
                                </label>
                                <button
                                    onClick={handleResetTemplate}
                                    disabled={generating}
                                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[0.6875rem] text-text-muted hover:text-foreground transition-colors disabled:opacity-30"
                                    title={t("resetTemplateHint")}
                                >
                                    <RefreshCw size={11} />
                                    {t("resetTemplate")}
                                </button>
                            </div>
                            <textarea
                                value={prompt}
                                onChange={(e) => { setPrompt(e.target.value); setPromptDirty(true); }}
                                disabled={generating}
                                className={getCastPromptTextareaClasses()}
                            />

                            {/* Quick tags — immediately below textarea */}
                            <div className="mt-2.5 flex flex-wrap gap-1.5">
                                {(kind === "character"
                                    ? ["full body", "close-up", "three-view", "dynamic pose", "soft lighting", "studio lighting", "white background", "detailed face"]
                                    : kind === "scene"
                                        ? ["wide angle", "establishing shot", "golden hour", "dramatic lighting", "aerial view", "depth of field", "atmospheric", "cinematic"]
                                        : ["product shot", "white background", "multi-angle", "studio lighting", "macro detail", "floating", "transparent background", "clean"]
                                ).map((tag) => (
                                    <button
                                        key={tag}
                                        onClick={() => setPrompt((p) => p.trimEnd() + (p.endsWith(",") || p.endsWith("，") || !p.trim() ? " " : ", ") + tag)}
                                        disabled={generating}
                                        className="px-2.5 py-1 rounded border border-glass-border bg-glass text-[0.6875rem] text-text-muted hover:text-text-secondary hover:border-foreground/30 hover:bg-hover-bg transition-colors disabled:opacity-30"
                                    >
                                        + {tag}
                                    </button>
                                ))}
                            </div>

                            {/* Final prompt preview — collapsible, scrollable */}
                            {applyStyle && stylePositive && (
                                <div className="mt-3 rounded-md bg-surface-inset border border-glass-border">
                                    <button
                                        type="button"
                                        onClick={() => setFinalPreviewExpanded(!finalPreviewExpanded)}
                                        className="w-full flex items-center justify-between px-3.5 py-2 hover:bg-hover-bg transition-colors rounded-t-md"
                                    >
                                        <p className="font-mono text-[0.625rem] uppercase tracking-[0.14em] text-text-muted">{t("finalPromptPreview")}</p>
                                        <span className="text-[0.625rem] text-text-muted">{finalPreviewExpanded ? t("collapse") : t("expand")}</span>
                                    </button>
                                    {finalPreviewExpanded && (
                                        <div className="px-3.5 pb-3 max-h-[200px] overflow-y-auto overscroll-contain">
                                            <p className="text-[0.75rem] leading-relaxed">
                                                <span className="text-foreground">{prompt.trim()}</span>
                                                {prompt.trim() && <span className="text-text-muted">{", "}</span>}
                                                <span className="text-primary/60">{stylePositive}</span>
                                            </p>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Generation config — unified section */}
                            <div className="mt-5 pt-4 border-t border-glass-border space-y-4">
                                <p className="font-mono text-[0.625rem] uppercase tracking-[0.18em] text-text-muted">
                                    {t("generationConfig")}
                                </p>

                                {/* Batch — full row */}
                                <div>
                                    <label className="block font-mono text-[0.625rem] uppercase tracking-[0.16em] text-text-muted mb-2">
                                        {t("batchLabel")}
                                    </label>
                                    <div className="flex items-center gap-2">
                                        {[1, 2, 4].map((n) => (
                                            <button
                                                key={n}
                                                onClick={() => setBatchSize(n)}
                                                disabled={generating}
                                                className={`px-3 py-1.5 rounded-md border font-mono text-[0.75rem] transition-colors ${
                                                    batchSize === n
                                                        ? accent.batchActive
                                                        : "border-glass-border bg-glass text-text-muted hover:border-foreground/30 hover:text-text-secondary"
                                                } disabled:opacity-40`}
                                            >
                                                ×{n}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* Ratio — full row */}
                                <div>
                                    <label className="block font-mono text-[0.625rem] uppercase tracking-[0.16em] text-text-muted mb-2">
                                        {t("aspectRatioLabel")}
                                    </label>
                                    <div className="flex items-center gap-2 flex-wrap">
                                        {["9:16", "3:4", "1:1", "4:3", "16:9"].map((ratio) => (
                                            <button
                                                key={ratio}
                                                onClick={() => setAspectRatioOverride(ratio === defaultAspectRatio ? null : ratio)}
                                                disabled={generating}
                                                className={`px-3 py-1.5 rounded-md border font-mono text-[0.75rem] transition-colors ${
                                                    effectiveAspectRatio === ratio
                                                        ? accent.batchActive
                                                        : "border-glass-border bg-glass text-text-muted hover:border-foreground/30 hover:text-text-secondary"
                                                } disabled:opacity-40`}
                                            >
                                                {ratio}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* Model — full row, chip selected */}
                                <div>
                                    <label className="block font-mono text-[0.625rem] uppercase tracking-[0.16em] text-text-muted mb-2">
                                        {t("modelLabel")}
                                    </label>
                                    <GroupedModelGrid
                                        models={IMAGE_MODELS}
                                        selectedId={modelOverride || currentProject.model_settings?.t2i_model || "wan2.1-t2i"}
                                        onSelect={(id) => setModelOverride(id === (currentProject.model_settings?.t2i_model || "wan2.1-t2i") ? null : id)}
                                    />
                                </div>
                            </div>

                            {/* Generate CTA */}
                            <button
                                onClick={handleGenerate}
                                disabled={generating || !prompt.trim()}
                                className="mt-5 self-center inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-md bg-primary text-white border border-[rgba(100,108,255,0.65)] shadow-[inset_0_1.5px_0_rgba(255,255,255,0.14)] hover:bg-primary-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-[0.875rem] font-semibold"
                            >
                                {generating ? <Loader2 size={15} className="animate-spin" /> : <Wand2 size={15} />}
                                {generating
                                    ? t("generating")
                                    : variants.length === 0
                                        ? t("generateFirst")
                                        : t("generateMore", { count: batchSize })}
                            </button>
                        </div>

                        {/* RIGHT — variants gallery */}
                        <div className="flex flex-col p-5 overflow-y-auto custom-scrollbar bg-surface">
                            {/* Gallery header with filter tabs */}
                            <div className="flex items-center justify-between mb-3">
                                <h3 className="font-mono text-[0.625rem] uppercase tracking-[0.18em] text-text-muted">
                                    {t("variantsTitle")}
                                    <span className="text-text-muted/60"> ({variants.length})</span>
                                </h3>
                                {variants.length > 0 && (
                                    <div className="flex items-center gap-1.5">
                                        <button
                                            onClick={() => setGalleryFilter("all")}
                                            className={`px-2.5 py-1 rounded text-[0.6875rem] transition-colors ${
                                                galleryFilter === "all"
                                                    ? "bg-elevated text-foreground"
                                                    : "text-text-muted hover:text-text-secondary"
                                            }`}
                                        >
                                            {t("filterAll")}
                                        </button>
                                        <button
                                            onClick={() => setGalleryFilter("favorited")}
                                            className={`px-2.5 py-1 rounded text-[0.6875rem] transition-colors inline-flex items-center gap-1 ${
                                                galleryFilter === "favorited"
                                                    ? "bg-amber-500/15 text-amber-300"
                                                    : "text-text-muted hover:text-text-secondary"
                                            }`}
                                        >
                                            <Star size={10} className={galleryFilter === "favorited" ? "fill-amber-300" : ""} />
                                            {t("filterFavorited")} ({variants.filter(v => v.is_favorited).length})
                                        </button>
                                    </div>
                                )}
                            </div>
                            {filteredVariants.length === 0 && variants.length === 0 ? (
                                <div className="flex-1 grid place-items-center text-center text-text-muted">
                                    <div className="max-w-xs">
                                        <div className="mx-auto w-12 h-12 grid place-items-center rounded-full border border-glass-border bg-glass mb-3">
                                            <Sparkles size={18} />
                                        </div>
                                        <p className="text-[0.875rem] text-foreground">{t("emptyVariantsTitle")}</p>
                                        <p className="text-[0.75rem] text-text-secondary mt-1">{t("emptyVariantsBody")}</p>
                                    </div>
                                </div>
                            ) : filteredVariants.length === 0 ? (
                                <div className="flex-1 grid place-items-center text-center text-text-muted">
                                    <p className="text-[0.75rem]">{t("noFavoritedYet")}</p>
                                </div>
                            ) : (
                                <div className="columns-2 lg:columns-3 gap-3 space-y-3">
                                    {filteredVariants.map((v) => {
                                        const isSelected = v.id === selectedId;
                                        return (
                                            <div
                                                key={v.id}
                                                className={`relative rounded-lg overflow-hidden border-2 transition-all break-inside-avoid group ${
                                                    isSelected
                                                        ? accent.variantSelected
                                                        : "border-glass-border hover:border-foreground/30"
                                                }`}
                                            >
                                                <div className="cursor-pointer" onClick={() => !isSelected && handleSelectVariant(v.id)}>
                                                    <PreviewImage
                                                        src={getAssetUrl(v.url)}
                                                        alt={`${entity.name} ${v.id}`}
                                                        className="w-full h-auto max-h-[280px] object-contain"
                                                        clickToLightbox
                                                    />
                                                </div>
                                                {/* Favorite star */}
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); handleToggleFavorite(v.id, !!v.is_favorited); }}
                                                    className={`absolute top-1.5 left-1.5 p-1 rounded-full transition-all ${
                                                        v.is_favorited
                                                            ? "bg-amber-500/30 text-amber-300"
                                                            : "bg-black/40 text-text-secondary opacity-0 group-hover:opacity-100"
                                                    }`}
                                                >
                                                    <Star size={12} className={v.is_favorited ? "fill-amber-300" : ""} />
                                                </button>
                                                {/* Selected badge */}
                                                {isSelected && (
                                                    <div className={`absolute top-1.5 right-1.5 inline-flex h-6 w-6 items-center justify-center rounded-full text-foreground shadow-md ${accent.selectBadge}`}>
                                                        <Check size={12} strokeWidth={2.6} />
                                                    </div>
                                                )}
                                                {/* Select hint on hover */}
                                                {!isSelected && (
                                                    <div
                                                        onClick={() => handleSelectVariant(v.id)}
                                                        className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer pt-6 pb-1.5"
                                                    >
                                                        <p className="w-full text-center text-[0.625rem] uppercase tracking-[0.16em] text-foreground font-mono">
                                                            {t("clickToSelect")}
                                                        </p>
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                            {/* Gallery bottom operations — always visible */}
                            {variants.length > 0 && (
                                <div className="mt-auto pt-4 border-t border-glass-border flex items-center gap-2 flex-wrap">
                                    <span className="text-[0.6875rem] text-text-muted mr-auto">
                                        {variants.filter(v => v.is_favorited).length > 0
                                            ? t("favoritedCount", { count: variants.filter(v => v.is_favorited).length })
                                            : t("favoritedHint")}
                                    </span>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Footer — status only, no action button (state auto-saves) */}
                    <footer className="flex items-center px-5 py-2.5 border-t border-glass-border">
                        <span className="font-mono text-[0.6875rem] uppercase tracking-[0.16em] text-text-muted">
                            {selectedId ? t("selectedFooter") : t("noneSelectedFooter")}
                        </span>
                    </footer>
                </motion.div>
            </motion.div>
        </AnimatePresence>
    ), document.body);
}
