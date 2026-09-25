"use client";

import { useEffect, useRef, useState } from "react";
import { ImageIcon, RefreshCw, Sparkles, Upload, X } from "lucide-react";
import { Button, IconButton, LoadingState } from "@omnistudio/ui";
import { useTranslations } from "next-intl";
import PreviewImage from "@/components/shared/preview/PreviewImage";
import CreditCost from "@/components/billing/CreditCost";
import { usePricingTable } from "@/store/billingStore";
import { creditLabel, imageCostParams, unitLabels } from "@/lib/modelCost";
import { GLOBAL_IMAGE_MODELS } from "@/lib/modelCatalog";
import { SelectField } from "@omnistudio/ui";
import SectionShell from "./SectionShell";
import { useProjectStore } from "@/store/projectStore";
import { getAspectRatioCssValue } from "@/lib/aspectRatio";

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const ALLOWED_UPLOAD_TYPES = ["image/jpeg", "image/png", "image/webp"];

export type T2IUploadError = "type" | "size" | "network"
    | { code: "type" | "size" | "network" | "not_found" | "server"; detail: string };

function formatUploadError(error: T2IUploadError, t: ReturnType<typeof useTranslations>): string {
    const code = typeof error === "string" ? error : error.code;
    const detail = typeof error === "string" ? "" : error.detail;
    const label = code === "type" ? t("t2iHeroUploadInvalidType")
        : code === "size" ? t("t2iHeroUploadTooLarge")
        : code === "not_found" ? t("t2iUploadErrNotFound")
        : code === "server" ? t("t2iUploadErrServer") : t("t2iHeroUploadFailed");
    return detail ? `${label} ${detail}` : label;
}

interface T2ISubsectionProps {
    imageUrls: string[];
    selectedIndex: number;
    storyboardFrameUrl?: string;
    prompt: string;
    onPromptChange: (value: string) => void;
    onUseShotPrompt?: () => void;
    generating: boolean;
    uploading?: boolean;
    operation?: "generate" | "upload";
    errorMessage?: string;
    checking?: boolean;
    refreshFailed?: boolean;
    refreshing?: boolean;
    onRefresh?: () => void;
    onSelect: (index: number) => void;
    onRemove: (index: number) => void;
    onGenerate: () => void;
    onUpload: (file: File) => Promise<T2IUploadError | void>;
    /** Image tier for this shot's first frame, and the size it renders at. Until now the
     *  override was read at generation time but nothing could ever write it, so every
     *  storyboard frame was stuck on the project default. */
    imageModelId?: string;
    imageSize?: string;
    onImageModelChange?: (modelId: string) => void;
    imageModelSaving?: boolean;
}

export default function T2ISubsection({
    imageUrls, selectedIndex, storyboardFrameUrl, prompt, onPromptChange, onUseShotPrompt, generating, uploading: externalUploading = false, operation, errorMessage,
    checking, refreshFailed, refreshing, onRefresh, onSelect, onRemove, onGenerate, onUpload,
    imageModelId, imageSize, onImageModelChange, imageModelSaving = false,
}: T2ISubsectionProps) {
    const pricing = usePricingTable();
    const tBilling = useTranslations("billing");
    const t = useTranslations("storyboardR2V");
    const masterAspectRatio = useProjectStore((state) => state.currentProject?.model_settings?.storyboard_aspect_ratio ?? "16:9");
    const previewAspectStyle = { aspectRatio: getAspectRatioCssValue(masterAspectRatio) };
    const [open, setOpen] = useState(true);
    const [dragHot, setDragHot] = useState(false);
    const [localUploading, setUploading] = useState(false);
    const uploading = localUploading || externalUploading;
    const [uploadError, setUploadError] = useState<T2IUploadError | null>(null);
    const uploadLock = useRef(false);
    const retryFile = useRef<File | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const generateRef = useRef<HTMLButtonElement>(null);
    const selectionRefs = useRef(new Map<number, HTMLButtonElement>());
    const removedIndex = useRef<number | null>(null);
    const activeIndex = Math.max(0, Math.min(selectedIndex, imageUrls.length - 1));
    const activeUrl = imageUrls[activeIndex] || storyboardFrameUrl;
    const promptIsEmpty = !prompt.trim();
    const busy = generating || uploading;
    const error = uploadError ? formatUploadError(uploadError, t) : errorMessage;

    useEffect(() => {
        if (removedIndex.current === null) return;
        const index = Math.min(removedIndex.current, imageUrls.length - 1);
        (selectionRefs.current.get(index) || generateRef.current)?.focus();
        removedIndex.current = null;
    }, [imageUrls]);

    async function upload(file: File) {
        if (uploadLock.current || generating || externalUploading) return;
        setUploadError(null);
        retryFile.current = null;
        if (!ALLOWED_UPLOAD_TYPES.includes(file.type)) { setUploadError("type"); return; }
        if (file.size > MAX_UPLOAD_BYTES) { setUploadError("size"); return; }
        uploadLock.current = true;
        setUploading(true);
        retryFile.current = file;
        try {
            const failure = await onUpload(file);
            if (failure) setUploadError(failure);
            else retryFile.current = null;
        } catch {
            setUploadError("network");
        } finally {
            uploadLock.current = false;
            setUploading(false);
        }
    }

    return (
        <div className={dragHot ? "bg-primary/5 outline outline-1 outline-primary" : "bg-white"}
            onDragOver={event => { event.preventDefault(); if (!busy) setDragHot(true); }}
            onDragLeave={() => setDragHot(false)}
            onDrop={event => {
                event.preventDefault(); setDragHot(false);
                const file = event.dataTransfer.files?.[0];
                if (file && !busy) void upload(file);
            }}>
            <SectionShell title={t("t2iStepOneDone")} open={open} onToggle={() => setOpen(value => !value)}
                subtitle={activeUrl ? t("t2iStepOneCount", { count: imageUrls.length || 1, current: imageUrls.length ? activeIndex + 1 : 1 }) : undefined}
                trailing={<>
                    <Button ref={generateRef} variant={activeUrl ? "quiet" : "primary"} isPending={generating}
                        isDisabled={promptIsEmpty || uploading}
                        onPress={() => { setUploadError(null); onGenerate(); }}>
                        {activeUrl ? <RefreshCw size={14} aria-hidden="true" /> : <Sparkles size={14} aria-hidden="true" />}
                        {generating ? t(checking ? "t2iChecking" : "t2iGenerating") : errorMessage && operation !== "upload" ? t("retry") : activeUrl ? t("t2iCompactReroll") : t("t2iHeroGenerateLabel")}
                    </Button>
                    <Button variant="secondary" isPending={uploading} isDisabled={generating}
                        onPress={() => inputRef.current?.click()}>
                        <Upload size={14} aria-hidden="true" />
                        {uploading ? t("t2iHeroUploadingLabel") : t("t2iHeroUploadLabel")}
                    </Button>
                </>}>
                {onImageModelChange ? (
                    <div className="mb-3 flex items-end gap-2">
                        <div className="min-w-0 flex-1">
                            <SelectField label={t("t2iModelLabel")} value={imageModelId ?? ""}
                                isDisabled={imageModelSaving}
                                onChange={key => onImageModelChange(String(key))}
                                options={GLOBAL_IMAGE_MODELS.map(model => ({
                                    id: model.id, label: model.name,
                                    description: creditLabel(pricing, model.id, unitLabels(tBilling)) ?? undefined,
                                }))} />
                        </div>
                        <CreditCost modelId={imageModelId} quantity={1}
                                    params={imageCostParams(imageSize)} />
                    </div>
                ) : null}
                <label className="mb-3 block text-sm text-text-secondary">
                    {t("firstFramePromptLabel")}
                    <textarea value={prompt} onChange={event => onPromptChange(event.target.value)} rows={4}
                        placeholder={t("firstFramePromptPlaceholder")}
                        className="mt-2 w-full resize-y rounded-lg border border-glass-border bg-surface p-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary" />
                </label>
                {onUseShotPrompt && <Button variant="quiet" className="mb-3" onPress={onUseShotPrompt}>{t("firstFrameUseShotPrompt")}</Button>}
                {activeUrl ? (
                    <div className="relative w-full overflow-hidden rounded-xl border border-glass-border bg-surface" style={previewAspectStyle}>
                        <PreviewImage src={activeUrl} alt={t("t2iActiveFrame")} className="h-full w-full" alwaysShowMagnify clickToLightbox />
                        {imageUrls.length === 1 && <IconButton variant="secondary" className="absolute right-1 top-1 bg-white" isDisabled={busy}
                            aria-label={t("t2iRemoveCandidate", { index: 1 })}
                            onPress={() => { removedIndex.current = 0; onRemove(0); }}><X size={14} aria-hidden="true" /></IconButton>}
                    </div>
                ) : (
                    <div className="space-y-2 py-3 text-sm text-text-secondary">
                        <ImageIcon size={24} aria-hidden="true" className="text-text-muted" />
                        <p>{t("t2iHeroBody")}</p>
                        <p className="text-xs text-text-muted">{t("t2iHeroDropHint")} · JPG / PNG / WebP · 8MB</p>
                    </div>
                )}
                {imageUrls.length > 1 && (
                    <div className="mt-3 grid grid-cols-2 gap-2">
                        {imageUrls.map((url, index) => (
                            <div key={`${url}-${index}`} className="min-w-0 space-y-1">
                                <div className="relative overflow-hidden rounded-lg border border-glass-border bg-surface" style={previewAspectStyle}>
                                    <PreviewImage src={url} alt={t("t2iSelectCandidate", { index: index + 1 })} className="h-full w-full" clickToLightbox />
                                    <IconButton variant="secondary" className="absolute right-1 top-1 bg-white" isDisabled={busy}
                                        aria-label={t("t2iRemoveCandidate", { index: index + 1 })}
                                        onPress={() => { removedIndex.current = index; onRemove(index); }}>
                                        <X size={14} aria-hidden="true" />
                                    </IconButton>
                                </div>
                                <Button ref={node => { if (node) selectionRefs.current.set(index, node); else selectionRefs.current.delete(index); }}
                                    variant={index === activeIndex ? "secondary" : "quiet"} className="w-full px-1 text-xs" isDisabled={busy}
                                    aria-pressed={index === activeIndex} onPress={() => onSelect(index)}>
                                    {t("t2iSelectCandidate", { index: index + 1 })}
                                </Button>
                            </div>
                        ))}
                    </div>
                )}
            </SectionShell>
            <input ref={inputRef} type="file" accept={ALLOWED_UPLOAD_TYPES.join(",")} hidden
                onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void upload(file); }} />
            {busy && <div className="space-y-2 px-3 pb-3">
                <LoadingState inline label={uploading ? t("t2iHeroUploadingLabel") : t(checking ? "t2iChecking" : "t2iGenerating")} />
                {refreshFailed && <>
                    <p role="alert" className="text-sm text-status-failed-fg">{t("t2iStatusUnavailable")}</p>
                    <Button variant="secondary" isPending={refreshing} onPress={onRefresh}>{t("t2iRefreshStatus")}</Button>
                </>}
            </div>}
            {error && !busy && <div className="space-y-2 px-3 pb-3">
                <p role="alert" className="break-words text-sm text-status-failed-fg">{error}</p>
                {uploadError && retryFile.current && <Button variant="secondary" onPress={() => { if (retryFile.current) void upload(retryFile.current); }}>{t("retry")}</Button>}
            </div>}
        </div>
    );
}
