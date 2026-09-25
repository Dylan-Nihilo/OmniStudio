"use client";

import React, { useState, useEffect } from 'react';
import { Settings, Image, Video, Film, Check, Layout, User, Building, Box, RotateCcw } from 'lucide-react';
import { useProjectStore, IMAGE_MODELS, I2V_MODELS, ASPECT_RATIOS } from '@/store/projectStore';
import { resolveModelSettings, VIDEO_R2V_MODELS, DEFAULT_R2V_MODEL_ID } from '@/lib/modelCatalog';
import { api } from '@/lib/api';
import { useTranslations } from "next-intl";
import GroupedModelGrid from '@/components/common/GroupedModelGrid';
import { Dialog } from '@omnistudio/ui';
import type { FrontendModelSettings } from '@/lib/modelCatalog';

interface ModelSettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
}

const MODEL_FIELDS = [
    't2i_model', 'i2i_model', 'image_model', 'i2v_model', 'r2v_model',
    'character_aspect_ratio', 'scene_aspect_ratio', 'prop_aspect_ratio', 'storyboard_aspect_ratio',
] as const satisfies readonly (keyof FrontendModelSettings)[];

export default function ModelSettingsModal({ isOpen, onClose }: ModelSettingsModalProps) {
    const currentProject = useProjectStore((state) => state.currentProject);
    const t = useTranslations("models");
    const tc = useTranslations("common");
    const updateProject = useProjectStore((state) => state.updateProject);
    const isEpisode = Boolean(currentProject?.series_id);
    const resolvedSettings = resolveModelSettings(currentProject?.model_settings, 'project_settings');

    const [t2iModel, setT2iModel] = useState(resolvedSettings.t2i_model);
    const [i2iModel, setI2iModel] = useState(resolvedSettings.i2i_model);
    const [i2vModel, setI2vModel] = useState(resolvedSettings.i2v_model);
    // R2V default for the project. Storyboard's R2V tab seeds from
    // here on first mount; per-storyboard localStorage override still
    // wins. Falls back to catalog's DEFAULT_R2V_MODEL_ID when the
    // project has no r2v_model set yet (older projects).
    const [r2vModel, setR2vModel] = useState(resolvedSettings.r2v_model || DEFAULT_R2V_MODEL_ID);
    const [characterAspectRatio, setCharacterAspectRatio] = useState(resolvedSettings.character_aspect_ratio);
    const [sceneAspectRatio, setSceneAspectRatio] = useState(resolvedSettings.scene_aspect_ratio);
    const [propAspectRatio, setPropAspectRatio] = useState(resolvedSettings.prop_aspect_ratio);
    const [storyboardAspectRatio, setStoryboardAspectRatio] = useState(resolvedSettings.storyboard_aspect_ratio);
    const [isSaving, setIsSaving] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);
    const [changedFields, setChangedFields] = useState<Partial<Record<keyof FrontendModelSettings, boolean>>>({});
    const [resetFields, setResetFields] = useState<string[]>([]);

    // Sync state when project changes
    useEffect(() => {
        const normalizedSettings = resolveModelSettings(currentProject?.model_settings, 'project_settings');
        setT2iModel(normalizedSettings.t2i_model);
        setI2iModel(normalizedSettings.i2i_model);
        setI2vModel(normalizedSettings.i2v_model);
        setR2vModel(normalizedSettings.r2v_model || DEFAULT_R2V_MODEL_ID);
        setCharacterAspectRatio(normalizedSettings.character_aspect_ratio);
        setSceneAspectRatio(normalizedSettings.scene_aspect_ratio);
        setPropAspectRatio(normalizedSettings.prop_aspect_ratio);
        setStoryboardAspectRatio(normalizedSettings.storyboard_aspect_ratio);
        setChangedFields({});
        setResetFields([]);
        setSaveError(null);
    }, [currentProject?.model_settings]);

    const updateField = <K extends keyof FrontendModelSettings>(
        field: K,
        setter: (value: FrontendModelSettings[K]) => void,
        value: FrontendModelSettings[K],
    ) => {
        setter(value);
        setSaveError(null);
        if (isEpisode) {
            setChangedFields(current => ({ ...current, [field]: true }));
            setResetFields(current => current.filter(item => item !== field));
        }
    };

    const restoreEpisodeInheritance = () => {
        if (!isEpisode) return;
        setResetFields([...MODEL_FIELDS]);
        setChangedFields({});
    };

    const handleSave = async () => {
        if (!currentProject) return;
        if (isSaving) return;
        setIsSaving(true);
        setSaveError(null);
        try {
            const values: Partial<Record<keyof FrontendModelSettings, string>> = {
                t2i_model: t2iModel,
                i2i_model: i2iModel,
                i2v_model: i2vModel,
                r2v_model: r2vModel,
                character_aspect_ratio: characterAspectRatio,
                scene_aspect_ratio: sceneAspectRatio,
                prop_aspect_ratio: propAspectRatio,
                storyboard_aspect_ratio: storyboardAspectRatio,
            };
            const valueFor = (field: keyof FrontendModelSettings) => isEpisode && !changedFields[field] ? undefined : values[field];
            const updated = await api.updateModelSettings(
                currentProject.id,
                valueFor('t2i_model'),
                valueFor('i2i_model'),
                valueFor('i2v_model'),
                valueFor('character_aspect_ratio'),
                valueFor('scene_aspect_ratio'),
                valueFor('prop_aspect_ratio'),
                valueFor('storyboard_aspect_ratio'),
                undefined, // imageModel — managed via t2i/i2i for now
                valueFor('r2v_model'),
                isEpisode ? resetFields : undefined,
            );
            updateProject(currentProject.id, updated);
            onClose();
        } catch (error) {
            console.error("Failed to save model settings:", error);
            setSaveError(t("saveSettingsFailed"));
        } finally {
            setIsSaving(false);
        }
    };

    if (!isOpen) return null;

    return (
        <Dialog
            isOpen={isOpen}
            title={
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-gradient-to-br from-blue-500/20 to-purple-500/20 rounded-lg">
                        <Settings size={20} className="text-blue-400" />
                    </div>
                    <div>
                        <span className="block text-lg font-bold text-foreground">{t("genSettings")}</span>
                        <span className="block text-xs font-normal text-text-muted">{t("genSettingsDesc")}</span>
                    </div>
                    {isEpisode && (
                        <button
                            type="button"
                            onClick={restoreEpisodeInheritance}
                            aria-label={t("resetModelInheritance")}
                            className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-glass-border px-2.5 py-1.5 text-xs font-normal text-text-secondary hover:text-foreground hover:bg-hover-bg"
                        >
                            <RotateCcw size={13} />
                            {t("resetModelInheritance")}
                        </button>
                    )}
                </div>
            }
            closeLabel={tc("close")}
            className="w-full max-w-3xl"
            isDismissable={!isSaving}
            onOpenChange={open => { if (!open && !isSaving) onClose(); }}
            footer={
                <div className="flex w-full justify-end gap-3">
                    {saveError ? (
                        <p role="alert" className="mr-auto self-center text-sm text-red-300">{saveError}</p>
                    ) : null}
                    <button
                        onClick={onClose}
                        disabled={isSaving}
                        className="px-4 py-2 text-sm text-text-secondary hover:text-foreground transition-colors disabled:cursor-wait disabled:opacity-50"
                    >
                        {tc("cancel")}
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={isSaving}
                        className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white text-sm font-medium rounded-lg transition-all disabled:opacity-50"
                    >
                        {isSaving ? (
                            <>
                                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                                {t("saving")}
                            </>
                        ) : (
                            <>
                                <Check size={16} />
                                {t("saveSettings")}
                            </>
                        )}
                    </button>
                </div>
            }
        >

                    {/* Content */}
                    <div className="space-y-6">
                        {/* Assets Section */}
                        <div className="space-y-5">
                            <div className="flex items-center gap-2 text-sm font-bold text-foreground">
                                <Image size={16} className="text-green-400" />
                                <span>{t("assetsT2I")}</span>
                            </div>

                            {/* T2I Model */}
                            <div className="space-y-2">
                                <label className="text-xs text-text-secondary">{t("model")}</label>
                                <GroupedModelGrid
                                    models={IMAGE_MODELS}
                                    selectedId={t2iModel}
                                    onSelect={(id) => updateField('t2i_model', setT2iModel, id)}
                                />
                            </div>

                            {/* Asset Aspect Ratios */}
                            <div className="grid grid-cols-3 gap-4">
                                {/* Character Aspect Ratio */}
                                <div className="space-y-2">
                                    <div className="flex items-center gap-1 text-xs text-text-secondary">
                                        <User size={12} />
                                        <label>{t("assetCharacter")}</label>
                                    </div>
                                    <div className="space-y-1">
                                        {ASPECT_RATIOS.map((ratio) => (
                                            <button
                                                key={ratio.id}
                                                onClick={() => updateField('character_aspect_ratio', setCharacterAspectRatio, ratio.id)}
                                                className={`w-full flex flex-col items-center py-1.5 px-2 rounded border transition-all ${characterAspectRatio === ratio.id
                                                        ? 'border-green-500/50 bg-green-500/10'
                                                        : 'border-glass-border hover:border-glass-border bg-glass'
                                                    }`}
                                            >
                                                <span className="text-xs font-medium text-foreground">{ratio.name}</span>
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* Scene Aspect Ratio */}
                                <div className="space-y-2">
                                    <div className="flex items-center gap-1 text-xs text-text-secondary">
                                        <Building size={12} />
                                        <label>{t("assetScene")}</label>
                                    </div>
                                    <div className="space-y-1">
                                        {ASPECT_RATIOS.map((ratio) => (
                                            <button
                                                key={ratio.id}
                                                onClick={() => updateField('scene_aspect_ratio', setSceneAspectRatio, ratio.id)}
                                                className={`w-full flex flex-col items-center py-1.5 px-2 rounded border transition-all ${sceneAspectRatio === ratio.id
                                                        ? 'border-green-500/50 bg-green-500/10'
                                                        : 'border-glass-border hover:border-glass-border bg-glass'
                                                    }`}
                                            >
                                                <span className="text-xs font-medium text-foreground">{ratio.name}</span>
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* Prop Aspect Ratio */}
                                <div className="space-y-2">
                                    <div className="flex items-center gap-1 text-xs text-text-secondary">
                                        <Box size={12} />
                                        <label>{t("assetProp")}</label>
                                    </div>
                                    <div className="space-y-1">
                                        {ASPECT_RATIOS.map((ratio) => (
                                            <button
                                                key={ratio.id}
                                                onClick={() => updateField('prop_aspect_ratio', setPropAspectRatio, ratio.id)}
                                                className={`w-full flex flex-col items-center py-1.5 px-2 rounded border transition-all ${propAspectRatio === ratio.id
                                                        ? 'border-green-500/50 bg-green-500/10'
                                                        : 'border-glass-border hover:border-glass-border bg-glass'
                                                    }`}
                                            >
                                                <span className="text-xs font-medium text-foreground">{ratio.name}</span>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="border-t border-glass-border" />

                        {/* Storyboard Section */}
                        <div className="space-y-4">
                            <div className="flex items-center gap-2 text-sm font-bold text-foreground">
                                <Layout size={16} className="text-blue-400" />
                                <span>{t("storyboardI2I")}</span>
                            </div>

                            {/* I2I Model */}
                            <div className="space-y-2">
                                <label className="text-xs text-text-secondary">{t("model")}</label>
                                <GroupedModelGrid
                                    models={IMAGE_MODELS}
                                    selectedId={i2iModel}
                                    onSelect={(id) => updateField('i2i_model', setI2iModel, id)}
                                />
                            </div>

                            {/* Storyboard Aspect Ratio */}
                            <div className="space-y-2">
                                <label className="text-xs text-text-secondary">{t("storyboardAspectLabel")}</label>
                                <div className="grid grid-cols-3 gap-2">
                                    {ASPECT_RATIOS.map((ratio) => (
                                        <button
                                            key={ratio.id}
                                            onClick={() => updateField('storyboard_aspect_ratio', setStoryboardAspectRatio, ratio.id)}
                                            className={`flex flex-col items-center p-3 rounded-lg border transition-all ${storyboardAspectRatio === ratio.id
                                                    ? 'border-blue-500/50 bg-blue-500/10'
                                                    : 'border-glass-border hover:border-glass-border bg-glass'
                                                }`}
                                        >
                                            <span className="text-sm font-medium text-foreground">{ratio.name}</span>
                                            <span className="text-[0.625rem] text-text-muted">{ratio.description}</span>
                                        </button>
                                    ))}
                                </div>
                                <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 px-3 py-2 text-xs text-text-muted">
                                    <p className="font-medium text-text-secondary">{t("aspectRatioRuleTitle")}</p>
                                    <p>{t("aspectRatioRuleMaster")}</p>
                                    <p>{t("aspectRatioRuleInherited")}</p>
                                    <p>{t("aspectRatioRuleIndependent")}</p>
                                </div>
                            </div>
                        </div>

                        <div className="border-t border-glass-border" />

                        {/* Motion Section */}
                        <div className="space-y-4">
                            <div className="flex items-center gap-2 text-sm font-bold text-foreground">
                                <Video size={16} className="text-purple-400" />
                                <span>{t("motionI2V")}</span>
                            </div>
                            <p className="text-xs text-text-muted">{t("motionFollowsAR")}</p>

                            {/* I2V Model */}
                            <div className="space-y-2">
                                <label className="text-xs text-text-secondary">{t("model")}</label>
                                <GroupedModelGrid
                                    models={I2V_MODELS}
                                    selectedId={i2vModel}
                                    onSelect={(id) => updateField('i2v_model', setI2vModel, id)}
                                />
                            </div>
                        </div>

                        <div className="border-t border-glass-border" />

                        {/* R2V Section — Reference-to-Video. Project default;
                            Storyboard R2V tab seeds from here on first mount,
                            per-storyboard localStorage override still wins. */}
                        <div className="space-y-4">
                            <div className="flex items-center gap-2 text-sm font-bold text-foreground">
                                <Film size={16} className="text-pink-400" />
                                <span>R2V · 参考生视频</span>
                            </div>
                            <p className="text-xs text-text-muted">
                                项目级 R2V 模型默认值。Storyboard 的 R2V tab 进入时按此初始化；用户在 storyboard 内的临时切换会保存在本地、不影响这里。
                            </p>

                            <div className="space-y-2">
                                <label className="text-xs text-text-secondary">{t("model")}</label>
                                <GroupedModelGrid
                                    models={VIDEO_R2V_MODELS}
                                    selectedId={r2vModel}
                                    onSelect={(id) => updateField('r2v_model', value => setR2vModel(value ?? DEFAULT_R2V_MODEL_ID), id)}
                                />
                            </div>
                        </div>
                    </div>

        </Dialog>
    );
}
