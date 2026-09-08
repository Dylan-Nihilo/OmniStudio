"use client";

import { useState, useCallback, useRef } from "react";
import { Button, Dialog, TextField, TextAreaField, WorkflowSteps } from "@omnistudio/ui";
import { Upload, FileText, ChevronLeft, ChevronRight, Check, BookOpen } from "lucide-react";
import { api } from "@/lib/api";
import { useTranslations } from "next-intl";

interface ImportFileDialogProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess?: (result: any) => void;
}

interface EpisodePreview {
    episode_number: number;
    title: string;
    summary: string;
    estimated_duration?: string;
}

interface PreviewResult {
    episodes: EpisodePreview[];
    text: string;
}

type Step = 1 | 2 | 3;

export default function ImportFileDialog({ isOpen, onClose, onSuccess }: ImportFileDialogProps) {
    // Step state
    const [step, setStep] = useState<Step>(1);

    // Step 1 state
    const [file, setFile] = useState<File | null>(null);
    const [seriesTitle, setSeriesTitle] = useState("");
    const [description, setDescription] = useState("");
    const [suggestedEpisodes, setSuggestedEpisodes] = useState(3);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Step 2 state
    const [previewResult, setPreviewResult] = useState<PreviewResult | null>(null);
    const [isCreating, setIsCreating] = useState(false);

    // Step 3 state
    const [createdResult, setCreatedResult] = useState<{ series_id: string; episode_count: number } | null>(null);

    // Error state
    const [error, setError] = useState<string | null>(null);

    // Drag and drop state
    const [isDragOver, setIsDragOver] = useState(false);

    const t = useTranslations("series");
    const tc = useTranslations("common");

    const resetState = () => {
        setStep(1);
        setFile(null);
        setSeriesTitle("");
        setDescription("");
        setSuggestedEpisodes(3);
        setIsAnalyzing(false);
        setPreviewResult(null);
        setIsCreating(false);
        setCreatedResult(null);
        setError(null);
        setIsDragOver(false);
    };

    const handleClose = () => {
        if (isAnalyzing || isCreating) return;
        resetState();
        onClose();
    };

    const handleFileSelect = useCallback((selectedFile: File) => {
        const ext = selectedFile.name.split('.').pop()?.toLowerCase();
        if (ext !== 'txt' && ext !== 'md') {
            setError(t("onlyTxtMd"));
            return;
        }
        setFile(selectedFile);
        setError(null);
        // Auto-fill title from filename if empty
        setSeriesTitle((prev) => {
            if (!prev) {
                return selectedFile.name.replace(/\.(txt|md)$/, '');
            }
            return prev;
        });
    }, [t]);

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setIsDragOver(false);
        const droppedFile = e.dataTransfer.files[0];
        if (droppedFile) {
            handleFileSelect(droppedFile);
        }
    }, [handleFileSelect]);

    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setIsDragOver(true);
    }, []);

    const handleDragLeave = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setIsDragOver(false);
    }, []);

    // Step 1 -> Step 2: Analyze file
    const handleAnalyze = async () => {
        if (!file || !seriesTitle.trim() || isAnalyzing) return;
        setIsAnalyzing(true);
        setError(null);
        try {
            const result = await api.importFilePreview(file, suggestedEpisodes);
            setPreviewResult(result);
            setStep(2);
        } catch (err: any) {
            const msg = err?.response?.data?.detail || err?.message || t("analysisFailed");
            setError(typeof msg === "string" ? msg : t("createFailed"));
        } finally {
            setIsAnalyzing(false);
        }
    };

    // Step 2 -> Step 3: Confirm creation
    const handleConfirm = async () => {
        if (!previewResult || isCreating) return;
        setIsCreating(true);
        setError(null);
        try {
            const result = await api.importFileConfirm({
                title: seriesTitle.trim(),
                description: description.trim() || undefined,
                text: previewResult.text,
                episodes: previewResult.episodes,
            });
            setCreatedResult({
                series_id: result.series_id,
                episode_count: result.episodes?.length ?? previewResult.episodes.length,
            });
            setStep(3);
        } catch (err: any) {
            const msg = err?.response?.data?.detail || err?.message || t("createFailed");
            setError(typeof msg === "string" ? msg : t("createFailed"));
        } finally {
            setIsCreating(false);
        }
    };

    // Step 3: View series
    const handleViewSeries = () => {
        if (createdResult) {
            onSuccess?.(createdResult);
            window.location.hash = `#/series/${createdResult.series_id}`;
        }
        handleClose();
    };

    const busy = isAnalyzing || isCreating;
    const footer = step === 1 ? <><Button variant="secondary" onPress={handleClose} isDisabled={busy}>{tc("cancel")}</Button><Button onPress={handleAnalyze} isDisabled={!file || !seriesTitle.trim()} isPending={isAnalyzing}>{isAnalyzing ? t("analyzing") : t("startAnalysis")}</Button></> : step === 2 ? <><Button variant="secondary" onPress={() => { setStep(1); setError(null); }} isDisabled={busy}><ChevronLeft size={16} />{t("backToEdit")}</Button><Button onPress={handleConfirm} isPending={isCreating}>{isCreating ? t("creating") : t("confirmCreate")}<ChevronRight size={16} /></Button></> : <Button onPress={handleViewSeries}><BookOpen size={18} />{t("viewSeries")}</Button>;
    return <Dialog isOpen={isOpen} onOpenChange={open => { if (!open) handleClose(); }} isDismissable={!busy} title={t("importTitle")} closeLabel={tc("close")} className="w-[min(640px,calc(100vw-32px))] max-w-none" footer={footer}>
        <WorkflowSteps aria-label={t("importTitle")} currentStep={step - 1} size="sm" className="mb-6" steps={[{ id: "upload", title: t("stepUpload") }, { id: "preview", title: t("stepPreview") }, { id: "done", title: t("stepDone") }]} />
        {error && <p role="alert" className="mb-4 text-sm text-danger">{error}</p>}
        {step === 1 && <div className="space-y-4">
            <div onDrop={busy ? undefined : handleDrop} onDragOver={busy ? undefined : handleDragOver} onDragLeave={handleDragLeave} className={`rounded-xl border border-dashed p-4 text-center ${isDragOver ? "border-primary bg-primary/10" : "border-glass-border"}`}>
                <input ref={fileInputRef} type="file" accept=".txt,.md" aria-label={t("supportedFormats")} className="hidden" disabled={busy} onChange={event => { const selected = event.target.files?.[0]; if (selected) handleFileSelect(selected); }} />
                <Button variant="quiet" onPress={() => fileInputRef.current?.click()} isDisabled={busy}><Upload size={20} />{t("stepUpload")}</Button>
                {file ? <p className="mt-2 flex items-center justify-center gap-2 break-all text-sm"><FileText size={18} /><span>{file.name}</span> · {(file.size / 1024).toFixed(1)} KB</p> : <p className="mt-2 text-sm text-text-secondary">{t("dragHint")}</p>}
                <p className="mt-2 text-xs text-text-muted">{t("supportedFormats")}</p>
            </div>
            <TextField autoFocus label={t("seriesTitle")} value={seriesTitle} onChange={setSeriesTitle} placeholder={t("seriesTitlePlaceholder")} isRequired isDisabled={busy} />
            <TextAreaField label={t("descriptionOptional")} value={description} onChange={setDescription} placeholder={t("descriptionPlaceholder")} rows={3} isDisabled={busy} />
            <TextField label={t("suggestedEpisodes")} type="number" value={String(suggestedEpisodes)} onChange={value => setSuggestedEpisodes(Math.min(50, Math.max(1, parseInt(value) || 1)))} isDisabled={busy} />
        </div>}
        {step === 2 && previewResult && <div className="space-y-4">
            <p className="text-sm text-text-secondary">{t("previewHint", { count: previewResult.episodes.length })}</p>
            {previewResult.episodes.map(episode => <article key={episode.episode_number} className="rounded-xl border border-glass-border p-4">
                <div className="mb-2 flex flex-wrap items-center gap-3"><span className="text-xs text-primary">EP{episode.episode_number}</span><h3 className="font-medium">{episode.title}</h3>{episode.estimated_duration && <span className="text-xs text-text-muted">~{episode.estimated_duration}</span>}</div>
                <p className="text-sm text-text-secondary">{episode.summary}</p>
            </article>)}
        </div>}
        {step === 3 && createdResult && <div className="flex flex-col items-center gap-5 py-8 text-center"><Check size={32} className="text-success" /><h3 className="text-xl font-semibold">{t("createSuccess")}</h3><p>{t("createSuccessDetail", { title: seriesTitle, count: createdResult.episode_count })}</p></div>}
    </Dialog>;
}
