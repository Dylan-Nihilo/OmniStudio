"use client";

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Settings, X, Image, Video, Layout, Check, User, Building, Box, Loader2, RotateCcw } from 'lucide-react';
import { ASPECT_RATIOS } from '@/store/projectStore';
import {
    SERIES_IMAGE_MODELS,
    SERIES_I2V_MODELS,
    SERIES_R2V_MODELS,
    resolveModelSettings,
} from '@/lib/modelCatalog';
import type { FrontendModelSettings } from '@/lib/modelCatalog';
import { api } from '@/lib/api';
import { useTranslations } from "next-intl";
import GroupedModelGrid from '@/components/common/GroupedModelGrid';

interface SeriesModelSettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
    seriesId: string;
    onSaved?: () => void;
}

const SERIES_MODEL_FIELDS = [
    't2i_model', 'i2i_model', 'image_model', 'i2v_model', 'r2v_model',
    'character_aspect_ratio', 'scene_aspect_ratio', 'prop_aspect_ratio', 'storyboard_aspect_ratio',
] as const satisfies readonly (keyof FrontendModelSettings)[];

export default function SeriesModelSettingsModal({ isOpen, onClose, seriesId, onSaved }: SeriesModelSettingsModalProps) {
    const t = useTranslations("models");
    const tc = useTranslations("common");
    const defaultSettings = resolveModelSettings(undefined, 'series_settings');
    const [t2iModel, setT2iModel] = useState(defaultSettings.t2i_model);
    const [i2iModel, setI2iModel] = useState(defaultSettings.i2i_model);
    const [i2vModel, setI2vModel] = useState(defaultSettings.i2v_model);
    const [r2vModel, setR2vModel] = useState(defaultSettings.r2v_model);
    const [characterAspectRatio, setCharacterAspectRatio] = useState(defaultSettings.character_aspect_ratio);
    const [sceneAspectRatio, setSceneAspectRatio] = useState(defaultSettings.scene_aspect_ratio);
    const [propAspectRatio, setPropAspectRatio] = useState(defaultSettings.prop_aspect_ratio);
    const [storyboardAspectRatio, setStoryboardAspectRatio] = useState(defaultSettings.storyboard_aspect_ratio);
    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [changedFields, setChangedFields] = useState<Partial<Record<keyof FrontendModelSettings, boolean>>>({});
    const [resetFields, setResetFields] = useState<string[]>([]);

    useEffect(() => {
        if (isOpen && seriesId) {
            setIsLoading(true);
            setLoadError(null);
            api.getEffectiveSeriesModelSettings(seriesId)
                .then(({ settings, sources }) => {
                    const resolvedSettings = resolveModelSettings(settings, 'series_settings');
                    setT2iModel(resolvedSettings.t2i_model);
                    setI2iModel(resolvedSettings.i2i_model);
                    setI2vModel(resolvedSettings.i2v_model);
                    setR2vModel(resolvedSettings.r2v_model);
                    setCharacterAspectRatio(resolvedSettings.character_aspect_ratio);
                    setSceneAspectRatio(resolvedSettings.scene_aspect_ratio);
                    setPropAspectRatio(resolvedSettings.prop_aspect_ratio);
                    setStoryboardAspectRatio(resolvedSettings.storyboard_aspect_ratio);
                    setChangedFields(Object.fromEntries(
                        SERIES_MODEL_FIELDS.filter(field => sources[field] === 'project').map(field => [field, true]),
                    ));
                    setResetFields([]);
                })
                .catch((err) => {
                    console.error("Failed to load series model settings:", err);
                    setLoadError(t("loadSettingsFailed"));
                })
                .finally(() => setIsLoading(false));
        }
    }, [isOpen, seriesId]);

    const updateField = <K extends keyof FrontendModelSettings>(
        field: K,
        setter: (value: FrontendModelSettings[K]) => void,
        value: FrontendModelSettings[K],
    ) => {
        setter(value);
        setChangedFields(current => ({ ...current, [field]: true }));
        setResetFields(current => current.filter(item => item !== field));
    };

    const restoreSeriesInheritance = () => {
        setChangedFields({});
        setResetFields([...SERIES_MODEL_FIELDS]);
    };

    const handleSave = async () => {
        setIsSaving(true);
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
            const payload = Object.fromEntries(
                SERIES_MODEL_FIELDS.filter(field => changedFields[field]).map(field => [field, values[field]]),
            );
            await api.updateSeriesModelSettings(seriesId, { ...payload, reset_fields: resetFields });
            onSaved?.();
            onClose();
        } catch (error) {
            console.error("Failed to save series model settings:", error);
            alert(t("saveSettingsFailed"));
        } finally {
            setIsSaving(false);
        }
    };

    if (!isOpen) return null;

    return (
        <AnimatePresence>
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-50 bg-overlay backdrop-blur-sm flex items-center justify-center p-4"
                onClick={onClose}
            >
                <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="bg-elevated rounded-2xl border border-glass-border w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col"
                    onClick={(e) => e.stopPropagation()}
                >
                    {/* Header */}
                    <div className="flex items-center justify-between p-5 border-b border-glass-border">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-gradient-to-br from-blue-500/20 to-purple-500/20 rounded-lg">
                                <Settings size={20} className="text-blue-400" />
                            </div>
                            <div>
                                <h2 className="text-lg font-bold text-foreground">{t("seriesGenSettings")}</h2>
                                <p className="text-xs text-text-secondary">{t("seriesGenSettingsDesc")}</p>
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={restoreSeriesInheritance}
                            aria-label={t("resetModelInheritance")}
                            className="inline-flex items-center gap-1.5 rounded-md border border-glass-border px-2.5 py-1.5 text-xs text-text-secondary hover:text-foreground hover:bg-hover-bg"
                        >
                            <RotateCcw size={13} />
                            {t("resetModelInheritance")}
                        </button>
                        <button onClick={onClose} className="p-2 hover:bg-hover-bg rounded-lg transition-colors">
                            <X size={20} className="text-text-secondary" />
                        </button>
                    </div>

                    {/* Content */}
                    <div className="p-5 space-y-6 overflow-y-auto">
                        {isLoading ? (
                            <div className="flex items-center justify-center py-12">
                                <Loader2 size={24} className="animate-spin text-blue-400" />
                                <span className="ml-2 text-text-secondary">{t("loadingSettings")}</span>
                            </div>
                        ) : loadError ? (
                            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 text-sm text-red-300">
                                {loadError}
                            </div>
                        ) : (
                            <>
                                {/* Assets Section */}
                                <div className="space-y-5">
                                    <div className="flex items-center gap-2 text-sm font-bold text-foreground">
                                        <Image size={16} className="text-green-400" />
                                        <span>{t("assetsT2I")}</span>
                                    </div>

                                    <div className="space-y-2">
                                        <label className="text-xs text-text-secondary">{t("model")}</label>
                                        <GroupedModelGrid
                                            models={SERIES_IMAGE_MODELS}
                                            selectedId={t2iModel}
                                            onSelect={(id) => updateField('t2i_model', setT2iModel, id)}
                                        />
                                    </div>

                                    <div className="grid grid-cols-3 gap-4">
                                        {([
                                            { key: 'character', label: t("character"), icon: User, value: characterAspectRatio, setter: setCharacterAspectRatio },
                                            { key: 'scene', label: t("scene"), icon: Building, value: sceneAspectRatio, setter: setSceneAspectRatio },
                                            { key: 'prop', label: t("prop"), icon: Box, value: propAspectRatio, setter: setPropAspectRatio },
                                        ]).map(({ key, label, icon: Icon, value, setter }) => (
                                            <div key={key} className="space-y-2">
                                                <div className="flex items-center gap-1 text-xs text-text-secondary">
                                                    <Icon size={12} />
                                                    <label>{label}</label>
                                                </div>
                                                <div className="space-y-1">
                                                    {ASPECT_RATIOS.map((ratio) => (
                                                        <button
                                                            key={ratio.id}
                                                            onClick={() => updateField(`${key}_aspect_ratio` as keyof FrontendModelSettings, value => setter(value ?? ratio.id), ratio.id)}
                                                            className={`w-full flex flex-col items-center py-2 px-2 rounded border transition-all ${value === ratio.id
                                                                ? 'border-green-500/50 bg-green-500/10'
                                                                : 'border-glass-border hover:border-glass-border bg-glass'
                                                            }`}
                                                        >
                                                            <span className="text-xs font-medium text-foreground">{ratio.name}</span>
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                <div className="border-t border-glass-border" />

                                {/* Storyboard Section */}
                                <div className="space-y-4">
                                    <div className="flex items-center gap-2 text-sm font-bold text-foreground">
                                        <Layout size={16} className="text-blue-400" />
                                        <span>{t("storyboardI2I")}</span>
                                    </div>

                                    <div className="space-y-2">
                                        <label className="text-xs text-text-secondary">{t("model")}</label>
                                        <GroupedModelGrid
                                            models={SERIES_IMAGE_MODELS}
                                            selectedId={i2iModel}
                                            onSelect={(id) => updateField('i2i_model', setI2iModel, id)}
                                        />
                                    </div>

                                    <div className="space-y-2">
                                        <label className="text-xs text-text-secondary">{t("aspectRatio")}</label>
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
                                                    <span className="text-[0.625rem] text-text-secondary">{ratio.description}</span>
                                                </button>
                                            ))}
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
                                    <p className="text-xs text-text-secondary">{t("motionFollowsAR")}</p>

                                    <div className="space-y-2">
                                        <label className="text-xs text-text-secondary">{t("model")}</label>
                                        <GroupedModelGrid
                                            models={SERIES_I2V_MODELS}
                                            selectedId={i2vModel}
                                            onSelect={(id) => updateField('i2v_model', setI2vModel, id)}
                                        />
                                    </div>
                                </div>

                                <div className="border-t border-glass-border" />

                                <div className="space-y-4">
                                    <div className="flex items-center gap-2 text-sm font-bold text-foreground">
                                        <Video size={16} className="text-pink-400" />
                                        <span>R2V · 参考生视频</span>
                                    </div>
                                    <p className="text-xs text-text-secondary">项目级 R2V 默认值；未覆盖时继承 Workspace。</p>
                                    <GroupedModelGrid
                                        models={SERIES_R2V_MODELS}
                                        selectedId={r2vModel ?? ''}
                                        onSelect={(id) => updateField('r2v_model', value => setR2vModel(value), id)}
                                    />
                                </div>
                            </>
                        )}
                    </div>

                    {/* Footer */}
                    <div className="flex justify-end gap-3 p-5 border-t border-glass-border bg-surface">
                        <button
                            onClick={onClose}
                            className="px-4 py-2 text-sm text-text-secondary hover:text-foreground transition-colors"
                        >
                            {tc("cancel")}
                        </button>
                        <button
                            onClick={handleSave}
                            disabled={isSaving || isLoading || !!loadError}
                            className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-foreground text-sm font-medium rounded-lg transition-all disabled:opacity-50"
                        >
                            {isSaving ? (
                                <>
                                    <Loader2 size={16} className="animate-spin" />
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
                </motion.div>
            </motion.div>
        </AnimatePresence>
    );
}
