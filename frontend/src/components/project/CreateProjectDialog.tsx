"use client";

import { useState, useEffect, useRef, useId } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Zap, Film } from "lucide-react";
import { useTranslations } from "next-intl";
import { useProjectStore } from "@/store/projectStore";


interface CreateProjectDialogProps {
    isOpen: boolean;
    onClose: () => void;
    seriesId?: string;
    seriesTitle?: string;
}

export default function CreateProjectDialog({ isOpen, onClose, seriesId, seriesTitle }: CreateProjectDialogProps) {
    const [title, setTitle] = useState("");
    const [text, setText] = useState("");
    const [workflowMode, setWorkflowMode] = useState<"r2v" | "i2v_legacy">("r2v");
    const [isCreating, setIsCreating] = useState(false);
    const createProject = useProjectStore((state) => state.createProject);
    const t = useTranslations("project");
    const tc = useTranslations("common");
    const dialogRef = useRef<HTMLDivElement>(null);
    const titleId = useId();
    const fieldId = useId();
    const scriptId = useId();
    const onCloseRef = useRef(onClose);
    onCloseRef.current = onClose;

    useEffect(() => {
        if (!isOpen) return;
        const previous = document.activeElement as HTMLElement | null;
        dialogRef.current?.querySelector("input")?.focus();
        const onKey = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                event.preventDefault();
                onCloseRef.current();
            }
            if (event.key !== "Tab" || !dialogRef.current) return;
            const fields = Array.from(dialogRef.current.querySelectorAll<HTMLElement>("button:not([disabled]), input, textarea"));
            const first = fields[0];
            const last = fields[fields.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault(); last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault(); first?.focus();
            }
        };
        document.addEventListener("keydown", onKey);
        return () => { document.removeEventListener("keydown", onKey); previous?.focus(); };
    }, [isOpen]);



    const handleCreate = async () => {
        if (!title.trim()) {
            alert(t("titleRequired"));
            return;
        }

        setIsCreating(true);
        try {
            await createProject(title.trim(), text, true, workflowMode, seriesId);
            // Get the newly created project
            const currentProject = useProjectStore.getState().currentProject;
            if (currentProject) {
                // Use hash-based routing to match the app's routing structure
                window.location.hash = `#/project/${currentProject.id}`;
            }
            onClose();
        } catch (error: any) {
            const errorMessage = error?.response?.data?.detail || error?.message || t("checkBackend");
            alert(t("createFailed", { error: errorMessage }));
        } finally {
            setIsCreating(false);
        }
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 bg-overlay backdrop-blur-sm z-50 flex items-center justify-center p-4"
                    onClick={onClose}
                >
                    <motion.div
                        initial={{ scale: 0.9, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0.9, opacity: 0 }}
                        ref={dialogRef}
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby={titleId}
                        className="bg-elevated border border-border shadow-2xl p-5 sm:p-8 rounded-2xl w-full max-w-4xl max-h-[calc(100dvh-2rem)] overflow-y-auto"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between mb-6">
                            <div>
                                <h2 id={titleId} className="text-2xl font-display font-bold text-foreground">{t("createTitle")}</h2>
                                {seriesId && (
                                    <div className="mt-1 font-mono text-[0.6875rem] uppercase tracking-wider text-primary">
                                        {t("series")} · {seriesTitle}
                                    </div>
                                )}
                            </div>
                            <button
                                onClick={onClose}
                                aria-label={tc("close")}
                                className="p-2 rounded-lg hover:bg-hover-bg text-text-secondary hover:text-foreground transition-colors"
                            >
                                <X size={20} />
                            </button>
                        </div>

                        <div className="space-y-4">
                            <div>
                                <label htmlFor={fieldId} className="block text-sm font-medium text-foreground mb-2">
                                    {t("projectTitle")}
                                </label>
                                <input
                                    id={fieldId}
                                    type="text"
                                    value={title}
                                    onChange={(e) => setTitle(e.target.value)}
                                    placeholder={t("projectTitlePlaceholder")}
                                    className="glass-input w-full"
                                />
                            </div>

                            {/* Workflow Mode Selection */}
                            <div>
                                <label className="block text-sm font-medium text-foreground mb-2">
                                    {t("workflowMode")}
                                </label>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <button
                                        type="button"
                                        onClick={() => setWorkflowMode("r2v")}
                                        className={`relative p-4 rounded-xl border-2 text-left transition-all ${
                                            workflowMode === "r2v"
                                                ? "border-primary bg-primary/10"
                                                : "border-border bg-surface hover:border-text-muted"
                                        }`}
                                    >
                                        <div className="flex items-center gap-2 mb-1.5">
                                            <Zap size={16} className={workflowMode === "r2v" ? "text-primary" : "text-text-secondary"} />
                                            <span className="font-semibold text-sm text-foreground">{t("workflowR2V")}</span>
                                        </div>
                                        <p className="text-xs text-text-secondary leading-relaxed">
                                            {t("workflowR2VDesc")}
                                        </p>
                                        {workflowMode === "r2v" && (
                                            <span className="absolute top-2 right-2 text-[0.625rem] font-medium text-primary bg-primary/20 px-1.5 py-0.5 rounded">
                                                {tc("recommended")}
                                            </span>
                                        )}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setWorkflowMode("i2v_legacy")}
                                        className={`relative p-4 rounded-xl border-2 text-left transition-all ${
                                            workflowMode === "i2v_legacy"
                                                ? "border-primary bg-primary/10"
                                                : "border-border bg-surface hover:border-text-muted"
                                        }`}
                                    >
                                        <div className="flex items-center gap-2 mb-1.5">
                                            <Film size={16} className={workflowMode === "i2v_legacy" ? "text-primary" : "text-text-secondary"} />
                                            <span className="font-semibold text-sm text-foreground">{t("workflowI2V")}</span>
                                        </div>
                                        <p className="text-xs text-text-secondary leading-relaxed">
                                            {t("workflowI2VDesc")}
                                        </p>
                                    </button>
                                </div>
                            </div>

                            <div>
                                <label htmlFor={scriptId} className="block text-sm font-medium text-foreground mb-2">
                                    {t("scriptContent")}
                                </label>
                                <textarea
                                    id={scriptId}
                                    value={text}
                                    onChange={(e) => setText(e.target.value)}
                                    placeholder={t("scriptPlaceholder")}
                                    rows={8}
                                    className="glass-input w-full resize-none font-mono text-sm"
                                />
                            </div>

                            <div className="flex gap-3 pt-4">
                                <button
                                    onClick={onClose}
                                    className="flex-1 glass-button"
                                >
                                    {tc("cancel")}
                                </button>
                                <button
                                    onClick={handleCreate}
                                    disabled={isCreating || !title.trim()}
                                    className="flex-1 bg-primary hover:bg-primary/90 text-on-accent px-6 py-3 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {isCreating ? t("creating") : t("createProject")}
                                </button>
                            </div>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
