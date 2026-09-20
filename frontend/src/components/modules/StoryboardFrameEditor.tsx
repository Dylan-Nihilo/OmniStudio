"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { Button, Dialog } from "@omnistudio/ui";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { VariantSelector } from "../common/VariantSelector";
import { useProjectStore } from "@/store/projectStore";

import ConfirmDialog from "@/components/shared/ConfirmDialog";
import { extractErrorDetail } from "@/lib/utils";

interface StoryboardFrameEditorProps {
    frame: any;
    onClose: () => void;
}

export default function StoryboardFrameEditor({ frame: initialFrame, onClose }: StoryboardFrameEditorProps) {
    const ts = useTranslations("storyboard");
    const tc = useTranslations("common");
    const tp = useTranslations("productionPlan");
    const [confirmClose, setConfirmClose] = useState(false);
    const [mutationError, setMutationError] = useState("");
    const generating = useRef(false);
    const mutating = useRef(false);
    const currentProject = useProjectStore(state => state.currentProject);
    const updateProject = useProjectStore(state => state.updateProject);

    // Get the latest frame data from the store (instead of using stale prop)
    const frame = useMemo(() => {
        if (!currentProject?.frames) return initialFrame;
        return currentProject.frames.find((f: any) => f.id === initialFrame.id) || initialFrame;
    }, [currentProject?.frames, initialFrame.id, initialFrame]);

    const [prompt, setPrompt] = useState(frame.image_prompt || frame.action_description || "");
    const [isGenerating, setIsGenerating] = useState(false);
    const [generationError, setGenerationError] = useState<string | null>(null);
    const [retryBatchSize, setRetryBatchSize] = useState(1);

    // Sync prompt when frame changes
    useEffect(() => {
        setPrompt(frame.image_prompt || frame.action_description || "");
    }, [frame.id, frame.image_prompt, frame.action_description]);

    const handleGenerate = async (batchSize: number) => {
        if (!currentProject || generating.current) return;
        generating.current = true;
        setRetryBatchSize(batchSize);
        setGenerationError(null);
        setIsGenerating(true);
        try {
            // Construct composition data (simplified for now, ideally passed from parent or re-calculated)
            // For re-rendering, we might want to reuse existing composition data or just rely on prompt/I2I
            // The api.renderFrame expects compositionData.
            // If we don't pass it, pipeline uses existing.

            const updatedProject = await api.renderFrame(
                currentProject.id,
                frame.id,
                null, // Use existing composition data
                prompt,
                batchSize
            );
            updateProject(currentProject.id, updatedProject);
            setGenerationError(null);
        } catch (error) {
            console.error("Failed to generate frame:", error);
            setGenerationError(ts("generateFailed"));
        } finally {
            generating.current = false;
            setIsGenerating(false);
        }
    };

    const handleSelectVariant = async (variantId: string) => {
        if (!currentProject || mutating.current) return;
        mutating.current = true; setMutationError("");
        try {
            const updatedProject = await api.selectAssetVariant(currentProject.id, frame.id, "storyboard_frame", variantId);
            updateProject(currentProject.id, updatedProject);
        } catch (error) {
            setMutationError(extractErrorDetail(error, ts("selectVariantFailed")));
        } finally { mutating.current = false; }
    };

    const handleDeleteVariant = async (variantId: string) => {
        if (!currentProject || mutating.current) return;
        mutating.current = true; setMutationError("");
        try {
            const updatedProject = await api.deleteAssetVariant(currentProject.id, frame.id, "storyboard_frame", variantId);
            updateProject(currentProject.id, updatedProject);
        } catch (error) {
            setMutationError(extractErrorDetail(error, ts("deleteVariantFailed")));
        } finally { mutating.current = false; }
    };

    const close = () => {
        if (prompt !== (frame.image_prompt || frame.action_description || "")) setConfirmClose(true);
        else onClose();
    };
    return <>
        <Dialog isOpen title={`${ts("frameEditor")} #${frame.id.substring(0, 8)}`} closeLabel={tc("close")}
            onOpenChange={open => { if (!open) close(); }} className="w-[min(72rem,calc(100vw-2rem))]"
            footer={<Button variant="secondary" onPress={close}>{tc("close")}</Button>}>
                {mutationError && <p role="alert">{mutationError}</p>}
                {/* Content */}
                <div className="flex flex-col gap-4 md:flex-row">
                    {/* Left: Variant Selector */}
                    <div className="flex-1 bg-surface p-4 flex flex-col overflow-hidden relative">
                        <VariantSelector
                            asset={frame.rendered_image_asset}
                            currentImageUrl={frame.rendered_image_url || frame.image_url}
                            onSelect={handleSelectVariant}
                            onDelete={handleDeleteVariant}
                            onGenerate={handleGenerate}
                            isGenerating={isGenerating}
                            aspectRatio="16:9"
                            className="h-full"
                        />
                        {generationError && <div role="alert" className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
                            <p>{generationError}</p>
                            <Button variant="secondary" size="sm" className="mt-2" isDisabled={isGenerating} isPending={isGenerating} onPress={() => void handleGenerate(retryBatchSize)}>
                                {ts("retry")}
                            </Button>
                        </div>}
                    </div>

                    {/* Right: Controls & Prompt */}
                    <div className="w-full md:w-1/3 md:min-w-[280px] border-l border-glass-border bg-elevated flex flex-col">
                        <div className="p-4 border-b border-border-subtle">
                            <h3 className="font-bold text-sm uppercase tracking-wider text-text-secondary mb-2">
                                {ts("sceneContext")}
                            </h3>
                            <p className="text-xs text-text-secondary mb-2">
                                <span className="font-bold text-text-muted">{ts("action")}:</span> {frame.action_description}
                            </p>
                            {frame.dialogue && (
                                <p className="text-xs text-text-secondary italic">
                                    <span className="font-bold text-text-muted not-italic">{ts("dialogue")}:</span> "{frame.dialogue}"
                                </p>
                            )}
                        </div>

                        <div className="flex-1 p-4 flex flex-col">
                            <h3 className="font-bold text-sm uppercase tracking-wider text-text-secondary mb-2">
                                {ts("generationPrompt")}
                            </h3>
                            <textarea
                                aria-label={ts("generationPrompt")}
                                disabled={isGenerating}
                                value={prompt}
                                onChange={(e) => setPrompt(e.target.value)}
                                className="min-h-48 flex-1 w-full bg-surface border border-glass-border rounded-lg p-4 text-sm text-text-secondary resize-none focus:outline-none focus:border-primary/50 font-mono leading-relaxed"
                                placeholder={ts("promptPlaceholder")}
                            />
                            <p className="text-xs text-text-muted mt-2">
                                {ts("promptHint")}
                            </p>
                        </div>
                    </div>
                </div>
        </Dialog>
        <ConfirmDialog open={confirmClose} title={tp("unsaved")} message={tp("previsUnsaved")}
            cancelLabel={tc("keepEditing")} confirmLabel={tc("discardChanges")}
            onCancel={() => setConfirmClose(false)} onConfirm={() => { setConfirmClose(false); onClose(); }} />
    </>;
}
