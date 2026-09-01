"use client";

import { useState, useEffect, useMemo } from "react";
import { useTranslations } from "next-intl";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, Palette, Wand2, Plus, Check, ChevronRight, Lock, RotateCcw, ArrowUp, AlertTriangle, X, Image as ImageIcon, Pencil } from "lucide-react";
import { useProjectStore, type StyleConfig, type StylePreset, type StylePresetCategory } from "@/store/projectStore";
import { api } from "@/lib/api";
import StepPageHeader, { StepPill } from "@/components/shared/StepPageHeader";
import WorkflowActionButton from "@/components/shared/WorkflowActionButton";
import { toast } from "@/store/toastStore";

export default function ArtDirection() {
    const ta = useTranslations("artDirection");
    const tStep = useTranslations("stepHeader");
    const {
        currentProject,
        updateProject,
        isAnalyzingArtStyle,
        analyzeArtStyle
    } = useProjectStore();

    const [selectedStyle, setSelectedStyle] = useState<StyleConfig | null>(null);
    const [customStyles, setCustomStyles] = useState<StyleConfig[]>([]);
    const [aiRecommendations, setAiRecommendations] = useState<StyleConfig[]>([]);
    const [presets, setPresets] = useState<StylePreset[]>([]);
    const [categories, setCategories] = useState<StylePresetCategory[]>([]);
    const [activeCategory, setActiveCategory] = useState<string>("all");

    // Modal state
    const [modalPreset, setModalPreset] = useState<StylePreset | null>(null);
    const [modalEditing, setModalEditing] = useState(false);
    const [modalPositive, setModalPositive] = useState("");
    const [modalNegative, setModalNegative] = useState("");

    // AI Recommendation modal state
    const [aiModalStyle, setAiModalStyle] = useState<StyleConfig | null>(null);
    const [aiModalEditing, setAiModalEditing] = useState(false);
    const [aiModalPositive, setAiModalPositive] = useState("");
    const [aiModalNegative, setAiModalNegative] = useState("");

    // Track if current selection is modified from original preset
    const [isModified, setIsModified] = useState(false);

    // Editor state (kept for Apply logic)
    const [editingName, setEditingName] = useState("");
    const [editingPositive, setEditingPositive] = useState("");
    const [editingNegative, setEditingNegative] = useState("");
    const [isSaving, setIsSaving] = useState(false);

    const filteredPresets = useMemo(() => {
        if (activeCategory === "all") return presets;
        return presets.filter(p => p.category === activeCategory);
    }, [presets, activeCategory]);

    // Series baseline (inherit source)
    const [seriesBaseline, setSeriesBaseline] = useState<StyleConfig | null>(null);
    const [seriesBaselineLoading, setSeriesBaselineLoading] = useState(false);
    const [bannerBusy, setBannerBusy] = useState(false);
    const [pendingOverrideStyle, setPendingOverrideStyle] = useState<StyleConfig | null>(null);
    const [overrideAccepted, setOverrideAccepted] = useState(false);

    useEffect(() => {
        setOverrideAccepted(false);
        setPendingOverrideStyle(null);
        const seriesId = currentProject?.series_id;
        if (!seriesId) {
            setSeriesBaseline(null);
            return;
        }
        setSeriesBaselineLoading(true);
        api.getSeries(seriesId)
            .then((s: any) => {
                setSeriesBaseline(s?.art_direction?.style_config ?? null);
            })
            .catch(() => setSeriesBaseline(null))
            .finally(() => setSeriesBaselineLoading(false));
    }, [currentProject?.series_id, currentProject?.id]);

    const projectStyle = currentProject?.art_direction?.style_config ?? null;
    const inSeries = !!currentProject?.series_id;
    const isInherit = inSeries && !!seriesBaseline && !projectStyle;
    const isOverridden = inSeries && !!seriesBaseline && !!projectStyle;
    const canPromote = inSeries && !seriesBaseline && !!projectStyle;
    const isPreview = isInherit && overrideAccepted;

    const handleResetToSeries = async () => {
        if (!currentProject?.id) return;
        setBannerBusy(true);
        try {
            const fresh = await api.clearProjectArtDirection(currentProject.id);
            updateProject(currentProject.id, fresh);
            setSelectedStyle(null);
            setEditingName("");
            setEditingPositive("");
            setEditingNegative("");
            setIsModified(false);
            setOverrideAccepted(false);
            toast.success(ta("toastResetDone"), {
                projectId: currentProject.id,
                projectTitle: currentProject.title,
            });
        } catch (err) {
            console.error("Reset to series baseline failed", err);
            toast.error(ta("toastResetFailed"), {
                projectId: currentProject?.id,
                projectTitle: currentProject?.title,
            });
        } finally {
            setBannerBusy(false);
        }
    };

    const handlePromoteToSeries = async () => {
        if (!currentProject?.series_id || !currentProject?.art_direction) return;
        setBannerBusy(true);
        try {
            await api.updateSeries(currentProject.series_id, {
                art_direction: currentProject.art_direction as any,
            });
            const s = await api.getSeries(currentProject.series_id);
            setSeriesBaseline(s?.art_direction?.style_config ?? null);
        } catch (err) {
            console.error("Promote to series baseline failed", err);
        } finally {
            setBannerBusy(false);
        }
    };

    useEffect(() => {
        loadPresets();
    }, []);

    const resolvePositivePrompt = (style: StyleConfig | null): string => {
        if (!style) return "";
        if (style.positive_prompt) return style.positive_prompt;
        if (style.id && presets.length > 0) {
            const match = presets.find(p => p.id === style.id);
            if (match) return match.positive_prompt || "";
        }
        return "";
    };

    useEffect(() => {
        const projectAD = currentProject?.art_direction;
        const projectStyleConfig = projectAD?.style_config ?? null;
        if (projectStyleConfig) {
            setSelectedStyle(projectStyleConfig);
            setEditingName(projectStyleConfig.name || "");
            setEditingPositive(resolvePositivePrompt(projectStyleConfig));
            setEditingNegative(projectStyleConfig.negative_prompt || "");
            setCustomStyles(projectAD?.custom_styles || []);
            if (projectAD?.ai_recommendations && projectAD.ai_recommendations.length > 0) {
                setAiRecommendations(projectAD.ai_recommendations);
            }
        } else if (seriesBaseline) {
            setSelectedStyle(seriesBaseline);
            setEditingName(seriesBaseline.name || "");
            setEditingPositive(resolvePositivePrompt(seriesBaseline));
            setEditingNegative(seriesBaseline.negative_prompt || "");
            setCustomStyles(projectAD?.custom_styles || []);
        }
    }, [currentProject?.id, currentProject?.art_direction, seriesBaseline, presets]);

    useEffect(() => {
        if (currentProject?.art_direction?.ai_recommendations) {
            setAiRecommendations(currentProject.art_direction.ai_recommendations);
        }
    }, [currentProject?.art_direction?.ai_recommendations]);

    const loadPresets = async () => {
        try {
            const data = await api.getStylePresets();
            setPresets(data.presets || []);
            setCategories(data.categories || []);
        } catch (error) {
            console.error("Failed to load presets:", error);
        }
    };

    const handleAnalyze = async () => {
        if (!currentProject) return;
        try {
            await analyzeArtStyle(
                currentProject.id,
                currentProject.originalText || currentProject.title
            );
        } catch (error) {
            console.error("Failed to analyze script:", error);
            toast.error(ta("analysisFailed"), {
                projectId: currentProject?.id,
                projectTitle: currentProject?.title,
            });
        }
    };

    const toStyleConfig = (style: StyleConfig | StylePreset): StyleConfig => {
        if ("is_custom" in style) {
            return style as StyleConfig;
        }
        const preset = style as StylePreset;
        return {
            id: preset.id,
            name: preset.name,
            positive_prompt: preset.positive_prompt,
            negative_prompt: preset.negative_prompt || "",
            is_custom: false,
        };
    };

    const applyStyleToState = (style: StyleConfig | StylePreset) => {
        const normalizedStyle = toStyleConfig(style);
        setSelectedStyle(normalizedStyle);
        setEditingName(normalizedStyle.name);
        setEditingPositive(normalizedStyle.positive_prompt);
        setEditingNegative(normalizedStyle.negative_prompt);
        setIsModified(false);
    };

    const handleSelectStyle = (style: StyleConfig | StylePreset) => {
        const normalizedStyle = toStyleConfig(style);
        const isSeriesBaseline = isInherit && seriesBaseline && normalizedStyle.id === seriesBaseline.id;
        if (isInherit && !overrideAccepted && !isSeriesBaseline) {
            setPendingOverrideStyle(normalizedStyle);
            return;
        }
        applyStyleToState(normalizedStyle);
    };

    const confirmOverridePreview = () => {
        if (!pendingOverrideStyle) return;
        setOverrideAccepted(true);
        applyStyleToState(pendingOverrideStyle);
        toast.info(ta("toastOverridePreviewing", { name: pendingOverrideStyle.name }), {
            projectId: currentProject?.id,
            projectTitle: currentProject?.title,
            body: ta("toastOverridePreviewingBody"),
        });
        setPendingOverrideStyle(null);
    };

    const cancelOverrideConfirm = () => setPendingOverrideStyle(null);

    // Modal: open preset detail
    const openPresetModal = (preset: StylePreset) => {
        setModalPreset(preset);
        setModalEditing(false);
        setModalPositive(preset.positive_prompt);
        setModalNegative(preset.negative_prompt);
    };

    const closePresetModal = () => {
        setModalPreset(null);
        setModalEditing(false);
    };

    // AI Recommendation modal handlers
    const openAiModal = (style: StyleConfig) => {
        setAiModalStyle(style);
        setAiModalEditing(false);
        setAiModalPositive(style.positive_prompt);
        setAiModalNegative(style.negative_prompt);
    };

    const closeAiModal = () => {
        setAiModalStyle(null);
        setAiModalEditing(false);
    };

    const handleAiModalApply = () => {
        if (!aiModalStyle) return;
        const isCustomized = aiModalEditing && (
            aiModalPositive !== aiModalStyle.positive_prompt ||
            aiModalNegative !== aiModalStyle.negative_prompt
        );

        const config: StyleConfig = {
            id: aiModalStyle.id,
            name: aiModalStyle.name,
            positive_prompt: isCustomized ? aiModalPositive : aiModalStyle.positive_prompt,
            negative_prompt: isCustomized ? aiModalNegative : aiModalStyle.negative_prompt,
            is_custom: false,
        };

        const isSeriesBaseline = isInherit && seriesBaseline && config.id === seriesBaseline.id;
        if (isInherit && !overrideAccepted && !isSeriesBaseline) {
            setPendingOverrideStyle(config);
            closeAiModal();
            return;
        }

        setSelectedStyle(config);
        setEditingName(config.name);
        setEditingPositive(config.positive_prompt);
        setEditingNegative(config.negative_prompt);
        setIsModified(isCustomized);
        closeAiModal();
    };

    // Modal: use this style (original or customized)
    const handleModalApplyStyle = () => {
        if (!modalPreset) return;
        const isCustomized = modalEditing && (
            modalPositive !== modalPreset.positive_prompt ||
            modalNegative !== modalPreset.negative_prompt
        );

        const config: StyleConfig = {
            id: modalPreset.id,
            name: modalPreset.name,
            positive_prompt: isCustomized ? modalPositive : modalPreset.positive_prompt,
            negative_prompt: isCustomized ? modalNegative : modalPreset.negative_prompt,
            is_custom: false,
        };

        // Go through override check if in series inherit mode
        const isSeriesBaseline = isInherit && seriesBaseline && config.id === seriesBaseline.id;
        if (isInherit && !overrideAccepted && !isSeriesBaseline) {
            setPendingOverrideStyle(config);
            closePresetModal();
            return;
        }

        setSelectedStyle(config);
        setEditingName(config.name);
        setEditingPositive(config.positive_prompt);
        setEditingNegative(config.negative_prompt);
        setIsModified(isCustomized);
        closePresetModal();
    };

    // Restore to original preset prompts
    const handleRestoreOriginal = () => {
        if (!selectedStyle) return;
        const original = presets.find(p => p.id === selectedStyle.id);
        if (original) {
            setEditingPositive(original.positive_prompt);
            setEditingNegative(original.negative_prompt);
            setIsModified(false);
        }
    };

    const handleApply = async () => {
        if (!currentProject || !selectedStyle) {
            toast.warning(ta("selectStyleFirst"), {
                projectId: currentProject?.id,
                projectTitle: currentProject?.title,
            });
            return;
        }

        const finalConfig: StyleConfig = {
            ...selectedStyle,
            name: editingName,
            positive_prompt: editingPositive,
            negative_prompt: editingNegative
        };

        setIsSaving(true);
        try {
            await api.saveArtDirection(
                currentProject.id,
                finalConfig.id,
                finalConfig,
                customStyles,
                aiRecommendations
            );
            const refreshed = await api.getProject(currentProject.id);
            updateProject(currentProject.id, refreshed);
            setOverrideAccepted(false);
            toast.success(ta("styleApplied"), {
                projectId: currentProject.id,
                projectTitle: currentProject.title,
                body: ta("styleAppliedBody", { name: finalConfig.name }),
            });
        } catch (error) {
            console.error("Failed to save art direction:", error);
            toast.error(ta("saveFailedShort"), {
                projectId: currentProject?.id,
                projectTitle: currentProject?.title,
            });
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="flex flex-col h-full w-full overflow-hidden">
            <StepPageHeader
                stepNumber={2}
                englishName="STYLE"
                title={tStep("styleTitle")}
                subtitle={tStep("styleSubtitle")}
                pills={projectStyle?.name ? (
                    <StepPill label={ta("styleLabel")} value={projectStyle.name} />
                ) : null}
            />

            {/* Scrollable content — full width */}
            <div className="flex-1 min-h-0 overflow-y-auto p-8 space-y-8 bg-surface">
                {/* Series inherit/override banners */}
                {inSeries && !seriesBaselineLoading && (
                    <>
                        {isInherit && !overrideAccepted && (
                            <div className="flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/10 px-4 py-3">
                                <Lock size={16} className="text-primary shrink-0" />
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm text-foreground">
                                        <span className="text-text-secondary">{ta("inheritsBaseline")}</span>{" "}
                                        <span className="font-medium">{seriesBaseline?.name}</span>
                                    </p>
                                    <p className="text-[0.6875rem] text-text-muted mt-0.5">{ta("inheritHint")}</p>
                                </div>
                            </div>
                        )}
                        {isPreview && (
                            <div className="flex items-center gap-3 rounded-lg border border-amber-400/40 bg-amber-400/10 px-4 py-3">
                                <AlertTriangle size={16} className="text-amber-300 shrink-0" />
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm text-foreground">
                                        <span className="text-amber-200">{ta("previewBannerTitle")}</span>{" "}
                                        <span className="font-medium">{selectedStyle?.name ?? "—"}</span>
                                    </p>
                                    <p className="text-[0.6875rem] text-text-muted mt-0.5">{ta("previewBannerHint")}</p>
                                </div>
                                <WorkflowActionButton
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => {
                                        setOverrideAccepted(false);
                                        if (seriesBaseline) applyStyleToState(seriesBaseline);
                                    }}
                                >
                                    {ta("cancelOverride")}
                                </WorkflowActionButton>
                            </div>
                        )}
                        {isOverridden && (
                            <div className="flex items-center gap-3 rounded-lg border border-amber-400/30 bg-amber-400/10 px-4 py-3">
                                <RotateCcw size={16} className="text-amber-300 shrink-0" />
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm text-foreground">
                                        <span className="text-amber-200">{ta("overridingBaseline")}</span>{" "}
                                        <span className="text-text-secondary text-[0.75rem]">
                                            ({ta("baselineLabel")}: {seriesBaseline?.name})
                                        </span>
                                    </p>
                                    <p className="text-[0.6875rem] text-text-muted mt-0.5">{ta("overrideHint")}</p>
                                </div>
                                <WorkflowActionButton
                                    variant="secondary"
                                    size="sm"
                                    loading={bannerBusy}
                                    leftIcon={<RotateCcw />}
                                    onClick={handleResetToSeries}
                                >
                                    {ta("resetToSeries")}
                                </WorkflowActionButton>
                            </div>
                        )}
                        {canPromote && (
                            <div className="flex items-center gap-3 rounded-lg border border-purple-400/30 bg-purple-400/10 px-4 py-3">
                                <ArrowUp size={16} className="text-purple-300 shrink-0" />
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm text-foreground">{ta("promotePromptTitle")}</p>
                                    <p className="text-[0.6875rem] text-text-muted mt-0.5">{ta("promotePromptHint")}</p>
                                </div>
                                <WorkflowActionButton
                                    variant="secondary"
                                    size="sm"
                                    loading={bannerBusy}
                                    leftIcon={<ArrowUp />}
                                    onClick={handlePromoteToSeries}
                                >
                                    {ta("promoteBtn")}
                                </WorkflowActionButton>
                            </div>
                        )}
                    </>
                )}

                {/* AI Recommendations */}
                <div>
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
                            <Sparkles size={20} className="text-yellow-400" />
                            {ta("aiRecommendations")}
                        </h3>
                        <WorkflowActionButton
                            variant="secondary"
                            loading={isAnalyzingArtStyle}
                            leftIcon={<Wand2 />}
                            onClick={handleAnalyze}
                            disabled={isAnalyzingArtStyle}
                        >
                            {isAnalyzingArtStyle ? ta("analyzing") : ta("analyzeScript")}
                        </WorkflowActionButton>
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                        {aiRecommendations.map((style) => (
                            <AIRecommendationCard
                                key={style.id}
                                style={style}
                                isSelected={selectedStyle?.id === style.id}
                                onClick={() => openAiModal(style)}
                            />
                        ))}
                    </div>
                </div>

                {/* Built-in Presets v2 */}
                <div>
                    <h3 className="text-lg font-bold text-foreground mb-4 flex items-center gap-2">
                        <Palette size={20} className="text-blue-400" />
                        {ta("builtInPresets")}
                    </h3>

                    {/* Category tabs */}
                    <div className="flex items-center gap-1.5 mb-5 overflow-x-auto pb-1">
                        <button
                            onClick={() => setActiveCategory("all")}
                            className={`shrink-0 px-3 py-1.5 rounded-lg text-[0.75rem] font-medium transition-colors ${
                                activeCategory === "all"
                                    ? "bg-primary/20 text-primary border border-primary/30"
                                    : "bg-elevated text-text-secondary hover:bg-hover-bg border border-transparent"
                            }`}
                        >
                            全部
                        </button>
                        {categories.map(cat => (
                            <button
                                key={cat.id}
                                onClick={() => setActiveCategory(cat.id)}
                                className={`shrink-0 px-3 py-1.5 rounded-lg text-[0.75rem] font-medium transition-colors ${
                                    activeCategory === cat.id
                                        ? "bg-primary/20 text-primary border border-primary/30"
                                        : "bg-elevated text-text-secondary hover:bg-hover-bg border border-transparent"
                                }`}
                            >
                                {cat.name_zh}
                            </button>
                        ))}
                    </div>

                    {/* Preset grid */}
                    <div className="grid grid-cols-3 gap-3">
                        {filteredPresets.map((style) => (
                            <StylePresetCardV2
                                key={style.id}
                                style={style}
                                isSelected={selectedStyle?.id === style.id}
                                onClick={() => openPresetModal(style)}
                            />
                        ))}
                    </div>
                </div>

                {/* Custom Styles */}
                {customStyles.length > 0 && (
                    <div>
                        <h3 className="text-lg font-bold text-foreground mb-4 flex items-center gap-2">
                            <Plus size={20} className="text-green-400" />
                            {ta("customStyles")}
                        </h3>
                        <div className="grid grid-cols-3 gap-3">
                            {customStyles.map((style) => (
                                <StylePresetCard
                                    key={style.id}
                                    style={style}
                                    isSelected={selectedStyle?.id === style.id}
                                    onSelect={() => handleSelectStyle(style)}
                                />
                            ))}
                        </div>
                    </div>
                )}
            </div>

            {/* Bottom sticky bar */}
            <div className="shrink-0 border-t border-glass-border bg-surface/95 backdrop-blur-md px-8 py-3 flex items-center justify-end gap-3">
                {selectedStyle ? (
                    <div className="flex items-center gap-2">
                        <span className="font-mono text-[0.625rem] uppercase tracking-[0.18em] text-text-muted">
                            <span className="text-foreground">{selectedStyle.name}</span>
                            {isModified && (
                                <>
                                    <span className="mx-1.5 text-amber-300">·</span>
                                    <span className="text-amber-300">已修改</span>
                                    <button
                                        onClick={handleRestoreOriginal}
                                        className="ml-2 text-[0.5625rem] text-text-muted hover:text-foreground underline"
                                    >
                                        还原
                                    </button>
                                </>
                            )}
                        </span>
                    </div>
                ) : (
                    <span className="font-mono text-[0.625rem] uppercase tracking-[0.18em] text-text-muted">
                        select a style →
                    </span>
                )}
                <WorkflowActionButton
                    variant="primary"
                    loading={isSaving}
                    rightIcon={<ChevronRight />}
                    onClick={handleApply}
                    disabled={!selectedStyle}
                >
                    {isSaving ? ta("saving") : ta("applyAndContinue")}
                </WorkflowActionButton>
            </div>

            {/* AI Recommendation Detail Modal */}
            <AnimatePresence>
                {aiModalStyle && (
                    <AIRecommendationModal
                        style={aiModalStyle}
                        isSelected={selectedStyle?.id === aiModalStyle.id}
                        editing={aiModalEditing}
                        positivePrompt={aiModalPositive}
                        negativePrompt={aiModalNegative}
                        onPositiveChange={setAiModalPositive}
                        onNegativeChange={setAiModalNegative}
                        onStartEditing={() => setAiModalEditing(true)}
                        onApply={handleAiModalApply}
                        onClose={closeAiModal}
                    />
                )}
            </AnimatePresence>

            {/* Preset Detail Modal */}
            <AnimatePresence>
                {modalPreset && (
                    <PresetDetailModal
                        preset={modalPreset}
                        isSelected={selectedStyle?.id === modalPreset.id}
                        editing={modalEditing}
                        positivePrompt={modalPositive}
                        negativePrompt={modalNegative}
                        onPositiveChange={setModalPositive}
                        onNegativeChange={setModalNegative}
                        onStartEditing={() => setModalEditing(true)}
                        onApply={handleModalApplyStyle}
                        onClose={closePresetModal}
                        sameCategoryPresets={presets.filter(p => p.category === modalPreset.category && p.id !== modalPreset.id)}
                        onSwitchPreset={(p) => {
                            setModalPreset(p);
                            setModalEditing(false);
                            setModalPositive(p.positive_prompt);
                            setModalNegative(p.negative_prompt);
                        }}
                    />
                )}
            </AnimatePresence>

            {/* Override confirmation dialog */}
            {pendingOverrideStyle && (
                <div
                    className="fixed inset-0 z-[110] bg-overlay backdrop-blur-sm grid place-items-center p-4"
                    onClick={cancelOverrideConfirm}
                >
                    <div
                        className="w-full max-w-md rounded-2xl border border-glass-border bg-elevated shadow-[0_24px_64px_-12px_rgba(0,0,0,0.7)]"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <header className="flex items-center justify-between gap-3 px-5 py-3 border-b border-glass-border">
                            <div className="flex items-center gap-2">
                                <AlertTriangle size={15} className="text-amber-300" />
                                <h2 className="text-display font-medium text-foreground">{ta("overrideConfirmTitle")}</h2>
                            </div>
                            <button
                                onClick={cancelOverrideConfirm}
                                aria-label="Close"
                                className="p-1.5 rounded-lg hover:bg-hover-bg text-text-muted hover:text-foreground transition-colors"
                            >
                                <X size={15} />
                            </button>
                        </header>
                        <div className="px-5 py-4 space-y-3">
                            <p className="text-body-sm text-text-secondary leading-relaxed">
                                {ta("overrideConfirmIntro")}
                            </p>
                            <div className="rounded-lg border border-glass-border bg-glass px-3 py-2 space-y-1">
                                <p className="font-mono text-[0.625rem] uppercase tracking-[0.18em] text-text-muted">{ta("overrideFromTo")}</p>
                                <p className="text-[0.8125rem] text-foreground">
                                    <span className="text-text-secondary">{seriesBaseline?.name ?? "—"}</span>
                                    <span className="mx-2 text-text-muted">→</span>
                                    <span className="font-medium text-amber-200">{pendingOverrideStyle.name}</span>
                                </p>
                            </div>
                            <p className="text-[0.71875rem] text-text-muted">{ta("overrideConfirmFooter")}</p>
                        </div>
                        <footer className="flex items-center justify-end gap-2 px-5 py-3 border-t border-glass-border">
                            <WorkflowActionButton variant="ghost" size="sm" onClick={cancelOverrideConfirm}>
                                {ta("overrideCancelBtn")}
                            </WorkflowActionButton>
                            <WorkflowActionButton variant="primary" size="sm" onClick={confirmOverridePreview} leftIcon={<Check />}>
                                {ta("overrideConfirmBtn")}
                            </WorkflowActionButton>
                        </footer>
                    </div>
                </div>
            )}
        </div>
    );
}

// ─── Sub-components ────────────────────────────────────────────────────────

function AIRecommendationCard({ style, isSelected, onClick }: {
    style: StyleConfig;
    isSelected: boolean;
    onClick: () => void;
}) {
    return (
        <motion.div
            layout
            onClick={onClick}
            className={`group relative rounded-xl border overflow-hidden cursor-pointer transition-all ${
                isSelected
                    ? "border-yellow-400/60 shadow-lg shadow-yellow-500/15 ring-1 ring-yellow-400/30"
                    : "border-glass-border hover:border-foreground/30 hover:shadow-sm"
            }`}
        >
            <div className="p-4 space-y-2">
                {/* Header: AI badge + name */}
                <div className="flex items-start gap-2">
                    <div className="shrink-0 mt-0.5 flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-yellow-500/15 border border-yellow-500/20">
                        <Sparkles size={9} className="text-yellow-400" />
                        <span className="text-[0.5625rem] font-medium text-yellow-300">AI</span>
                    </div>
                    <h4 className="text-[0.8125rem] font-semibold text-foreground leading-tight line-clamp-1 flex-1">
                        {style.name}
                    </h4>
                    {isSelected && (
                        <div className="shrink-0 w-5 h-5 rounded-full bg-yellow-400 flex items-center justify-center">
                            <Check size={11} className="text-black" />
                        </div>
                    )}
                </div>

                {/* Description */}
                {style.description && (
                    <p className="text-[0.6875rem] text-text-secondary leading-relaxed line-clamp-2">
                        {style.description}
                    </p>
                )}

                {/* Reason */}
                {(style as any).reason && (
                    <p className="text-[0.625rem] text-yellow-400/80 leading-relaxed line-clamp-2 border-l-2 border-yellow-400/30 pl-2">
                        {(style as any).reason}
                    </p>
                )}
            </div>
        </motion.div>
    );
}

function AIRecommendationModal({ style, isSelected, editing, positivePrompt, negativePrompt, onPositiveChange, onNegativeChange, onStartEditing, onApply, onClose }: {
    style: StyleConfig;
    isSelected: boolean;
    editing: boolean;
    positivePrompt: string;
    negativePrompt: string;
    onPositiveChange: (v: string) => void;
    onNegativeChange: (v: string) => void;
    onStartEditing: () => void;
    onApply: () => void;
    onClose: () => void;
}) {
    const ta = useTranslations("artDirection");
    const keywords = style.positive_prompt
        .split(",")
        .map(s => s.trim())
        .filter(s => s.length > 0 && s.length < 40)
        .slice(0, 6);

    const isCustomized = editing && (
        positivePrompt !== style.positive_prompt ||
        negativePrompt !== style.negative_prompt
    );

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-[100] bg-overlay backdrop-blur-sm grid place-items-center p-6"
            onClick={onClose}
        >
            <motion.div
                initial={{ opacity: 0, scale: 0.96, y: 8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: 8 }}
                transition={{ duration: 0.2 }}
                className="w-[70vw] max-w-[1100px] min-w-[700px] max-h-[90vh] rounded-2xl border border-glass-border bg-elevated shadow-[0_24px_64px_-12px_rgba(0,0,0,0.7)] overflow-hidden flex flex-col"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <header className="flex items-center justify-between px-6 py-4 border-b border-glass-border shrink-0">
                    <div className="flex items-center gap-3">
                        <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-yellow-500/15 border border-yellow-500/20">
                            <Sparkles size={12} className="text-yellow-400" />
                            <span className="text-[0.6875rem] font-medium text-yellow-300">AI</span>
                        </div>
                        <div>
                            <h2 className="text-[1.125rem] font-bold text-foreground">{style.name}</h2>
                            {style.description && (
                                <p className="text-[0.75rem] text-text-muted mt-0.5">{style.description}</p>
                            )}
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 rounded-lg hover:bg-hover-bg text-text-muted hover:text-foreground transition-colors">
                        <X size={18} />
                    </button>
                </header>

                {/* Body: left reason + tags | right prompts */}
                <div className="flex-1 min-h-0 flex overflow-hidden">
                    {/* Left panel: reason + keyword tags */}
                    <div className="w-[38%] shrink-0 bg-glass border-r border-glass-border p-6 flex flex-col justify-center">
                        {(style as any).reason && (
                            <div className="mb-6">
                                <p className="font-mono text-[0.5625rem] uppercase tracking-[0.18em] text-yellow-400/70 mb-2">{ta("reasonLabel")}</p>
                                <p className="text-[0.875rem] text-foreground leading-relaxed">
                                    {(style as any).reason}
                                </p>
                            </div>
                        )}
                        <div>
                            <p className="font-mono text-[0.5625rem] uppercase tracking-[0.18em] text-text-muted mb-3">{ta("keywordsLabel") || "Keywords"}</p>
                            <div className="flex flex-wrap gap-2">
                                {keywords.map((kw, i) => (
                                    <span key={i} className="text-[0.6875rem] px-2.5 py-1 rounded-md bg-yellow-500/10 text-yellow-300/90 border border-yellow-500/20">
                                        {kw}
                                    </span>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Right panel: prompts */}
                    <div className="flex-1 p-6 overflow-y-auto custom-scrollbar space-y-5">
                        {/* Positive prompt */}
                        <div>
                            <div className="flex items-center justify-between mb-2">
                                <p className="font-mono text-[0.5625rem] uppercase tracking-[0.18em] text-primary/70">{ta("positivePromptLabel")}</p>
                                {!editing && (
                                    <button
                                        onClick={onStartEditing}
                                        className="flex items-center gap-1 text-[0.6875rem] text-text-muted hover:text-foreground transition-colors"
                                    >
                                        <Pencil size={10} />
                                        {ta("customizeBtn") || "自定义"}
                                    </button>
                                )}
                            </div>
                            {editing ? (
                                <textarea
                                    value={positivePrompt}
                                    onChange={(e) => onPositiveChange(e.target.value)}
                                    className="w-full h-32 rounded-lg border border-glass-border bg-elevated px-3 py-2.5 text-[0.75rem] text-foreground leading-relaxed resize-none focus:outline-none focus:border-primary/50 custom-scrollbar"
                                />
                            ) : (
                                <div className="rounded-lg border border-glass-border bg-glass px-3 py-2.5">
                                    <p className="text-[0.75rem] text-text-secondary leading-relaxed whitespace-pre-wrap">
                                        {positivePrompt}
                                    </p>
                                </div>
                            )}
                        </div>

                        {/* Negative prompt */}
                        <div>
                            <p className="font-mono text-[0.5625rem] uppercase tracking-[0.18em] text-red-400/70 mb-2">{ta("negativePromptLabel")}</p>
                            {editing ? (
                                <textarea
                                    value={negativePrompt}
                                    onChange={(e) => onNegativeChange(e.target.value)}
                                    className="w-full h-24 rounded-lg border border-glass-border bg-elevated px-3 py-2.5 text-[0.75rem] text-foreground leading-relaxed resize-none focus:outline-none focus:border-red-400/30 custom-scrollbar"
                                />
                            ) : (
                                <div className="rounded-lg border border-glass-border bg-glass px-3 py-2.5">
                                    <p className="text-[0.75rem] text-text-secondary leading-relaxed whitespace-pre-wrap">
                                        {negativePrompt || ta("noNegativePrompt") || "—"}
                                    </p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <footer className="flex items-center justify-between px-6 py-3 border-t border-glass-border shrink-0">
                    <div className="text-[0.6875rem] text-text-muted">
                        {isCustomized && (
                            <span className="text-amber-300">{ta("modifiedLabel") || "已修改"}</span>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        <WorkflowActionButton variant="ghost" size="sm" onClick={onClose}>
                            {ta("cancelBtn") || "取消"}
                        </WorkflowActionButton>
                        <WorkflowActionButton
                            variant="primary"
                            size="sm"
                            leftIcon={isSelected ? <Check /> : undefined}
                            onClick={onApply}
                        >
                            {isSelected ? (ta("currentStyle") || "当前风格") : (ta("useThisStyle") || "使用该风格")}
                        </WorkflowActionButton>
                    </div>
                </footer>
            </motion.div>
        </motion.div>
    );
}

export function StylePresetCard({ style, isSelected, onSelect }: any) {
    return (
        <motion.div
            layout
            onClick={onSelect}
            className={`p-4 rounded-xl border-2 cursor-pointer transition-all ${isSelected
                ? "bg-blue-500/20 border-blue-500 shadow-lg shadow-blue-500/20"
                : "bg-surface border-glass-border hover:border-glass-border hover:bg-hover-bg"
                }`}
        >
            <div className="flex items-center gap-3 mb-2">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center ${isSelected ? 'bg-blue-500' : 'bg-hover-bg'}`}>
                    {isSelected && <Check size={12} className="text-foreground" />}
                </div>
                <h4 className="font-bold text-foreground text-sm">{style.name}</h4>
            </div>
            {style.description && (
                <p className="text-xs text-text-secondary mb-2">{style.description}</p>
            )}
            <div className="text-[0.625rem] text-text-muted truncate">
                {style.positive_prompt.substring(0, 50)}...
            </div>
        </motion.div>
    );
}

function StylePresetCardV2({ style, isSelected, onClick }: {
    style: StylePreset;
    isSelected: boolean;
    onClick: () => void;
}) {
    return (
        <motion.div
            layout
            onClick={onClick}
            className={`group relative rounded-xl border overflow-hidden cursor-pointer transition-all ${
                isSelected
                    ? "border-primary shadow-lg shadow-primary/20 ring-1 ring-primary/40"
                    : "border-glass-border hover:border-foreground/30 hover:shadow-sm"
            }`}
        >
            {/* Thumbnail */}
            <div className="relative aspect-[4/3] bg-elevated overflow-hidden">
                {style.thumbnail ? (
                    <img
                        src={style.thumbnail}
                        alt={style.name_zh}
                        className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                        style={{ objectPosition: style.object_position || "center" }}
                    />
                ) : (
                    <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-glass-border to-glass-border">
                        <ImageIcon size={24} className="text-text-muted/40" />
                    </div>
                )}
                {isSelected && (
                    <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-primary flex items-center justify-center shadow-md">
                        <Check size={11} className="text-foreground" />
                    </div>
                )}
            </div>

            {/* Info strip */}
            <div className="px-3 py-2.5">
                <h4 className="text-[0.75rem] font-semibold text-foreground leading-tight truncate">
                    {style.name_zh}
                </h4>
                {style.subtitle_zh && (
                    <p className="text-[0.625rem] text-text-muted mt-0.5 truncate">
                        {style.subtitle_zh}
                    </p>
                )}
            </div>
        </motion.div>
    );
}

function PresetDetailModal({ preset, isSelected, editing, positivePrompt, negativePrompt, onPositiveChange, onNegativeChange, onStartEditing, onApply, onClose, sameCategoryPresets, onSwitchPreset }: {
    preset: StylePreset;
    isSelected: boolean;
    editing: boolean;
    positivePrompt: string;
    negativePrompt: string;
    onPositiveChange: (v: string) => void;
    onNegativeChange: (v: string) => void;
    onStartEditing: () => void;
    onApply: () => void;
    onClose: () => void;
    sameCategoryPresets: StylePreset[];
    onSwitchPreset: (p: StylePreset) => void;
}) {
    const isCustomized = editing && (
        positivePrompt !== preset.positive_prompt ||
        negativePrompt !== preset.negative_prompt
    );

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-[100] bg-overlay backdrop-blur-sm grid place-items-center p-6"
            onClick={onClose}
        >
            <motion.div
                initial={{ opacity: 0, scale: 0.96, y: 8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: 8 }}
                transition={{ duration: 0.2 }}
                className="w-[70vw] max-w-[1100px] min-w-[700px] max-h-[90vh] rounded-2xl border border-glass-border bg-elevated shadow-[0_24px_64px_-12px_rgba(0,0,0,0.7)] overflow-hidden flex flex-col"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <header className="flex items-center justify-between px-6 py-4 border-b border-glass-border shrink-0">
                    <div>
                        <h2 className="text-[1.125rem] font-bold text-foreground">{preset.name_zh}</h2>
                        <p className="text-[0.75rem] text-text-muted mt-0.5">{preset.name}</p>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 rounded-lg hover:bg-hover-bg text-text-muted hover:text-foreground transition-colors"
                    >
                        <X size={18} />
                    </button>
                </header>

                {/* Body: left image + right details */}
                <div className="flex-1 min-h-0 grid grid-cols-[1fr_1fr] overflow-hidden">
                    {/* Left: full image display (no crop) */}
                    <div className="bg-black/40 flex items-center justify-center p-4 overflow-hidden">
                        {preset.thumbnail ? (
                            <img
                                src={preset.thumbnail}
                                alt={preset.name_zh}
                                className="max-w-full max-h-full object-contain rounded-lg"
                            />
                        ) : (
                            <div className="w-full h-full flex items-center justify-center">
                                <ImageIcon size={48} className="text-text-muted/30" />
                            </div>
                        )}
                    </div>

                    {/* Right: details (scrollable) */}
                    <div className="p-6 space-y-5 overflow-y-auto">
                        {/* Description */}
                        {preset.description && (
                            <p className="text-[0.8125rem] text-text-secondary leading-relaxed">{preset.description}</p>
                        )}

                        {/* Tags */}
                        {preset.best_for && preset.best_for.length > 0 && (
                            <div className="flex flex-wrap gap-2">
                                {preset.best_for.map((tag, i) => (
                                    <span key={i} className="text-[0.6875rem] px-2.5 py-1 rounded-md bg-green-500/10 text-green-300 border border-green-500/20">
                                        {tag}
                                    </span>
                                ))}
                                {preset.avoid_for?.map((tag, i) => (
                                    <span key={`avoid-${i}`} className="text-[0.6875rem] px-2.5 py-1 rounded-md bg-red-500/10 text-red-300/70 border border-red-500/15 line-through">
                                        {tag}
                                    </span>
                                ))}
                            </div>
                        )}

                        {/* Prompts section */}
                        <div className="space-y-4">
                            <div className="flex items-center justify-between">
                                <p className="text-[0.6875rem] uppercase tracking-wider text-text-muted font-medium">提示词</p>
                                {!editing && (
                                    <button
                                        onClick={onStartEditing}
                                        className="flex items-center gap-1.5 text-[0.6875rem] text-text-muted hover:text-foreground transition-colors"
                                    >
                                        <Pencil size={12} />
                                        <span>自定义</span>
                                    </button>
                                )}
                                {editing && isCustomized && (
                                    <span className="text-[0.625rem] text-amber-300 font-medium">已修改</span>
                                )}
                            </div>

                            {!editing ? (
                                <>
                                    <div>
                                        <p className="text-[0.625rem] text-text-muted mb-1.5">正向</p>
                                        <p className="text-[0.8125rem] text-text-secondary leading-relaxed">
                                            {preset.positive_prompt}
                                        </p>
                                    </div>
                                    <div>
                                        <p className="text-[0.625rem] text-text-muted mb-1.5">负向</p>
                                        <p className="text-[0.8125rem] text-text-secondary leading-relaxed">
                                            {preset.negative_prompt}
                                        </p>
                                    </div>
                                </>
                            ) : (
                                <>
                                    <div>
                                        <p className="text-[0.625rem] text-text-muted mb-1.5">正向</p>
                                        <textarea
                                            value={positivePrompt}
                                            onChange={(e) => onPositiveChange(e.target.value)}
                                            rows={5}
                                            className="w-full bg-input-bg border border-glass-border rounded-lg p-3 text-[0.8125rem] text-foreground placeholder-text-muted focus:border-primary focus:outline-none resize-none"
                                        />
                                    </div>
                                    <div>
                                        <p className="text-[0.625rem] text-text-muted mb-1.5">负向</p>
                                        <textarea
                                            value={negativePrompt}
                                            onChange={(e) => onNegativeChange(e.target.value)}
                                            rows={3}
                                            className="w-full bg-input-bg border border-glass-border rounded-lg p-3 text-[0.8125rem] text-foreground placeholder-text-muted focus:border-primary focus:outline-none resize-none"
                                        />
                                    </div>
                                </>
                            )}
                        </div>

                        {/* Sample prompt */}
                        {preset.sample_prompt && !editing && (
                            <div>
                                <p className="text-[0.625rem] uppercase tracking-wider text-text-muted mb-1.5">示例描述</p>
                                <p className="text-[0.8125rem] text-text-secondary/70 leading-relaxed italic">
                                    {preset.sample_prompt}
                                </p>
                            </div>
                        )}
                    </div>
                </div>

                {/* Same-category comparison strip */}
                {sameCategoryPresets.length > 0 && (
                    <div className="border-t border-glass-border px-6 py-3 shrink-0">
                        <p className="text-[0.625rem] uppercase tracking-wider text-text-muted mb-2">同类风格</p>
                        <div className="flex gap-2.5 overflow-x-auto pb-1">
                            {sameCategoryPresets.slice(0, 5).map(p => (
                                <button
                                    key={p.id}
                                    onClick={() => onSwitchPreset(p)}
                                    className="shrink-0 w-24 rounded-lg overflow-hidden border border-glass-border hover:border-foreground/30 transition-colors"
                                >
                                    {p.thumbnail ? (
                                        <img
                                            src={p.thumbnail}
                                            alt={p.name_zh}
                                            className="w-full aspect-[16/9] object-cover"
                                            style={{ objectPosition: p.object_position || "center" }}
                                        />
                                    ) : (
                                        <div className="w-full aspect-[16/9] bg-elevated flex items-center justify-center">
                                            <ImageIcon size={12} className="text-text-muted/40" />
                                        </div>
                                    )}
                                    <p className="text-[0.625rem] text-text-muted px-1.5 py-1 truncate">{p.name_zh}</p>
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {/* Footer actions */}
                <footer className="flex items-center justify-end gap-3 px-6 py-4 border-t border-glass-border shrink-0">
                    <WorkflowActionButton variant="ghost" onClick={onClose}>
                        取消
                    </WorkflowActionButton>
                    <WorkflowActionButton
                        variant="primary"
                        leftIcon={<Check />}
                        onClick={onApply}
                    >
                        {isSelected ? "已选择" : isCustomized ? "应用自定义风格" : "使用此风格"}
                    </WorkflowActionButton>
                </footer>
            </motion.div>
        </motion.div>
    );
}
