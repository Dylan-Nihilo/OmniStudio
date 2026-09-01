"use client";

import { useState, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { motion, AnimatePresence } from "framer-motion";
import { Wand2, Loader2, User, MapPin, Box, ChevronRight, ChevronLeft, Save, Sparkles, Plus, Trash2, X, ScrollText, PanelRightOpen, PanelRightClose } from "lucide-react";
import { api, crudApi } from "@/lib/api";
import { useProjectStore } from "@/store/projectStore";
import { toast } from "@/store/toastStore";
import StepPageHeader, { StepPill } from "@/components/shared/StepPageHeader";
import PreviousEpisodeSummary from "@/components/modules/PreviousEpisodeSummary";
import ReconcileModal from "@/components/modules/ReconcileModal";
import { getApiErrorCode } from "@/lib/apiClient";
import { useEditLeaseStore } from "@/store/editLeaseStore";

interface ScriptNode {
    type: "character" | "scene" | "prop";
    id?: string;
    name: string;
    desc: string;
    // Extended attributes
    age?: string;
    gender?: string;
    clothing?: string;
    visual_weight?: number;
}

export default function ScriptProcessor() {
    const ts = useTranslations("script");
    const tc = useTranslations("common");
    const currentProject = useProjectStore((state) => state.currentProject);
    const updateProject = useProjectStore((state) => state.updateProject);
    const analyzeProject = useProjectStore((state) => state.analyzeProject);
    const isAnalyzing = useProjectStore((state) => state.isAnalyzing);

    // Initialize from project data. Fallback to snake_case original_text
    // in case the API wrapper didn't map it (e.g. raw axios response, or a
    // store update that spread the backend payload without re-mapping).
    const projectText = (currentProject?.originalText ?? (currentProject as any)?.original_text) || "";
    const [script, setScript] = useState(projectText);
    const lastSavedTextRef = useRef(projectText);
    const leaseStatus = useEditLeaseStore((state) => state.status);
    const leaseToken = useEditLeaseStore((state) => state.token);
    const revision = useEditLeaseStore((state) => state.revision);
    const clientInstanceId = useEditLeaseStore((state) => state.clientInstanceId);
    const setRevision = useEditLeaseStore((state) => state.setRevision);
    const [nodes, setNodes] = useState<ScriptNode[]>([]);

    // UI State
    const [selectedNode, setSelectedNode] = useState<ScriptNode | null>(null);
    const [showPanel, setShowPanel] = useState(true);
    const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);

    // Sync from project. Bind on currentProject.id (not the whole object) so
    // local textarea state isn't clobbered every time we mutate Zustand for
    // unrelated reasons. We still re-pull text when the user switches
    // projects, and we resync entity nodes whenever the entity arrays change.
    useEffect(() => {
        if (currentProject) {
            const txt = (currentProject as any)?.original_text ?? currentProject.originalText ?? "";
            setScript(txt || "");
            lastSavedTextRef.current = txt || "";
        }
    }, [currentProject?.id]);

    useEffect(() => {
        if (!currentProject) {
            setNodes([]);
            return;
        }
        const newNodes: ScriptNode[] = [
            ...(currentProject.characters || []).map((c: any) => ({
                type: "character" as const,
                id: c.id,
                name: c.name,
                desc: c.description,
                age: c.age,
                gender: c.gender,
                clothing: c.clothing,
                visual_weight: c.visual_weight
            })),
            ...(currentProject.scenes || []).map((s: any) => ({
                type: "scene" as const,
                id: s.id,
                name: s.name,
                desc: s.description,
                visual_weight: s.visual_weight
            })),
            ...(currentProject.props || []).map((p: any) => ({
                type: "prop" as const,
                id: p.id,
                name: p.name,
                desc: p.description
            }))
        ];
        setNodes(newNodes);
    }, [currentProject?.id, currentProject?.characters, currentProject?.scenes, currentProject?.props]);

    // R2V v2 Phase 4 — ReconcileModal opens after a successful analyze
    // when the episode belongs to a series (series_id !== null).
    const [reconcileOpen, setReconcileOpen] = useState(false);

    useEffect(() => {
        const handler = () => setReconcileOpen(true);
        document.addEventListener("omni_studio:openReconcile", handler);
        return () => document.removeEventListener("omni_studio:openReconcile", handler);
    }, []);

    const handleAnalyze = async () => {
        if (!script.trim()) {
            toast.warning(ts("scriptEmpty"), {
                projectId: currentProject?.id,
                projectTitle: currentProject?.title,
            });
            return;
        }
        if (!currentProject?.id) return;
        const projectId = currentProject.id;
        const projectTitle = currentProject.title;
        useProjectStore.setState({ isAnalyzing: true });
        const toastId = toast.progress(ts("analyzingScript"), {
            projectId,
            projectTitle,
            body: ts("analyzingScriptBody"),
        });
        try {
            const preview = await api.extractPreview(projectId, script);
            toast.update(toastId, {
                kind: "success",
                title: ts("analysisDone"),
                body: ts("analysisDoneBody", {
                    c: preview.characters.length,
                    s: preview.scenes.length,
                    p: preview.props.length,
                }),
                autoCloseMs: 5000,
            });
            useProjectStore.setState({
                pendingExtraction: preview,
                pendingExtractionScript: script,
                isAnalyzing: false,
            });
        } catch (error: any) {
            useProjectStore.setState({ isAnalyzing: false });
            console.error("Failed to analyze script:", error);
            const errorMessage = error?.response?.data?.detail || error?.message || "未知错误";
            toast.update(toastId, {
                kind: "error",
                title: ts("analysisFailedShort"),
                body: String(errorMessage).slice(0, 240),
                action: {
                    label: ts("retry"),
                    onClick: () => { handleAnalyze(); },
                },
            });
        }
    };

    const handleDeleteNode = async (node: ScriptNode, e: React.MouseEvent) => {
        e.stopPropagation();
        if (!currentProject) return;
        if (!confirm(ts("confirmDelete", { name: node.name }))) return;

        try {
            if (node.type === "character" && node.id) {
                await crudApi.deleteCharacter(currentProject.id, node.id);
            } else if (node.type === "scene" && node.id) {
                await crudApi.deleteScene(currentProject.id, node.id);
            } else if (node.type === "prop" && node.id) {
                await crudApi.deleteProp(currentProject.id, node.id);
            }

            const updatedProject = await api.getProject(currentProject.id);
            updateProject(currentProject.id, updatedProject);
        } catch (error) {
            console.error("Failed to delete node:", error);
            toast.error(ts("deleteFailed"), {
                projectId: currentProject?.id,
                projectTitle: currentProject?.title,
            });
        }
    };

    const handleCreateNode = async (data: any) => {
        if (!currentProject) return;
        try {
            if (data.type === "character") {
                await crudApi.createCharacter(currentProject.id, data);
            } else if (data.type === "scene") {
                await crudApi.createScene(currentProject.id, data);
            } else if (data.type === "prop") {
                await crudApi.createProp(currentProject.id, data);
            }

            const updatedProject = await api.getProject(currentProject.id);
            updateProject(currentProject.id, updatedProject);
            setIsCreateDialogOpen(false);
        } catch (error) {
            console.error("Failed to create node:", error);
            toast.error(ts("createFailed"), {
                projectId: currentProject?.id,
                projectTitle: currentProject?.title,
            });
        }
    };

    const handleNodeUpdate = (updatedNode: ScriptNode) => {
        // Update local state
        setNodes(prev => prev.map(n => n.name === updatedNode.name ? updatedNode : n));
        setSelectedNode(updatedNode);
    };

    const tStep = useTranslations("stepHeader");

    return (
        // R2V v2 Phase 3: Script step = main editor (left) + Previously on... (right).
        // Entity extraction still runs via the trailing "提取实体" button —
        // parsed entities flow to series pools and surface in Cast step.
        <div className="flex h-full w-full overflow-hidden">
            {/* Left: main script editor */}
            <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
                <StepPageHeader
                    stepNumber={1}
                    englishName="SCRIPT"
                    title={tStep("scriptTitle")}
                    subtitle={tStep("scriptSubtitle")}
                    pills={script ? (
                        <>
                            <StepPill label={ts("wordsLabel")} value={script.length} />
                            <StepPill label={ts("scenesLabel")} value={currentProject?.frames?.length ?? 0} />
                        </>
                    ) : null}
                    trailing={(
                        <button
                            type="button"
                            onClick={handleAnalyze}
                            disabled={!script || isAnalyzing}
                            className="inline-flex h-8 items-center gap-1.5 rounded-full bg-primary px-4 py-1.5 font-sans text-[0.8125rem] font-semibold text-on-accent shadow-[var(--btn-pri-glow),inset_0_1.5px_0_rgba(255,255,255,0.14)] transition-all duration-fast ease-out-quart hover:bg-primary-hover disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/55"
                        >
                            {isAnalyzing ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />}
                            <span>{isAnalyzing ? ts("analyzingScript") : ts("extractEntities")}</span>
                        </button>
                    )}
                />
                <div className="flex-1 relative p-6 bg-surface overflow-hidden">
                    <textarea
                        value={script}
                        onChange={(e) => {
                            const newText = e.target.value;
                            setScript(newText);
                            // Update local Zustand state with BOTH the
                            // camelCase view-model key and the snake_case
                            // backend key, so any consumer that reads
                            // either name (or anything spread from a
                            // future API response) sees the same value.
                            if (currentProject) {
                                updateProject(currentProject.id, {
                                    originalText: newText,
                                    original_text: newText,
                                } as any);
                            }
                        }}
                        onBlur={async () => {
                            // Persist the in-progress text to the backend on
                            // blur so reloads / navigation don't lose work.
                            // Goes through /update_text instead of /reparse
                            // so we don't trigger a heavy LLM call just for
                            // typing — that's reserved for the explicit
                            // "提取实体" CTA.
                            if (!currentProject) return;
                            if (lastSavedTextRef.current === script || !leaseToken || !revision) return;
                            try {
                                const saved = await api.updateScriptText(
                                    currentProject.id,
                                    script,
                                    revision,
                                    leaseToken,
                                    clientInstanceId,
                                );
                                lastSavedTextRef.current = script;
                                if (saved._revision) setRevision(saved._revision);
                            } catch (err) {
                                console.warn("Failed to persist script text:", err);
                                if (getApiErrorCode(err) === "EDIT_REVISION_CONFLICT") {
                                    toast.error("保存冲突：服务器已有更新，你的本地内容已保留");
                                } else {
                                    toast.error("编辑权限已失效，你的本地内容已保留");
                                }
                            }
                        }}
                        readOnly={leaseStatus !== "editing"}
                        placeholder={ts("scriptPlaceholder")}
                        className="w-full h-full bg-transparent text-text-secondary font-mono text-base leading-relaxed resize-none focus:outline-none"
                        spellCheck={false}
                    />
                </div>
            </div>

            {/* Right: Previously on... rail (R2V v2 Phase 3).
                Only renders for series-affiliated projects with an
                episode index > 0; the component handles empty/first
                episode state internally with a placeholder. */}
            <div className="w-[340px] shrink-0">
                <PreviousEpisodeSummary scriptId={currentProject?.id ?? null} />
            </div>

            {/* R2V v2 Phase 4 — Reconcile modal (auto-opens after analyze
                for series-affiliated episodes; ignored for standalone). */}
            <ReconcileModal
                isOpen={reconcileOpen}
                scriptId={currentProject?.id ?? null}
                onClose={() => setReconcileOpen(false)}
            />

        </div>
    );
}

function CreateEntityDialog({ onClose, onCreate }: { onClose: () => void; onCreate: (data: any) => void }) {
    const ts = useTranslations("script");
    const tc = useTranslations("common");
    const [name, setName] = useState("");
    const [desc, setDesc] = useState("");
    const [type, setType] = useState<"character" | "scene" | "prop">("character");

    const handleSubmit = () => {
        if (!name.trim()) {
            toast.warning(ts("nameRequired"));
            return;
        }
        onCreate({ name, description: desc, type });
    };

    return (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-overlay backdrop-blur-sm" onClick={onClose}>
            <div className="w-[400px] bg-elevated border border-glass-border rounded-xl p-6 space-y-4" onClick={e => e.stopPropagation()}>
                <h3 className="font-bold text-foreground">{ts("addEntity")}</h3>

                <div className="flex gap-2 p-1 bg-surface rounded-lg">
                    {(["character", "scene", "prop"] as const).map(t => (
                        <button
                            key={t}
                            onClick={() => setType(t)}
                            className={`flex-1 py-1.5 text-xs font-bold rounded capitalize ${type === t ? "bg-primary text-foreground" : "text-text-muted hover:text-foreground"}`}
                        >
                            {t}
                        </button>
                    ))}
                </div>

                <div>
                    <label className="text-xs text-text-muted">{ts("nameLabel")}</label>
                    <input
                        className="glass-input w-full"
                        value={name}
                        onChange={e => setName(e.target.value)}
                        placeholder={ts("entityNamePlaceholder")}
                    />
                </div>

                <div>
                    <label className="text-xs text-text-muted">{ts("descriptionLabel")}</label>
                    <textarea
                        className="glass-input w-full h-24 resize-none"
                        value={desc}
                        onChange={e => setDesc(e.target.value)}
                        placeholder={ts("visualDescPlaceholder")}
                    />
                </div>

                <div className="flex justify-end gap-2 pt-2">
                    <button onClick={onClose} className="px-4 py-2 text-xs text-text-secondary hover:text-foreground">{tc("cancel")}</button>
                    <button onClick={handleSubmit} className="px-4 py-2 bg-primary text-foreground rounded text-xs font-bold">{tc("create")}</button>
                </div>
            </div>
        </div>
    );
}
