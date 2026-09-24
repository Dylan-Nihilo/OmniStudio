"use client";

import { SelectField } from "@omnistudio/ui";
import React, { useState, useEffect } from 'react';
import { FileText, RotateCcw, ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import { getTextTiers } from "@/lib/modelCatalog";
import { useTranslations } from 'next-intl';
import { useProjectStore } from '@/store/projectStore';
import { api } from '@/lib/api';
import { Dialog } from '@omnistudio/ui';

/**
 * Tier options for the polish model, inherit-first.
 *
 * The stored value is the provider's own model name, because that string is handed to the
 * LLM adapter and billing charges against it; only the label is the tier a writer picks by.
 * A value the catalog no longer offers is kept as its own option so opening an older
 * project does not silently retarget its model.
 */
function textModelOptions(inheritLabel: string, current: string): { id: string; label: string }[] {
    const tiers = getTextTiers();
    const options = [
        { id: "__default__", label: inheritLabel },
        ...tiers.filter(tier => tier.id && tier.name).filter((tier, index, all) => all.findIndex(item => item.id === tier.id) === index).map(tier => ({ id: tier.id, label: tier.name })),
    ];
    if (current && !tiers.some(tier => tier.id === current)) {
        options.push({ id: current, label: current });
    }
    return options;
}

interface PromptConfigModalProps {
    isOpen: boolean;
    onClose: () => void;
}

interface PromptDefaults {
    storyboard_polish: string;
    video_polish: string;
    r2v_polish: string;
}

const SECTIONS = [
    {
        key: 'storyboard_polish' as const,
        label: 'Storyboard Polish (Prompt C)',
        description: 'System prompt for storyboard/image prompt polishing. Placeholders: {ASSETS} (asset context), {DRAFT} (user draft prompt).',
    },
    {
        key: 'video_polish' as const,
        label: 'Video I2V Polish (Prompt D)',
        description: 'System prompt for Image-to-Video prompt polishing. No dynamic placeholders needed.',
    },
    {
        key: 'r2v_polish' as const,
        label: 'Video R2V Polish (Prompt E)',
        description: 'System prompt for Reference-to-Video prompt polishing. Placeholder: {SLOTS} (character slot context).',
    },
];

export default function PromptConfigModal({ isOpen, onClose }: PromptConfigModalProps) {
    const currentProject = useProjectStore((state) => state.currentProject);
    const updateProject = useProjectStore((state) => state.updateProject);
    const t = useTranslations("project");
    const tc = useTranslations("common");

    const [config, setConfig] = useState({ storyboard_polish: '', video_polish: '', r2v_polish: '', polish_model: '' });
    const [initialConfig, setInitialConfig] = useState<typeof config | null>(null);
    const [defaults, setDefaults] = useState<PromptDefaults | null>(null);
    const [expandedDefault, setExpandedDefault] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [saveError, setSaveError] = useState<string | null>(null);
    const [confirmClose, setConfirmClose] = useState(false);

    useEffect(() => {
        if (isOpen && currentProject) {
            setIsLoading(true);
            setLoadError(null);
            setSaveError(null);
            setConfirmClose(false);
            setExpandedDefault(null);
            api.getPromptConfig(currentProject.id)
                .then((data) => {
                    setConfig(data.prompt_config);
                    setInitialConfig(data.prompt_config);
                    setDefaults(data.defaults);
                })
                .catch((err) => {
                    console.error("Failed to load prompt config:", err);
                    setLoadError(t("promptLoadFailed"));
                })
                .finally(() => setIsLoading(false));
        }
    }, [isOpen, currentProject?.id]);

    const handleSave = async () => {
        if (!currentProject) return;
        setIsSaving(true);
        setSaveError(null);
        try {
            const result = await api.updatePromptConfig(currentProject.id, config);
            updateProject(currentProject.id, { prompt_config: result.prompt_config });
            onClose();
        } catch (error) {
            setSaveError(t("promptSaveFailed"));
        } finally {
            setIsSaving(false);
        }
    };

    const isDirty = !!initialConfig && JSON.stringify(config) !== JSON.stringify(initialConfig);
    const requestClose = () => {
        if (isSaving) return;
        if (isDirty) setConfirmClose(true);
        else onClose();
    };

    const handleReset = (key: keyof PromptDefaults) => {
        setConfig(prev => ({ ...prev, [key]: '' }));
    };

    if (!isOpen) return null;

    return (
        <Dialog
            isOpen={isOpen}
            title={
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-purple-500/20 rounded-lg">
                        <FileText size={20} className="text-purple-400" />
                    </div>
                    <div>
                        <span className="block text-lg font-bold text-foreground">{t("promptConfig")}</span>
                        <span className="block text-xs font-normal text-text-secondary">{t("promptConfigSub")}</span>
                    </div>
                </div>
            }
            closeLabel={tc("close")}
            className="w-full max-w-3xl"
            isDismissable={!isSaving}
            onOpenChange={open => { if (!open && !isSaving) requestClose(); }}
            footer={
                <div className="flex w-full justify-end gap-3">
                    {saveError && <div role="alert" className="mr-auto self-center text-sm text-red-300">{saveError}</div>}
                    <button
                        onClick={requestClose}
                        className="px-4 py-2 text-sm text-text-secondary hover:text-foreground transition-colors"
                    >
                        {tc("cancel")}
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={isSaving || isLoading || !!loadError}
                        className="px-6 py-2 text-sm font-medium bg-purple-600 hover:bg-purple-500 text-foreground rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2"
                    >
                        {isSaving && <Loader2 size={14} className="animate-spin" />}
                        {tc("save")}
                    </button>
                </div>
            }
        >

                    {/* Content */}
                    <div className="space-y-6 custom-scrollbar">
                        {isLoading ? (
                            <div className="flex items-center justify-center py-12">
                                <Loader2 size={24} className="animate-spin text-purple-400" />
                                <span className="ml-2 text-text-secondary">{t("loadingConfig")}</span>
                            </div>
                        ) : loadError ? (
                            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 text-sm text-red-300">
                                {loadError}
                            </div>
                        ) : (
                            <>
                                <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3 text-xs text-blue-300">
                                    {t("promptEmptyHint")}
                                </div>

                                {/* Empty override inherits the configured series/workspace model. */}
                                <div className="space-y-2">
                                    <div>
                                        <h3 className="text-sm font-bold text-foreground">Polish 模型</h3>
                                        <p className="text-[0.625rem] text-text-muted mt-0.5">
                                            {tc("polishInheritProjectHint")}
                                        </p>
                                    </div>
                                    <SelectField label="Polish 模型" className="[&>label]:sr-only" value={config.polish_model || "__default__"} onChange={value => setConfig(prev => ({ ...prev, polish_model: value === "__default__" ? "" : String(value) }))}
                                        options={textModelOptions(tc("polishInheritProject"), config.polish_model)} />
                                    <div className="border-b border-border-subtle pt-1" />
                                </div>

                                {SECTIONS.map((section) => (
                                    <div key={section.key} className="space-y-2">
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <h3 className="text-sm font-bold text-foreground">{section.label}</h3>
                                                <p className="text-[0.625rem] text-text-muted mt-0.5">{section.description}</p>
                                            </div>
                                            <button
                                                onClick={() => handleReset(section.key)}
                                                disabled={!config[section.key]}
                                                className="text-[0.625rem] text-text-secondary hover:text-foreground flex items-center gap-1 px-2 py-1 rounded hover:bg-hover-bg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                                            >
                                                <RotateCcw size={10} /> {t("resetToDefault")}
                                            </button>
                                        </div>

                                        <textarea
                                            value={config[section.key]}
                                            onChange={(e) => setConfig(prev => ({ ...prev, [section.key]: e.target.value }))}
                                            placeholder={defaults ? defaults[section.key].slice(0, 150) + '...' : 'Loading default...'}
                                            className="w-full h-32 bg-surface border border-glass-border rounded-lg p-3 text-xs text-foreground resize-y focus:outline-none focus:border-purple-500/50 font-mono placeholder-text-muted"
                                        />

                                        {/* Expandable default prompt viewer */}
                                        {defaults && (
                                            <div>
                                                <button
                                                    onClick={() => setExpandedDefault(expandedDefault === section.key ? null : section.key)}
                                                    className="text-[0.625rem] text-text-muted hover:text-foreground flex items-center gap-1 transition-colors"
                                                >
                                                    {expandedDefault === section.key ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                                                    {t("viewDefault")}
                                                </button>
                                                {expandedDefault === section.key && (
                                                    <pre className="mt-2 bg-surface border border-border-subtle rounded-lg p-3 text-[0.625rem] text-text-muted overflow-x-auto max-h-48 overflow-y-auto whitespace-pre-wrap font-mono">{defaults[section.key]}</pre>
                                                )}
                                            </div>
                                        )}

                                        {section.key !== 'r2v_polish' && (
                                            <div className="border-b border-border-subtle" />
                                        )}
                                    </div>
                                ))}
                            </>
                        )}
                    </div>

            {confirmClose && (
                <div key="unsaved-confirm" role="dialog" aria-label={t("unsavedChangesTitle")} className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 p-4">
                    <div className="w-full max-w-md rounded-xl border border-glass-border bg-elevated p-5 shadow-2xl">
                        <h3 className="text-base font-semibold text-foreground">{t("unsavedChangesTitle")}</h3>
                        <p className="mt-2 text-sm text-text-secondary">{t("unsavedChangesHint")}</p>
                        <div className="mt-5 flex justify-end gap-2">
                            <button onClick={() => setConfirmClose(false)} className="px-4 py-2 text-sm text-text-secondary hover:text-foreground">{tc("keepEditing")}</button>
                            <button onClick={onClose} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-foreground hover:bg-red-500">{tc("discardChanges")}</button>
                        </div>
                    </div>
                </div>
            )}
        </Dialog>
    );
}
