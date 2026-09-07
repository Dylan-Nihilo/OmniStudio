"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { create } from "zustand";
import { Button, EmptyState } from "@omnistudio/ui";
import styles from "./StoryboardR2V.module.css";
import { Plus, Film, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import { useProjectStore } from "@/store/projectStore";
import { useAuthStore } from "@/store/authStore";
import { useShotDrafts } from "./storyboard-r2v/useShotDrafts";
import { api, crudApi, type VideoTask, type RefineSSEEvent } from "@/lib/api";
import { getAssetUrl } from "@/lib/utils";
import { selectedVariantUrl } from "@/lib/characterImage";
import { debugLog } from "@/lib/debugLog";
import type { BatchSummary } from "./storyboard-r2v/shot-panel/CandidatesSection";
import { getR2vRouteModelId, isR2vImageBased, VIDEO_I2V_MODELS, VIDEO_R2V_MODELS, DEFAULT_I2V_MODEL_ID, DEFAULT_R2V_MODEL_ID } from "@/lib/modelCatalog";
import ShotCard, { type ShotNode } from "./storyboard-r2v/ShotCard";
import { buildAssembledPrompt } from "./storyboard-r2v/buildAssembledPrompt";
import DialogueAudioRow from "./storyboard-r2v/DialogueAudioRow";
import StoryboardGenerateDialog from "./storyboard-r2v/StoryboardGenerateDialog";
import { toast } from "@/store/toastStore";
import AssetDrawer from "./storyboard-r2v/AssetDrawer";
import { type VideoConfig, DEFAULT_VIDEO_CONFIG } from "./storyboard-r2v/VideoConfigModal";
import {
    migrateShotNode,
    appendT2IImage,
    setActiveT2IIndex,
    removeT2IImage,
    getActiveT2IImageUrl,
    frameToShotNode,
} from "./storyboard-r2v/shotNodeHelpers";
import { overridePanelSectionState } from "./storyboard-r2v/shot-panel/usePanelSectionState";
import ParamsSection, { type ParamsState } from "./storyboard-r2v/shot-panel/ParamsSection";
import T2ISubsection from "./storyboard-r2v/shot-panel/T2ISubsection";
import CandidatesSection from "./storyboard-r2v/shot-panel/CandidatesSection";
import CompareModal from "./storyboard-r2v/shot-panel/CompareModal";
import TaskQueueButton from "./storyboard-r2v/shot-panel/TaskQueueButton";
import TaskQueuePanel from "./storyboard-r2v/shot-panel/TaskQueuePanel";
import { GenerationBanner, type BannerState } from "./storyboard-r2v/GenerationBanner";

// Pending retries outlive the panel so navigation cannot dispatch the same request twice.
const useVideoRetryRequests = create<Partial<Record<string, Promise<void>>>>(() => ({}));
const useVideoSelectionRequests = create<Partial<Record<string, { mode: string; taskId?: string; promise: Promise<void> }>>>(() => ({}));

export default function StoryboardR2V() {
    const projectId = useProjectStore(state => state.currentProject?.id);
    const userId = useAuthStore(state => state.user?.id);
    const workspaceId = useAuthStore(state => state.activeWorkspace?.id);
    return <StoryboardWorkbench key={JSON.stringify([userId, workspaceId, projectId])} />;
}

function StoryboardWorkbench() {
    const currentProject = useProjectStore((state) => state.currentProject);
    const updateProject = useProjectStore((state) => state.updateProject);
    const t = useTranslations("storyboardR2V");
    const tStudio = useTranslations("studioPage");
    const selectedFrameId = useProjectStore(state => state.selectedFrameId);
    const setSelectedFrameId = useProjectStore(state => state.setSelectedFrameId);

    const draftSave = useShotDrafts(currentProject?.id);
    const { queue: queueDraft, flush: flushDrafts, discard: discardDraft, materialize, resolveId, refine, refinedVersion, restore: restoreDraft } = draftSave;

    // Derive shots from project frames. Workbench state (T2I 抽卡
    // history, last-active tab, batch count) now comes from backend-
    // persisted frame fields (added in commit 9149b06) instead of
    // React-only state, so cross-refresh / cross-device users see the
    // same panel state. migrateShotNode still runs as a defensive
    // belt-and-suspenders for very old localStorage drafts.
    const [shots, setShots] = useState<ShotNode[]>(() => {
        if (currentProject?.frames && currentProject.frames.length > 0) {
            const videoTasks: any[] = (currentProject as any).video_tasks ?? [];
            return [...currentProject.frames.map((frame: any) => restoreDraft(frameToShotNode(frame, videoTasks))), ...draftSave.localShots()];
        }
        if (draftSave.localShots().length) return draftSave.localShots();
        return [migrateShotNode({ id: `shot_${Date.now()}`, prompt: "", tabMode: "direct_r2v" })];
    });

    const shotsRef = useRef(shots);
    shotsRef.current = shots;
    const structurePendingRef = useRef(false);
    const [structurePending, setStructurePending] = useState(false);
    structurePendingRef.current = structurePending || draftSave.materializing;
    const selectedShot = shots.find(shot => shot.id === selectedFrameId) || shots[0];

    // Global video config (with localStorage persistence for model selection)
    const [videoConfig, setVideoConfig] = useState<VideoConfig>(() => {
        const ls = typeof window !== 'undefined' ? window.localStorage : null;
        const savedI2v = ls?.getItem('storyboard-r2v-model') ?? null;
        const savedR2v = ls?.getItem('storyboard-r2v-r2v-model') ?? null;
        const projectI2v = currentProject?.model_settings?.i2v_model || DEFAULT_I2V_MODEL_ID;

        // I2V — defensive: a cached localStorage model id may have been
        // hidden or removed from the I2V list since it was last
        // selected (e.g. the user once picked `wan2.7-r2v` while it was
        // visible, the catalog later marked it hidden, and now the ID
        // lingers in their browser). Falling back to the default avoids
        // silently shipping the wrong model into the I2V flow.
        const i2vCandidate = savedI2v || projectI2v;
        const i2vOk = VIDEO_I2V_MODELS.find(m => m.id === i2vCandidate);
        const i2vModelId = i2vOk ? i2vCandidate : DEFAULT_I2V_MODEL_ID;
        if (!i2vOk && ls && savedI2v) {
            ls.removeItem('storyboard-r2v-model');
            debugLog.warn(
                "Studio",
                `Cached I2V model "${i2vCandidate}" is no longer in the visible I2V list; ` +
                `falling back to "${DEFAULT_I2V_MODEL_ID}".`,
            );
        }

        // R2V preference order:
        //   1. localStorage (user's last explicit pick — survives reloads)
        //   2. project.model_settings.r2v_model (project-level default,
        //      set in 生成设置 — Plan B "specialize" hierarchy)
        //   3. derived from i2v family (initial coherence on first mount)
        //   4. catalog DEFAULT_R2V_MODEL_ID
        // Each candidate is validated against VIDEO_R2V_MODELS so a
        // hidden id from any layer falls through cleanly.
        const projectR2v = currentProject?.model_settings?.r2v_model;
        const r2vDerived = getR2vRouteModelId(i2vModelId);
        const r2vCandidate = savedR2v || projectR2v || r2vDerived || DEFAULT_R2V_MODEL_ID;
        const r2vOk = VIDEO_R2V_MODELS.find(m => m.id === r2vCandidate);
        const r2vModelId = r2vOk ? r2vCandidate : (VIDEO_R2V_MODELS[0]?.id ?? DEFAULT_R2V_MODEL_ID);
        if (!r2vOk && ls && savedR2v) {
            ls.removeItem('storyboard-r2v-r2v-model');
        }

        const finalConfig = VIDEO_I2V_MODELS.find(m => m.id === i2vModelId);
        const dc = finalConfig?.duration;
        const defaultDuration = dc ? (dc.type === 'fixed' ? dc.value : dc.default) : 5;
        return {
            ...DEFAULT_VIDEO_CONFIG,
            model: i2vModelId,
            r2vModel: r2vModelId,
            duration: defaultDuration,
        };
    });

    // Modal & drawer state (configModalOpen retired with the gear; the
    // old VideoConfigModal mount is gone, replaced by per-shot
    // ParamsSection panels under each ShotCard. handleConfigChange is
    // also gone — model writes now flow through handleShotParamsChange
    // below, which mirrors them to localStorage.)
    const [drawerState, setDrawerState] = useState<{ isOpen: boolean; targetShotIndex: number | null }>({
        isOpen: false,
        targetShotIndex: null,
    });

    // Task-queue side panel state. Persisted across renders only; we
    // intentionally don't localStorage this — it's transient "I want
    // to peek at queue" UI affordance, not a saved layout preference.
    const [queueOpen, setQueueOpen] = useState(false);

    // Compare up to four completed takes within the selected shot and tab.
    const [compareSelectedIds, setCompareSelectedIds] = useState<Set<string>>(() => new Set());
    const [compareModalOpen, setCompareModalOpen] = useState(false);
    useEffect(() => {
        setCompareSelectedIds(new Set());
        setCompareModalOpen(false);
    }, [selectedShot?.id, selectedShot?.tabMode]);

    // Refs map for textareas (for asset insertion from drawer)
    const textareaRefs = useRef<Map<number, HTMLTextAreaElement>>(new Map());
    // Refs to each shot's outer wrapper so the task-queue panel can
    // jump-scroll the canvas to a specific frame.
    const shotWrapperRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());
    // Per-shot submission lockout (Issue 17) — debounce double-clicks and
    // strict-mode double-effects. Holds shot.id strings; entries auto-expire
    // after 500ms via setTimeout in generateVideoBatch.
    const submittingShotsRef = useRef<Set<string>>(new Set());

    // Inline per-shot validation error messages (shown by ParamsSection
    // below the Generate CTA). Used for pre-flight failures like
    // "R2V needs reference images" that we catch before hitting the
    // backend, so the user gets immediate feedback instead of a
    // task that queues, fails, and shows up only in the diagnose log.
    const [shotErrors, setShotErrors] = useState<Record<string, string>>({});
    const missingRefsMessage = useCallback(
        (modelLabel: string) =>
            t("missingRefs", { model: modelLabel }),
        [t],
    );

    // Per-shot seed override. The Seed advanced param doesn't live in
    // videoConfig (seeds are inherently per-generation; sharing one
    // across shots would defeat the "different shots = different
    // creative takes" expectation). Without this state the seed
    // input + dice button would appear to do nothing because
    // ParamsSection.set("seed", N) flowed up to handleShotParamsChange,
    // which silently dropped it, so the next paramsStateForShot()
    // call would always rebuild params.seed = undefined.
    //
    // `undefined` means "no explicit seed" (provider picks). Any
    // number means "use this exact seed" — same for all takes in a
    // batch (intentional: ×N with a fixed seed = N runs at that seed
    // for ablation testing). Users who want N varied takes leave it
    // empty.
    const [shotSeeds, setShotSeeds] = useState<Record<string, number | undefined>>({});

    // Per-shot batch count (the "抽卡 ×N" knob). Decoupled from
    // videoConfig because users typically pick the model + duration
    // once and vary count per shot. Keyed by shot.id so insert/move
    // don't shuffle counts onto the wrong shot. Seeded from backend
    // workbench_generate_count so user choices survive refresh.
    const [shotCounts, setShotCounts] = useState<Record<string, number>>(() => {
        const out: Record<string, number> = {};
        const frames: any[] = [...(currentProject?.frames ?? []), ...draftSave.localShots()];
        for (const f of frames) {
            const count = draftSave.countFor(f.id) ?? f.workbench_generate_count;
            if (typeof count === "number") {
                out[f.id] = count;
            }
        }
        return out;
    });

    // Creation and ID handoff outlive this panel, just like its drafts.
    useEffect(() => {
        setShots(previous => {
            const next = previous.map(shot => resolveId(shot.id) === shot.id ? shot : { ...shot, id: resolveId(shot.id) });
            return next.some((shot, index) => shot !== previous[index]) ? next : previous;
        });
        setShotCounts(previous => Object.fromEntries(Object.entries(previous).map(([id, count]) => [resolveId(id), count])));
        setShotSeeds(previous => Object.fromEntries(Object.entries(previous).map(([id, seed]) => [resolveId(id), seed])));
    }, [resolveId]);

    const materializeShot = materialize;

    const saveAllDrafts = useCallback(async () => {
        try {
            for (const [index, shot] of shots.entries()) {
                if (shot.id.startsWith("shot_") && (shot.prompt || draftSave.pending)) await materializeShot(shot, index);
            }
            return await flushDrafts();
        } catch (error) {
            toast.error(t("saveFailed"), { body: error instanceof Error ? error.message : t("unknownError") });
            return false;
        }
    }, [shots, draftSave.pending, materializeShot, flushDrafts, t]);

    useEffect(() => {
        if (!draftSave.pending || draftSave.hasError || !shots.some(shot => shot.id.startsWith("shot_"))) return;
        const timer = window.setTimeout(() => { void saveAllDrafts(); }, 800);
        return () => window.clearTimeout(timer);
    }, [shots, draftSave.pending, draftSave.hasError, saveAllDrafts]);

    const persistWorkbench = useCallback((shotId: string, patch: Parameters<typeof api.updateFrameWorkbench>[2]) => {
        queueDraft(shotId, "workbench", patch, 1000);
    }, [queueDraft]);
    const persistPrompt = useCallback((shotId: string, prompt: string) => {
        const frame = useProjectStore.getState().currentProject?.frames.find(frame => frame.id === shotId);
        queueDraft(shotId, "fields", frame?.visual_description != null ? { visual_description: prompt } : { action_description: prompt }, 800);
    }, [queueDraft]);

    const characters = currentProject?.characters || [];
    const scenes = currentProject?.scenes || [];
    const props = currentProject?.props || [];

    const updateT2IWorkbench = useCallback((shotId: string, change: (shot: ShotNode) => ShotNode) => {
        const shot = shotsRef.current.find(candidate => candidate.id === shotId);
        if (!shot) return;
        const next = change(shot);
        persistWorkbench(shotId, { t2i_image_urls: next.t2iImageUrls ?? [], t2i_selected_index: next.t2iSelectedIndex ?? 0 });
        shotsRef.current = shotsRef.current.map(candidate => candidate.id === shotId ? next : candidate);
        setShots(shotsRef.current);
    }, [persistWorkbench]);

    // New shots keep a local draft until materialized; deletion and ordering await confirmation.
    // Add a new shot after the given index
    const addShot = useCallback(async (afterIndex: number) => {
        if (!currentProject?.id || structurePendingRef.current) return;
        structurePendingRef.current = true;
        setStructurePending(true);
        const synthId = `shot_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        // PR-3e · pick default tabMode from project preference (inherited from
        // series). "i2v" (画面优先) → t2i_i2v; "r2v" (节奏优先, default) → direct_r2v.
        const defaultMode = currentProject?.default_generation_mode === "i2v" ? "t2i_i2v" : "direct_r2v";
        const newShot: ShotNode = {
            id: synthId,
            prompt: "",
            tabMode: defaultMode,
        };
        setShots(prev => {
            const updated = [...prev];
            updated.splice(afterIndex + 1, 0, newShot);
            return updated;
        });
        setSelectedFrameId(synthId);

        queueDraft(synthId, "workbench", { workbench_tab_mode: defaultMode }, 1000);
        try {
            await materializeShot(newShot, afterIndex + 1);
        } catch (err) {
            debugLog.warn("Studio", "addShot backend persist failed", err);
            toast.error(t("saveFailed"), {
                body: err instanceof Error ? err.message : t("unknownError"),
            });
        }
        finally {
            structurePendingRef.current = false;
            setStructurePending(false);
        }
    }, [currentProject, t, queueDraft, materializeShot]);

    // PR-3 followup · LLM storyboard generation. State + handler live at
    // the StoryboardR2V level (not in a sub-component) because the toast
    // lifecycle survives the dialog closing and we need the parent to
    // setShots() when the new frames come back.
    const [genDialogOpen, setGenDialogOpen] = useState(false);
    const [generating, setGenerating] = useState(false);
    const [bannerState, setBannerState] = useState<BannerState>(
        () => (currentProject?.frames?.length ?? 0) > 0 ? "summary" : "idle"
    );
    const [refineProgress, setRefineProgress] = useState<{ current: number; total: number } | null>(null);
    const [dialogueProgress, setDialogueProgress] = useState<{ current: number; total: number } | null>(null);

    const PHASE1_CAPTIONS = useMemo(() => [
        "正在分析剧本结构…",
        "识别场景切换点…",
        "拆分镜头与动作…",
        "琢磨每帧的构图和节奏…",
        "快了，安排景别和运镜…",
        "最后润色一下…",
    ], []);

    const bannerSummary = useMemo(() => {
        if (!currentProject?.frames?.length) return null;
        const frames = currentProject.frames as any[];
        const frameCount = frames.length;
        const withDialogue = frames.filter((f: any) =>
            f.dialogue_structured?.line || f.dialogue
        );
        const charsWithVoice = new Set(
            (currentProject as any).characters?.filter((c: any) => c.voice_id).map((c: any) => c.id) ?? []
        );
        const charNameToVoice = new Map<string, boolean>(
            (currentProject as any).characters?.filter((c: any) => c.voice_id).map((c: any) => [c.name?.toLowerCase(), true]) ?? []
        );
        const hasVoiceBinding = (f: any): boolean => {
            if (f.character_ids?.[0] && charsWithVoice.has(f.character_ids[0])) return true;
            const speaker = f.dialogue_structured?.speaker || f.speaker;
            return !!(speaker && charNameToVoice.has(speaker.toLowerCase()));
        };
        const dialogueReady = withDialogue.filter((f: any) =>
            hasVoiceBinding(f) && !f.audio_url
        ).length;
        const dialogueMissing = withDialogue.filter((f: any) => !hasVoiceBinding(f)).length;
        return { frameCount, dialogueReady, dialogueMissing };
    }, [currentProject?.frames, (currentProject as any)?.characters]);

    const handleBatchDialogue = useCallback(async () => {
        if (!currentProject?.id) return;
        setBannerState("dialogue");
        setDialogueProgress(null);
        try {
            const frames = currentProject.frames as any[] ?? [];
            const totalWithDialogue = frames.filter((f: any) => f.dialogue_structured?.line || f.dialogue).length;
            setDialogueProgress({ current: 0, total: totalWithDialogue });
            const result = await api.generateDialogueAudioBatch(currentProject.id);
            const stats = result._batch_stats;
            if (stats.failed > 0) {
                toast.warning(`对白生成完成：${stats.generated} 条成功，${stats.failed} 条失败`);
            } else if (stats.generated > 0) {
                toast.success(`已生成 ${stats.generated} 条对白音频`);
            } else if (stats.no_voice > 0 && stats.skipped === 0) {
                toast.warning(`${stats.no_voice} 条对白的角色尚未绑定语音`);
            } else if (stats.skipped > 0) {
                toast.success(t("dialogueAllUpToDate"));
            } else {
                toast.warning("未找到可生成的对白");
            }
            const updated = await api.getProject(currentProject.id);
            if (updated?.frames) updateProject(currentProject.id, { frames: updated.frames });
        } catch (e) {
            debugLog.error("Studio", "batch dialogue audio failed", e);
            toast.error(t("batchDialogueFailed"));
        } finally {
            setBannerState("summary");
            setDialogueProgress(null);
        }
    }, [currentProject, updateProject]);

    const handleSmartGenerate = useCallback(async () => {
        if (!currentProject?.id) return;
        const projectId = currentProject.id;
        const scriptText = (currentProject as any).originalText || (currentProject as any).original_text || "";
        if (!scriptText.trim()) {
            toast.warning(t("genToastNoScript"));
            return;
        }
        setGenerating(true);
        setBannerState("phase1");
        setShots([]);
        try {
            // Phase 1: generate coarse frames
            const updated = await api.analyzeToStoryboard(projectId, scriptText);
            const newFrameCount = Array.isArray(updated?.frames) ? updated.frames.length : 0;
            updateProject(projectId, updated);
            if (Array.isArray(updated?.frames)) {
                const defaultMode = currentProject.default_generation_mode === "i2v" ? "t2i_i2v" : "direct_r2v";
                const videoTasks: any[] = (updated as any).video_tasks ?? [];
                setShots(updated.frames.map((frame: any) => restoreDraft(frameToShotNode(frame, videoTasks, defaultMode))));
            }

            // Phase 2: batch refine (SSE)
            if (newFrameCount > 0) {
                setBannerState("phase2");
                setRefineProgress({ current: 0, total: newFrameCount });
                await api.refineBatchFrames(projectId, (event: RefineSSEEvent) => {
                    if (event.type === "frame_refine_start") {
                        setRefineProgress({ current: (event.frame_index ?? 0) + 1, total: event.total ?? newFrameCount });
                    }
                });
                const refreshed = await api.getProject(projectId);
                if (refreshed?.frames) {
                    updateProject(projectId, { frames: refreshed.frames });
                    const defaultMode = currentProject.default_generation_mode === "i2v" ? "t2i_i2v" : "direct_r2v";
                    const videoTasks: any[] = (refreshed as any).video_tasks ?? [];
                    setShots(refreshed.frames.map((frame: any) => restoreDraft(frameToShotNode(frame, videoTasks, defaultMode))));
                }
            }
            setBannerState("summary");
            toast.success(t("genToastDone", { count: newFrameCount }));
        } catch (err: any) {
            const detail = err?.response?.data?.detail || err?.message || t("genToastErrUnknown");
            toast.error(`${t("genToastErr")}: ${String(detail).slice(0, 200)}`);
        } finally {
            setGenerating(false);
            setRefineProgress(null);
            // Determine final banner state based on actual current shots
            setShots(currentShots => {
                setBannerState(currentShots.length > 0 ? "summary" : "idle");
                return currentShots;
            });
        }
    }, [currentProject, updateProject, t]);

    const displayedRefinements = useRef<Record<string, number>>({});
    useEffect(() => {
        const project = useProjectStore.getState().currentProject;
        if (!project) return;
        const next = shotsRef.current.map(shot => {
            const version = refinedVersion(shot.id);
            if (!version || displayedRefinements.current[shot.id] === version) return shot;
            const frame = project.frames.find(frame => frame.id === shot.id);
            if (!frame) return shot;
            displayedRefinements.current[shot.id] = version;
            return restoreDraft({ ...shot, ...frameToShotNode(frame, project.video_tasks ?? [], shot.tabMode) });
        });
        setShots(next);
    }, [refinedVersion, restoreDraft]);

    const handleRefineFrame = useCallback(async (frameId: string) => {
        try {
            if (await refine(frameId)) toast.success(t("refineDoneToast"));
        } catch (err) {
            toast.error(t("refineFailedToast"));
            debugLog.warn("Studio", "single frame refine failed", err);
        }
    }, [refine, t]);

    // Keep the current order visible until the backend confirms the mutation.
    const deleteShot = useCallback(async (index: number) => {
        const target = shots[index];
        if (!target || structurePendingRef.current) return;
        const projectId = currentProject?.id;
        structurePendingRef.current = true;
        setStructurePending(true);
        try {
            if (projectId && !target.id.startsWith("shot_")) {
                const resp = await crudApi.deleteFrame(projectId, target.id);
                if (Array.isArray(resp?.frames)) updateProject(projectId, { frames: resp.frames });
            }
            if (useProjectStore.getState().currentProject?.id !== projectId) return;
            discardDraft(target.id);
            setShots(prev => prev.filter(shot => shot.id !== target.id));
            if (useProjectStore.getState().selectedFrameId === target.id) {
                setSelectedFrameId(shots[index + 1]?.id ?? shots[index - 1]?.id ?? null);
            }
        } catch (err) {
            debugLog.warn("Studio", "deleteShot backend persist failed", err);
            toast.error(t("saveFailed"), { body: err instanceof Error ? err.message : t("unknownError") });
        } finally {
            structurePendingRef.current = false;
            setStructurePending(false);
        }
    }, [shots, currentProject?.id, t, updateProject, setSelectedFrameId, discardDraft]);

    const moveShot = useCallback(async (index: number, direction: "up" | "down") => {
        const targetIndex = direction === "up" ? index - 1 : index + 1;
        if (targetIndex < 0 || targetIndex >= shots.length || structurePendingRef.current) return;
        const ids = shots.map(shot => shot.id);
        if (ids.some(id => id.startsWith("shot_"))) {
            toast.error(t("saveFailed"));
            return;
        }
        [ids[index], ids[targetIndex]] = [ids[targetIndex], ids[index]];
        const projectId = currentProject?.id;
        structurePendingRef.current = true;
        setStructurePending(true);
        try {
            if (projectId) {
                const resp = await crudApi.reorderFrames(projectId, ids);
                if (Array.isArray(resp?.frames)) updateProject(projectId, { frames: resp.frames });
            }
            if (useProjectStore.getState().currentProject?.id !== projectId) return;
            setShots(prev => {
                const next = [...prev];
                const from = next.findIndex(shot => shot.id === shots[index].id);
                const to = next.findIndex(shot => shot.id === shots[targetIndex].id);
                if (from >= 0 && to >= 0) [next[from], next[to]] = [next[to], next[from]];
                return next;
            });
        } catch (err) {
            debugLog.warn("Studio", "moveShot backend persist failed", err);
            toast.error(t("saveFailed"), { body: err instanceof Error ? err.message : t("unknownError") });
        } finally {
            structurePendingRef.current = false;
            setStructurePending(false);
        }
    }, [shots, currentProject?.id, t, updateProject]);

    // Copy only after the source edits are saved; a failed copy leaves the sequence intact.
    const duplicateShot = useCallback(async (index: number) => {
        const source = shots[index];
        const projectId = currentProject?.id;
        if (!source || !projectId || structurePendingRef.current) return;
        structurePendingRef.current = true;
        setStructurePending(true);
        try {
            if (!await saveAllDrafts()) return;
            const sourceId = await materializeShot(source, index);
            const resp = await crudApi.copyFrame(projectId, sourceId, index + 1);
            const frame = resp?.frames?.[index + 1];
            if (!frame?.id) throw new Error("Frame copy returned no persisted frame");
            if (useProjectStore.getState().currentProject?.id !== projectId) return;
            setShots(prev => {
                const next = [...prev];
                next.splice(index + 1, 0, frameToShotNode(frame, []));
                return next;
            });
            setSelectedFrameId(frame.id);
            updateProject(projectId, { frames: resp.frames });
        } catch (err) {
            toast.error(t("saveFailed"), { body: err instanceof Error ? err.message : t("unknownError") });
        } finally {
            structurePendingRef.current = false;
            setStructurePending(false);
        }
    }, [shots, currentProject?.id, saveAllDrafts, materializeShot, updateProject, setSelectedFrameId, t]);

    // Update local input immediately; the shared writer retains it until acknowledged.
    const updatePrompt = useCallback((index: number, prompt: string) => {
        const shot = shots[index];
        if (!shot) return;
        persistPrompt(shot.id, prompt);
        setShots(prev => prev.map(s => s.id === shot.id ? { ...s, prompt } : s));
    }, [shots, persistPrompt]);

    const setTabMode = useCallback((index: number, mode: "t2i_i2v" | "direct_r2v") => {
        const shot = shots[index];
        if (!shot) return;
        persistWorkbench(shot.id, { workbench_tab_mode: mode });
        setShots(prev => prev.map(s => s.id === shot.id ? { ...s, tabMode: mode } : s));
    }, [shots, persistWorkbench]);

    // Structured field updates — local immediate + debounce 3s auto-save
    const handleUpdateField = useCallback((index: number, field: string, value: string | number | null) => {
        if (field === "duration" && (typeof value !== "number" || !Number.isFinite(value) || value <= 0)) return;
        setShots(prev => prev.map((s, i) => {
            if (i !== index) return s;
            if (field === "duration") return { ...s, duration: typeof value === "number" ? value : null };
            if (field === "shotSize") return { ...s, shotSize: typeof value === "string" ? value : null };
            if (field === "cameraAngle") return { ...s, cameraAngle: typeof value === "string" ? value : null };
            if (field === "cameraMovement") {
                const desc = typeof value === "string" ? value : "固定镜头";
                return {
                    ...s,
                    cameraMovementStructured: {
                        primary: desc,
                        speed: s.cameraMovementStructured?.speed ?? "normal",
                        description: desc,
                        secondary: s.cameraMovementStructured?.secondary ?? null,
                    },
                };
            }
            if (field === "transitionHint") return { ...s, transitionHint: typeof value === "string" ? value : null };
            return s;
        }));
        const shotId = shots[index]?.id;
        if (!shotId) return;
        const backendField: Record<string, any> = {};
        if (field === "duration") backendField.duration = typeof value === "number" ? value : undefined;
        if (field === "shotSize") backendField.shot_size = typeof value === "string" ? value : "";
        if (field === "cameraAngle") backendField.camera_angle = typeof value === "string" ? value : "";
        if (field === "cameraMovement") backendField.camera_movement_description = typeof value === "string" ? value : "固定镜头";
        if (field === "transitionHint") backendField.transition_hint = typeof value === "string" ? value : "";
        queueDraft(shotId, "fields", backendField, 3000);
    }, [shots, queueDraft]);

    // Duration editor config — derived from active R2V model's catalog entry
    const durationEditorCfg = useMemo(() => {
        const r2vModel = VIDEO_R2V_MODELS.find(m => m.id === videoConfig.r2vModel);
        const dc = r2vModel?.duration;
        if (!dc) return { min: 3, max: 15, step: 1 };
        if (dc.type === "slider") return { min: dc.min, max: dc.max, step: dc.step };
        if (dc.type === "buttons") return { min: Math.min(...dc.options), max: Math.max(...dc.options), step: 1 };
        return { min: dc.value, max: dc.value, step: 1 };
    }, [videoConfig.r2vModel]);

    // Parse asset tags from prompt and resolve to URLs
    const parseAssetTags = useCallback((prompt: string): string[] => {
        // HappyHorse uses [characterN:name] as generic reference-image slots.
        // N determines the position in the URL array: character1 → image[0], etc.
        // The "name" can be a character, scene, or prop — we look up all three.
        // Dedup by slot number (first-seen wins): the same slot referenced
        // multiple times in the prompt still corresponds to one reference
        // image, so [character1:小兔子] used twice resolves to one URL slot
        // not two. Without this, model expectations (characterN → URL[N-1])
        // would shift right and downstream slots would point to the wrong
        // images.
        const seenSlot = new Set<number>();
        const slots: { idx: number; url: string }[] = [];
        const tagPattern = /\[character(\d+):([^\]]+)\]/g;
        let match;
        while ((match = tagPattern.exec(prompt)) !== null) {
            const slotNum = parseInt(match[1], 10);
            if (seenSlot.has(slotNum)) continue;
            const name = match[2];
            let url: string | undefined;

            // Try character first
            const char = characters.find((c: any) => c.name === name);
            if (char) {
                url = selectedVariantUrl(char.reference_sheet) || selectedVariantUrl(char.full_body_asset);
            }
            // Try scene
            if (!url) {
                const scene = scenes.find((s: any) => s.name === name);
                const sceneAsset = scene?.image_asset;
                if (sceneAsset?.selected_id && sceneAsset.variants?.length) {
                    const selected = sceneAsset.variants.find((v: any) => v.id === sceneAsset.selected_id);
                    if (selected) url = selected.url;
                } else if (sceneAsset?.variants?.[0]) {
                    url = sceneAsset.variants[0].url;
                }
            }
            // Try prop
            if (!url) {
                const prop = props.find((p: any) => p.name === name);
                const propAsset = prop?.image_asset;
                if (propAsset?.selected_id && propAsset.variants?.length) {
                    const selected = propAsset.variants.find((v: any) => v.id === propAsset.selected_id);
                    if (selected) url = selected.url;
                } else if (propAsset?.variants?.[0]) {
                    url = propAsset.variants[0].url;
                }
            }

            if (url) {
                slots.push({ idx: slotNum, url });
                seenSlot.add(slotNum);
            }
        }
        // Sort by slot number so URL array matches HappyHorse's positional mapping
        slots.sort((a, b) => a.idx - b.idx);
        return slots.map(s => s.url);
    }, [characters, scenes, props]);

    const hasAssetTags = useCallback((prompt: string): boolean => {
        return /\[character\d+:[^\]]+\]/.test(prompt);
    }, []);

    const getUnresolvedAssetNames = useCallback((prompt: string): string[] => {
        const unresolved: string[] = [];
        const tagPattern = /\[character\d+:([^\]]+)\]/g;
        let match;
        while ((match = tagPattern.exec(prompt)) !== null) {
            const name = match[1];
            let hasImage = false;
            // Check character
            const char = characters.find((c: any) => c.name === name);
            if (char) {
                hasImage = !!(char.reference_sheet?.image_variants?.length || char.full_body_asset?.variants?.length);
            }
            // Check scene
            if (!hasImage) {
                const scene = scenes.find((s: any) => s.name === name);
                hasImage = !!(scene?.image_asset?.variants?.length);
            }
            // Check prop
            if (!hasImage) {
                const prop = props.find((p: any) => p.name === name);
                hasImage = !!(prop?.image_asset?.variants?.length);
            }
            if (!hasImage) unresolved.push(name);
        }
        return unresolved;
    }, [characters, scenes, props]);

    // Strip tags from prompt for clean text
    const cleanPrompt = (prompt: string): string => {
        return prompt.replace(/\[character\d+:[^\]]+\]/g, "").replace(/\s+/g, " ").trim();
    };

    // Generate T2I image for a shot (t2i_i2v mode stage 1)
    const generateT2I = useCallback(async (index: number) => {
        const shot = shots[index];
        if (!currentProject || !shot.prompt.trim()) return;

        setShots(prev => prev.map((s, i) =>
            i === index ? { ...s, t2iStatus: "pending" } : s
        ));

        try {
            const frameId = await materializeShot(shot, index);
            const result = await api.renderFrame(
                currentProject.id,
                frameId,
                {},  // compositionData (empty for now)
                cleanPrompt(shot.prompt),
                1    // batchSize
            );

            if (result?.task_id || result?.id) {
                const taskId = result.task_id || result.id;
                setShots(prev => prev.map((s, i) =>
                    i === index ? { ...s, t2iTaskId: taskId, t2iStatus: "processing" } : s
                ));
            } else if (result?.image_url || result?.rendered_image_url) {
                // Immediate result (synchronous render). Append to T2I
                // history + auto-select so the new image becomes the
                // active首帧 used by downstream I2V generation.
                const imageUrl = result.image_url || result.rendered_image_url;
                updateT2IWorkbench(frameId, s => appendT2IImage({ ...s, t2iStatus: "completed" }, imageUrl));
            }
        } catch (error) {
            debugLog.error("Studio", "Failed to generate T2I for shot:", error);
            setShots(prev => prev.map((s, i) =>
                i === index ? { ...s, t2iStatus: "failed" } : s
            ));
        }
    }, [shots, currentProject, materializeShot, updateT2IWorkbench]);

    // Generate video for a shot
    const generateVideo = useCallback(async (index: number) => {
        const shot = shots[index];
        if (!currentProject || !shot.prompt.trim()) return;

        const promptText = buildAssembledPrompt(shot);

        setShots(prev => prev.map((s, i) =>
            i === index ? { ...s, videoStatus: "pending" } : s
        ));

        try {
            const frameId = await materializeShot(shot, index);
            if (shot.tabMode === "direct_r2v") {
                // R2V mode: use reference assets. We prefer the user's
                // explicit R2V model choice (videoConfig.r2vModel) over
                // the derived route from the I2V model. The derivation
                // is kept as a fallback when the explicit r2vModel is
                // missing or invalid (which can only happen if the
                // catalog flipped under our feet).
                const referenceUrls = parseAssetTags(shot.prompt);
                const explicitR2v = videoConfig.r2vModel;
                const explicitOk = VIDEO_R2V_MODELS.some(m => m.id === explicitR2v);
                const routeModelId = explicitOk
                    ? explicitR2v
                    : getR2vRouteModelId(videoConfig.model);
                const imageBased = isR2vImageBased(routeModelId);

                const tasks = await api.createVideoTask(
                    currentProject.id,
                    "",  // no image_url for R2V
                    promptText,
                    videoConfig.duration,
                    undefined, // seed
                    videoConfig.resolution,
                    false, // generateAudio
                    "", // audioUrl
                    videoConfig.promptExtend,
                    videoConfig.negativePrompt,
                    1, // batchSize
                    routeModelId,  // use routed R2V model
                    frameId,
                    "multi", // shotType
                    "r2v", // generationMode
                    !imageBased ? referenceUrls : undefined, // referenceVideoUrls (Wan 2.6 legacy)
                    undefined, undefined, undefined, // kling params
                    undefined, undefined, // vidu params
                    imageBased ? referenceUrls : undefined, // referenceImageUrls
                );
                const task = Array.isArray(tasks) ? tasks[0] : tasks;

                if (task && task.id) {
                    setShots(prev => prev.map((s, i) =>
                        i === index ? { ...s, videoTaskId: task.id, videoStatus: "processing" } : s
                    ));
                }
            } else {
                // I2V mode: use T2I image as first frame.
                // Bug A guard: even if videoConfig.model passed the
                // mount-time check, the catalog can change at runtime
                // (catalog reload, project setting flip). Last sanity
                // check right before submit so we never ship an r2v-
                // only model into the I2V flow.
                const i2vModelOk = VIDEO_I2V_MODELS.some(m => m.id === videoConfig.model);
                if (!i2vModelOk) {
                    debugLog.warn(
                        "Studio",
                        `Refusing to submit I2V task with model "${videoConfig.model}" ` +
                        `which is not in the visible I2V list. Falling back to "${DEFAULT_I2V_MODEL_ID}".`,
                    );
                    setVideoConfig(c => ({ ...c, model: DEFAULT_I2V_MODEL_ID }));
                    if (typeof window !== 'undefined') {
                        localStorage.removeItem('storyboard-r2v-model');
                    }
                    setShots(prev => prev.map((s, i) =>
                        i === index ? { ...s, videoStatus: "failed" as const } : s,
                    ));
                    return;
                }
                // Use the multi-frame-aware accessor so this legacy path
                // stays in sync with the new ParamsSection batch path
                // (Issue 15). `shot.t2iImageUrl` (legacy singular) and
                // `shot.t2iImageUrls[selectedIndex]` should normally agree,
                // but the singular field has occasionally lagged behind the
                // plural one (e.g. async upload state mid-flight), causing
                // HappyHorse to silently submit with no media.
                const imageUrl = getActiveT2IImageUrl(shot) || shot.imageUrl || "";
                if (!imageUrl) {
                    // I2V without a first frame is guaranteed to fail with
                    // "input.media required" on HappyHorse — surface inline
                    // instead of letting it 502 mid-generation.
                    setShotErrors(prev => ({
                        ...prev,
                        [shot.id]: t("i2vNeedsFirstFrame") || "请先上传或生成首帧再生成视频。",
                    }));
                    setShots(prev => prev.map((s, i) =>
                        i === index ? { ...s, videoStatus: undefined } : s,
                    ));
                    return;
                }

                const tasks = await api.createVideoTask(
                    currentProject.id,
                    imageUrl,
                    promptText,
                    videoConfig.duration,
                    undefined, // seed
                    videoConfig.resolution,
                    false, // generateAudio
                    "", // audioUrl
                    videoConfig.promptExtend,
                    videoConfig.negativePrompt,
                    1, // batchSize
                    videoConfig.model, // direct I2V model
                    frameId,
                    "multi", // shotType
                    "i2v", // generationMode
                    undefined, // referenceVideoUrls
                    // Kling params
                    videoConfig.mode,
                    videoConfig.sound,
                    videoConfig.cfgScale,
                    // Vidu params
                    videoConfig.viduAudio,
                    videoConfig.movementAmplitude,
                    // HappyHorse
                    undefined,
                );
                const task = Array.isArray(tasks) ? tasks[0] : tasks;

                if (task && task.id) {
                    setShots(prev => prev.map((s, i) =>
                        i === index ? { ...s, videoTaskId: task.id, videoStatus: "processing" } : s
                    ));
                }
            }
        } catch (error: any) {
            debugLog.error("Studio", "Failed to generate video for shot:", error);
            const detail = error?.response?.data?.detail || error?.message || t("unknownErrorFallback");
            toast.error(t("videoGenFailedToast", { detail: String(detail).slice(0, 150) }));
            setShots(prev => prev.map((s, i) =>
                i === index ? { ...s, videoStatus: "failed" } : s
            ));
        }
    }, [shots, currentProject, videoConfig, parseAssetTags, materializeShot]);

    // Batch-aware generation. The user's "抽卡" mental model: one
    // click of Generate ×N fires N independent createVideoTask calls
    // in parallel (each becomes its own VideoTask record on the
    // backend). All N task ids get appended to the shot's per-tab
    // bucket so the CandidatesSection can render them as one batch.
    // Refactored from the single-task generateVideo to support both
    // R2V and I2V paths; falls back to N=1 if count is undefined.
    const generateVideoBatch = useCallback(async (
        index: number,
        count: number,
        params?: Partial<ParamsState>,
    ) => {
        const shot = shots[index];
        if (!currentProject || !shot?.prompt.trim()) return;
        const promptText = buildAssembledPrompt(shot);
        const tabMode = shot.tabMode;
        const effectiveCount = Math.max(1, Math.min(6, count || 1));

        // Pre-flight: R2V tab needs reference inputs. Without them
        // the backend rejects with 400 anyway, but historically the
        // task would queue, fail mid-generation, and the user'd see
        // "排队中..." until the failure surfaced. Cheaper to validate
        // here and show inline error in the ParamsSection.
        if (tabMode === "direct_r2v") {
            const refs = parseAssetTags(shot.prompt);
            if (refs.length === 0) {
                const hasTags = hasAssetTags(shot.prompt);
                let errMsg: string;
                if (hasTags) {
                    const unresolved = getUnresolvedAssetNames(shot.prompt);
                    errMsg = t("unresolvedRefImages", { refs: unresolved.join("、") });
                } else {
                    const r2vModelId = params?.model ?? videoConfig.r2vModel;
                    const r2vModel = VIDEO_R2V_MODELS.find(m => m.id === r2vModelId);
                    const modelLabel = r2vModel?.name ?? r2vModelId;
                    errMsg = missingRefsMessage(modelLabel);
                }
                setShotErrors(prev => ({ ...prev, [shot.id]: errMsg }));
                toast.warning(errMsg);
                return;
            }
        } else {
            const probeImage = getActiveT2IImageUrl(shot) || shot.imageUrl || "";
            if (!probeImage) {
                const errMsg = t("i2vNeedsFirstFrame") || "请先上传或生成首帧再生成视频。";
                setShotErrors(prev => ({ ...prev, [shot.id]: errMsg }));
                toast.warning(errMsg);
                return;
            }
        }

        // Per-shot submission lockout (Issue 17). The earlier in-flight guard
        // (`shot.videoStatus === "pending"|"processing"`) had a false positive
        // problem: when a shot has multiple tasks (batch ×4), one fails + others
        // still processing, retrying the failed one was BLOCKED by the others'
        // status. Replace with a 500ms debounce on the SHOT specifically — that
        // catches double-clicks / strict-mode double-fires without entangling
        // status semantics.
        if (submittingShotsRef.current.has(shot.id)) {
            debugLog.warn("Studio", "generateVideoBatch: refused — same shot submitted < 500ms ago");
            return;
        }
        submittingShotsRef.current.add(shot.id);
        window.setTimeout(() => submittingShotsRef.current.delete(shot.id), 500);
        // Clear any prior error once this attempt is valid; success
        // path or backend-side rejection will overwrite if needed.
        setShotErrors(prev => {
            if (!prev[shot.id]) return prev;
            const next = { ...prev };
            delete next[shot.id];
            return next;
        });

        setShots(prev => prev.map((s, i) =>
            i === index ? { ...s, videoStatus: "pending" } : s
        ));

        try {
            const frameId = await materializeShot(shot, index);
            // Build a per-call factory so the batch fires N parallel
            // requests through Promise.all — fail-fast on any one
            // failure leaves the others untouched on the backend (the
            // BG-task wrapper handles their lifecycle independently).
            const createOne = async (): Promise<string | null> => {
                if (tabMode === "direct_r2v") {
                    const referenceUrls = parseAssetTags(shot.prompt);
                    const explicitR2v = params?.model ?? videoConfig.r2vModel;
                    const explicitOk = VIDEO_R2V_MODELS.some(m => m.id === explicitR2v);
                    const routeModelId = explicitOk
                        ? explicitR2v
                        : getR2vRouteModelId(videoConfig.model);
                    const imageBased = isR2vImageBased(routeModelId);
                    const tasks = await api.createVideoTask(
                        currentProject.id,
                        "",
                        promptText,
                        params?.duration ?? videoConfig.duration,
                        params?.seed,
                        params?.resolution ?? videoConfig.resolution,
                        false,
                        "",
                        params?.promptExtend ?? videoConfig.promptExtend,
                        params?.negativePrompt ?? videoConfig.negativePrompt,
                        1,
                        routeModelId,
                        frameId,
                        params?.shotType ?? "multi",
                        "r2v",
                        !imageBased ? referenceUrls : undefined,
                        undefined, undefined, undefined,
                        undefined, undefined,
                        imageBased ? referenceUrls : undefined,
                        params?.ratio,
                        tabMode,
                        params?.watermark,
                    );
                    const task = Array.isArray(tasks) ? tasks[0] : tasks;
                    return task?.id ?? null;
                }
                // I2V branch — same defensive check on the model.
                const i2vModelId = params?.model ?? videoConfig.model;
                const i2vModelOk = VIDEO_I2V_MODELS.some(m => m.id === i2vModelId);
                if (!i2vModelOk) {
                    debugLog.warn("Studio", `Refusing I2V submission with non-I2V model "${i2vModelId}".`);
                    return null;
                }
                const imageUrl = getActiveT2IImageUrl(shot) || shot.imageUrl || "";
                const tasks = await api.createVideoTask(
                    currentProject.id,
                    imageUrl,
                    promptText,
                    params?.duration ?? videoConfig.duration,
                    params?.seed,
                    params?.resolution ?? videoConfig.resolution,
                    false,
                    "",
                    params?.promptExtend ?? videoConfig.promptExtend,
                    params?.negativePrompt ?? videoConfig.negativePrompt,
                    1,
                    i2vModelId,
                    frameId,
                    params?.shotType ?? "multi",
                    "i2v",
                    undefined,
                    params?.mode ?? videoConfig.mode,
                    params?.sound ?? videoConfig.sound,
                    params?.cfgScale ?? videoConfig.cfgScale,
                    params?.viduAudio ?? videoConfig.viduAudio,
                    params?.movementAmplitude ?? videoConfig.movementAmplitude,
                    undefined,
                    undefined,
                    tabMode,
                    params?.watermark,
                );
                const task = Array.isArray(tasks) ? tasks[0] : tasks;
                return task?.id ?? null;
            };

            const taskIds = (await Promise.all(
                Array.from({ length: effectiveCount }, createOne),
            )).filter((id): id is string => !!id);

            if (taskIds.length > 0) {
                setShotErrors(prev => {
                    if (!prev[shot.id]) return prev;
                    const next = { ...prev };
                    delete next[shot.id];
                    return next;
                });
                setShots(prev => prev.map((s, i) => {
                    if (i !== index) return s;
                    // Mirror the latest task id on the legacy single
                    // field so the ShotCard preview spinner / cancel
                    // CTA keep working. The candidates panel reads
                    // from project.video_tasks (filtered by
                    // frame_id + workbench_tab), so the per-tab id
                    // bucket on the shot is no longer needed.
                    return {
                        ...s,
                        videoTaskId: taskIds[taskIds.length - 1],
                        videoStatus: "processing" as const,
                    };
                }));
            } else {
                toast.error(t("videoGenSubmitFailedToast"));
                setShots(prev => prev.map((s, i) =>
                    i === index ? { ...s, videoStatus: "failed" as const } : s
                ));
            }
        } catch (error: any) {
            debugLog.error("Studio", "Batch generate failed for shot:", error);
            const status = error?.response?.status;
            const detail = error?.response?.data?.detail || error?.message || t("unknownErrorFallback");
            if (status === 400 && typeof detail === "string") {
                setShotErrors(prev => ({ ...prev, [shot.id]: detail }));
            }
            toast.error(t("videoGenFailedToast", { detail: String(detail).slice(0, 150) }));
            setShots(prev => prev.map((s, i) =>
                i === index ? { ...s, videoStatus: "failed" as const } : s
            ));
        }
    }, [shots, currentProject, videoConfig, parseAssetTags, missingRefsMessage, materializeShot]);

    const [refreshingTasks, setRefreshingTasks] = useState(false);
    const [taskRefreshError, setTaskRefreshError] = useState(false);
    const [taskRefreshNeeded, setTaskRefreshNeeded] = useState(false);
    const taskRefreshRequest = useRef<Promise<void> | null>(null);
    const taskContext = useRef({
        active: false,
        userId: useAuthStore.getState().user?.id,
        workspaceId: useAuthStore.getState().activeWorkspace?.id,
    });
    useEffect(() => {
        const context = { ...taskContext.current, active: true };
        taskContext.current = context;
        return () => { context.active = false; };
    }, []);

    const refreshProject = useCallback((): Promise<void> => {
        if (taskRefreshRequest.current) return taskRefreshRequest.current;
        const projectId = currentProject?.id;
        const context = taskContext.current;
        const isCurrent = () => context.active
            && useAuthStore.getState().user?.id === context.userId
            && useAuthStore.getState().activeWorkspace?.id === context.workspaceId
            && useProjectStore.getState().currentProject?.id === projectId;
        if (!projectId || !isCurrent()) return Promise.resolve();
        const projectAtStart = useProjectStore.getState().currentProject;
        const selectionsAtStart = useVideoSelectionRequests.getState();
        setRefreshingTasks(true);
        const request = (async () => {
            try {
                const fresh = await api.getProject(projectId);
                if (!isCurrent()) return;
                // A task mutation won the race; the next read will reconcile it.
                const current = useProjectStore.getState().currentProject!;
                if (current.video_tasks !== projectAtStart?.video_tasks) {
                    setTaskRefreshNeeded(true);
                    return;
                }
                let selectionReadNeeded = false;
                const selectionWriteOccurred = selectionsAtStart !== useVideoSelectionRequests.getState();
                const frames = current.frames.map(frame => {
                    const saved = fresh.frames?.find((saved: { id: string }) => saved.id === frame.id);
                    if (!saved) return frame;
                    const before = projectAtStart?.frames.find(before => before.id === frame.id);
                    const key = JSON.stringify([context.userId, context.workspaceId, projectId, frame.id]);
                    const fields = ["selected_video_id", "video_url", "is_video_pinned"] as const;
                    if (fields.every(field => saved[field] === frame[field])) return frame;
                    if (selectionWriteOccurred || selectionsAtStart[key] || fields.some(field => before?.[field] !== frame[field])) {
                        selectionReadNeeded = true;
                        return frame;
                    }
                    return { ...frame, selected_video_id: saved.selected_video_id, video_url: saved.video_url, is_video_pinned: saved.is_video_pinned };
                });
                // Completion and adoption are saved together by the backend. Do not
                // replace prompt edits or a selection written while this read ran.
                updateProject(projectId, { video_tasks: fresh.video_tasks ?? [], frames: frames.some((frame, index) => frame !== current.frames[index]) ? frames : current.frames });
                setTaskRefreshNeeded(selectionReadNeeded);
                setTaskRefreshError(false);
            } catch {
                if (isCurrent()) setTaskRefreshError(true);
            } finally {
                if (isCurrent()) setRefreshingTasks(false);
                taskRefreshRequest.current = null;
            }
        })();
        taskRefreshRequest.current = request;
        return request;
    }, [currentProject?.id, updateProject]);

    const hasPendingVideoTasks = (currentProject?.video_tasks ?? []).some(task =>
        task.status === "pending" || task.status === "processing",
    ) || shots.some(shot => {
        if (!shot.videoTaskId) return false;
        const task = currentProject?.video_tasks?.find(task => task.id === shot.videoTaskId);
        return !task || task.status === "pending" || task.status === "processing";
    });
    useEffect(() => {
        if (!hasPendingVideoTasks && !taskRefreshNeeded) return;
        // Editing a shot must not postpone task updates. Slow reads share one request.
        const timer = window.setInterval(() => { void refreshProject(); }, 5000);
        return () => window.clearInterval(timer);
    }, [hasPendingVideoTasks, taskRefreshNeeded, refreshProject]);

    // Poll only asset-generation tasks through the generic task endpoint.
    // Video tasks are canonical on currentProject.video_tasks and are refreshed
    // by the project-level poll above; /tasks/{id} does not expose video tasks.
    useEffect(() => {
        const processingShots = shots.filter(s =>
            (s.t2iTaskId && (s.t2iStatus === "processing" || s.t2iStatus === "pending"))
        );
        if (processingShots.length === 0) return;

        const interval = setInterval(async () => {
            for (const shot of processingShots) {
                // Poll T2I task
                if (shot.t2iTaskId && (shot.t2iStatus === "processing" || shot.t2iStatus === "pending")) {
                    try {
                        const status = await api.getTaskStatus(shot.t2iTaskId);
                        if (status.status === "completed") {
                            const imageUrl = status.image_url || status.video_url || status.result_url;
                            if (imageUrl) {
                                updateT2IWorkbench(shot.id, s => appendT2IImage({ ...s, t2iStatus: "completed" }, imageUrl));
                            }
                        } else if (status.status === "failed") {
                            setShots(prev => prev.map(s =>
                                s.id === shot.id ? { ...s, t2iStatus: "failed" } : s
                            ));
                        }
                    } catch (error) {
                        debugLog.error("Studio", "T2I poll failed for shot:", shot.id, error);
                    }
                }
            }
        }, 5000);

        return () => clearInterval(interval);
    }, [shots, updateT2IWorkbench]);

    // Insert asset tag from drawer into target shot
    const insertAssetFromDrawer = useCallback((type: string, name: string) => {
        const shotIndex = drawerState.targetShotIndex;
        if (shotIndex === null || shotIndex === undefined) return;

        const tag = `[${type}:${name}]`;
        const textarea = textareaRefs.current.get(shotIndex) ?? null;
        if (textarea) {
            const start = textarea.selectionStart;
            const end = textarea.selectionEnd;
            const currentPrompt = shots[shotIndex].prompt;
            const newPrompt = currentPrompt.slice(0, start) + tag + currentPrompt.slice(end);
            updatePrompt(shotIndex, newPrompt);
            setTimeout(() => {
                textarea.selectionStart = textarea.selectionEnd = start + tag.length;
                textarea.focus();
            }, 0);
        } else {
            updatePrompt(shotIndex, shots[shotIndex].prompt + " " + tag);
        }
    }, [drawerState.targetShotIndex, shots, updatePrompt]);

    // Toolbar model display: surface the model the project's workflow
    // mode actually uses, not the I2V parent. R2V projects were
    // showing "wan2.7-i2v" while their generation actually went
    // through wan2.6-r2v / wan2.7-r2v — confusing and the source of
    // the "but I selected R2V" support thread.
    const isR2VWorkflow = (currentProject?.workflow_mode ?? "r2v") === "r2v";
    const currentModelName = isR2VWorkflow
        ? (VIDEO_R2V_MODELS.find(m => m.id === videoConfig.r2vModel)?.name ?? videoConfig.r2vModel)
        : (VIDEO_I2V_MODELS.find(m => m.id === videoConfig.model)?.name ?? videoConfig.model);

    // ---- Project-level task derivations (drive Queue + Candidates) ----
    // We derive these via useMemo so per-render allocation is cheap and
    // children can rely on referentially-stable arrays (set-membership
    // tests in CompareModal etc. are correctness-sensitive).
    const allVideoTasks: VideoTask[] = useMemo(
        () => ((currentProject as any)?.video_tasks ?? []) as VideoTask[],
        [currentProject],
    );
    const retryRequests = useVideoRetryRequests();
    const retryScope = [taskContext.current.userId, taskContext.current.workspaceId, currentProject?.id];
    const retryingTaskIds = new Set(allVideoTasks.filter(task => retryRequests[JSON.stringify([...retryScope, task.id])]).map(task => task.id));

    const tasksById = useMemo(() => {
        const map = new Map<string, VideoTask>();
        for (const t of allVideoTasks) map.set(t.id, t);
        return map;
    }, [allVideoTasks]);

    // Map shot.id → human label for the queue panel's frame column.
    const shotLabelByFrameId = useMemo(() => {
        const out: Record<string, string> = {};
        shots.forEach((s, i) => { out[s.id] = `${t("shot")} ${i + 1}`; });
        return out;
    }, [shots, t]);

    // In-flight aggregate count drives the TaskQueueButton badge.
    const inFlightTaskCount = useMemo(
        () => allVideoTasks.filter(t => t.status === "pending" || t.status === "processing").length,
        [allVideoTasks],
    );

    const videoSelectionRequests = useVideoSelectionRequests();
    const selectingVideoFrames = Object.fromEntries(shots.map(shot => [shot.id, !!videoSelectionRequests[JSON.stringify([...retryScope, shot.id])]]));
    const updateVideoSelection = useCallback((frameId: string, mode: "select" | "unpin", taskId?: string): Promise<void> => {
        const projectId = currentProject?.id;
        const context = taskContext.current;
        const isCurrent = () => useAuthStore.getState().user?.id === context.userId
            && useAuthStore.getState().activeWorkspace?.id === context.workspaceId
            && useProjectStore.getState().currentProject?.id === projectId;
        if (!projectId || !isCurrent()) return Promise.resolve();
        const key = JSON.stringify([context.userId, context.workspaceId, projectId, frameId]);
        const existing = useVideoSelectionRequests.getState()[key];
        if (existing) {
            if (existing.mode === mode && existing.taskId === taskId) return existing.promise;
            return existing.promise.catch(() => {}).then(() => updateVideoSelection(frameId, mode, taskId));
        }
        const promise = (async () => {
            try {
                const updated = mode === "unpin" ? await api.unpinVideo(projectId, frameId)
                    : await api.selectVideo(projectId, frameId, taskId!);
                if (!isCurrent()) return;
                const frame = updated.frames?.find((frame: { id: string }) => frame.id === frameId);
                if (!frame) throw new Error("Video selection response is missing its frame");
                const selection = { selected_video_id: frame.selected_video_id, video_url: frame.video_url, is_video_pinned: frame.is_video_pinned };
                const frames = useProjectStore.getState().currentProject?.frames ?? [];
                const currentFrame = frames.find(current => current.id === frameId);
                if (!currentFrame) return;
                // The response is a project snapshot; only this frame's selection belongs to this operation.
                updateProject(projectId, { frames: frames.map(current => current.id === frameId ? { ...current, ...selection } : current) });
            } catch (error) {
                if (!context.active && isCurrent()) toast.error(t("candidateSaveFailed"));
                throw error;
            } finally {
                useVideoSelectionRequests.setState(state => {
                    const remaining = { ...state };
                    delete remaining[key];
                    return remaining;
                }, true);
            }
        })();
        useVideoSelectionRequests.setState({ [key]: { mode, taskId, promise } });
        return promise;
    }, [currentProject?.id, updateProject, t]);

    useEffect(() => {
        setShots(previous => {
            let changed = false;
            const next = previous.map(shot => {
                const frame = currentProject?.frames.find(frame => frame.id === shot.id);
                if (!frame) return shot;
                const videoUrl = frameToShotNode(frame, []).videoUrl ?? shot.videoUrl;
                const isVideoPinned = Boolean(frame.is_video_pinned);
                if (videoUrl === shot.videoUrl && isVideoPinned === !!shot.isVideoPinned) return shot;
                changed = true;
                return { ...shot, videoUrl, isVideoPinned, videoStatus: videoUrl ? "completed" as const : shot.videoStatus };
            });
            return changed ? next : previous;
        });
    }, [currentProject?.frames]);

    useEffect(() => {
        setShots(previous => {
            let changed = false;
            const next = previous.map(shot => {
                const task = allVideoTasks.find(task => task.id === shot.videoTaskId);
                const retry = allVideoTasks.filter(candidate => candidate.retry_of_task_id && candidate.frame_id === shot.id
                    && (candidate.status === "pending" || candidate.status === "processing"))
                    .sort((a, b) => b.created_at - a.created_at)[0];
                if (retry && retry.id !== shot.videoTaskId && (!shot.videoTaskId || (task && retry.created_at >= task.created_at))) {
                    changed = true;
                    return { ...shot, videoTaskId: retry.id, videoStatus: retry.status };
                }
                if (!task || (task.status !== "completed" && task.status !== "failed") || task.status === shot.videoStatus) return shot;
                changed = true;
                return { ...shot, videoStatus: task.status };
            });
            return changed ? next : previous;
        });
    }, [allVideoTasks]);

    // Compare modal needs the actual VideoTask objects for the
    // currently-selected ids (in whatever order they were selected).
    const compareTasks = useMemo(() => {
        const out: VideoTask[] = [];
        Array.from(compareSelectedIds).forEach((id) => {
            const t = tasksById.get(id);
            if (t?.status === "completed" && t.video_url) out.push(t);
        });
        return out;
    }, [compareSelectedIds, tasksById]);

    // Per-shot candidate tasks — derived directly from the project-
    // level video_tasks. After Phase 2 persistence, each VideoTask
    // carries `frame_id` + `workbench_tab` so we can bucket without a
    // shot-side index. Pre-Phase-2 tasks lack `workbench_tab`; they
    // fall back to `generation_mode` so legacy records still group
    // correctly into the right tab.
    const tasksForShot = useCallback((shot: ShotNode): VideoTask[] => {
        return allVideoTasks.filter((t) => {
            if (t.frame_id !== shot.id) return false;
            if (t.workbench_tab != null) {
                return t.workbench_tab === shot.tabMode;
            }
            // Legacy fallback: i2v tasks belong in t2i_i2v, r2v in direct_r2v.
            if (shot.tabMode === "direct_r2v") return t.generation_mode === "r2v";
            return t.generation_mode !== "r2v"; // i2v + undefined → i2v tab
        });
    }, [allVideoTasks]);

    // Build a ParamsState from videoConfig + per-shot overrides.
    // Single source of truth strategy:
    //  - Per-shot overrides (shotCounts, shotSeeds) for params whose
    //    "right value" naturally differs by shot.
    //  - videoConfig for shared knobs the user typically picks once
    //    and uses across all shots in a project.
    const paramsStateForShot = useCallback((shot: ShotNode): ParamsState => {
        const isR2v = shot.tabMode === "direct_r2v";
        const modelId = isR2v ? videoConfig.r2vModel : videoConfig.model;
        return {
            model: modelId,
            duration: shot.duration ?? videoConfig.duration,
            count: shotCounts[shot.id] ?? 1,
            // Per-shot seed override (Sweep G fix); undefined means
            // "random per generation".
            seed: shotSeeds[shot.id],
            resolution: videoConfig.resolution,
            ratio: undefined,
            negativePrompt: videoConfig.negativePrompt,
            promptExtend: videoConfig.promptExtend,
            cfgScale: videoConfig.cfgScale,
            mode: videoConfig.mode,
            movementAmplitude: videoConfig.movementAmplitude,
            sound: videoConfig.sound,
            viduAudio: videoConfig.viduAudio,
            watermark: videoConfig.watermark,
        };
    }, [videoConfig, shotCounts, shotSeeds]);

    // ParamsSection.onChange handler: per-shot overrides (count, seed)
    // go into their dedicated maps; everything else writes back to
    // the shared videoConfig (so the user's most-recent picks become
    // the new default for siblings). videoConfig is mirrored to
    // localStorage as a recovery cache only — the authoritative model
    // selection lives in project.model_settings, written via the
    // 生成设置 modal.
    const handleShotParamsChange = useCallback((shot: ShotNode, next: ParamsState) => {
        if ((shotCounts[shot.id] ?? 1) !== next.count) {
            persistWorkbench(shot.id, { workbench_generate_count: next.count });
        }
        setShotCounts(prev => ({ ...prev, [shot.id]: next.count }));
        // Sync duration back to structured field (single source of truth)
        if (next.duration !== (shot.duration ?? videoConfig.duration)) {
            const idx = shots.findIndex(s => s.id === shot.id);
            if (idx >= 0) handleUpdateField(idx, "duration", next.duration);
        }
        // Seed: track per-shot. Undefined ↔ "random" — stored as
        // delete-from-map so the entry doesn't accrete forever.
        setShotSeeds(prev => {
            const wasSet = prev[shot.id] !== undefined;
            const isSet = next.seed !== undefined && !Number.isNaN(next.seed);
            if (!wasSet && !isSet) return prev;
            if (wasSet && !isSet) {
                const out = { ...prev };
                delete out[shot.id];
                return out;
            }
            if (prev[shot.id] === next.seed) return prev;
            return { ...prev, [shot.id]: next.seed };
        });
        const isR2v = shot.tabMode === "direct_r2v";
        const ls = typeof window !== "undefined" ? window.localStorage : null;
        setVideoConfig(prev => {
            const updated: VideoConfig = {
                ...prev,
                duration: next.duration,
                resolution: next.resolution ?? prev.resolution,
                negativePrompt: next.negativePrompt ?? prev.negativePrompt,
                promptExtend: next.promptExtend ?? prev.promptExtend,
                cfgScale: next.cfgScale ?? prev.cfgScale,
                mode: next.mode ?? prev.mode,
                movementAmplitude: next.movementAmplitude ?? prev.movementAmplitude,
                sound: next.sound ?? prev.sound,
                viduAudio: next.viduAudio ?? prev.viduAudio,
                // Watermark — preserve undefined (means "model doesn't expose
                // it") so swapping to a non-watermark-supporting model clears it.
                watermark: next.watermark,
            };
            if (isR2v) {
                updated.r2vModel = next.model;
                ls?.setItem("storyboard-r2v-r2v-model", next.model);
            } else {
                updated.model = next.model;
                ls?.setItem("storyboard-r2v-model", next.model);
            }
            return updated;
        });
    }, [persistWorkbench, shotCounts, shots, videoConfig.duration, handleUpdateField]);

    const annotationRequests = useRef(new Map<string, Promise<void>>());
    const annotateCandidate = useCallback((task: VideoTask, payload: Parameters<typeof api.annotateVideoTask>[2]): Promise<void> => {
        const projectId = currentProject?.id;
        const context = taskContext.current;
        const isCurrent = () => context.active
            && useAuthStore.getState().user?.id === context.userId
            && useAuthStore.getState().activeWorkspace?.id === context.workspaceId
            && useProjectStore.getState().currentProject?.id === projectId;
        const previous = annotationRequests.current.get(task.id);
        const request = (async () => {
            if (previous) await previous.catch(() => {});
            if (!projectId || !isCurrent()) return;
            const updated: VideoTask = await api.annotateVideoTask(projectId, task.id, payload);
            if (!isCurrent()) return;
            if (updated.id !== task.id) throw new Error("Annotation response is missing its candidate");
            const annotation = payload.is_starred !== undefined ? { is_starred: updated.is_starred } : { label: updated.label };
            const tasks = useProjectStore.getState().currentProject?.video_tasks ?? [];
            // Preserve status and other annotations confirmed while this write was pending.
            updateProject(projectId, { video_tasks: tasks.map(current => current.id === task.id ? { ...current, ...annotation } : current) });
        })().finally(() => {
            if (annotationRequests.current.get(task.id) === request) annotationRequests.current.delete(task.id);
        });
        annotationRequests.current.set(task.id, request);
        return request;
    }, [currentProject?.id, updateProject]);
    const handleToggleStar = useCallback((task: VideoTask, next: boolean) => annotateCandidate(task, { is_starred: next }), [annotateCandidate]);

    const handleSetActive = useCallback((frameId: string, task: VideoTask) => {
        if (task.status !== "completed" || !task.video_url || task.frame_id !== frameId) return Promise.reject(new Error("Candidate is not available for this shot"));
        return updateVideoSelection(frameId, "select", task.id);
    }, [updateVideoSelection]);

    const handleUnpinVideo = useCallback(async (frameId: string) => {
        try { await updateVideoSelection(frameId, "unpin"); }
        catch { if (taskContext.current.active) toast.error(t("candidateSaveFailed")); }
    }, [updateVideoSelection, t]);

    const handleSetLabel = useCallback((task: VideoTask, next: string | null) =>
        annotateCandidate(task, next ? { label: next } : { clear_label: true }), [annotateCandidate]);

    const cancelRequests = useRef(new Map<string, Promise<void>>());
    const cancelTask = useCallback((taskId: string): Promise<void> => {
        const existing = cancelRequests.current.get(taskId);
        if (existing) return existing;
        const projectId = currentProject?.id;
        const context = taskContext.current;
        const isCurrent = () => context.active
            && useAuthStore.getState().user?.id === context.userId
            && useAuthStore.getState().activeWorkspace?.id === context.workspaceId
            && useProjectStore.getState().currentProject?.id === projectId;
        if (!projectId || !isCurrent()) return Promise.resolve();
        const request = (async () => {
            try {
                const updated: VideoTask = await api.cancelVideoTask(projectId, taskId);
                if (!isCurrent()) return;
                const tasks = useProjectStore.getState().currentProject?.video_tasks ?? [];
                updateProject(projectId, { video_tasks: tasks.some(task => task.id === taskId)
                    ? tasks.map(task => task.id === taskId ? updated : task)
                    : [...tasks, updated] });
                setShots(previous => previous.map(shot => shot.videoTaskId === taskId ? { ...shot, videoStatus: updated.status } : shot));
            } finally { cancelRequests.current.delete(taskId); }
        })();
        cancelRequests.current.set(taskId, request);
        return request;
    }, [currentProject?.id, updateProject]);
    const handleCancelTask = useCallback((task: VideoTask) => cancelTask(task.id), [cancelTask]);

    const handleRetryTask = useCallback((task: VideoTask): Promise<void> => {
        const projectId = currentProject?.id;
        const context = taskContext.current;
        const isCurrent = () => useAuthStore.getState().user?.id === context.userId
            && useAuthStore.getState().activeWorkspace?.id === context.workspaceId
            && useProjectStore.getState().currentProject?.id === projectId;
        if (!projectId || !isCurrent()) return Promise.reject(new Error("Task context changed"));
        const key = JSON.stringify([context.userId, context.workspaceId, projectId, task.id]);
        const existing = useVideoRetryRequests.getState()[key];
        if (existing) return existing;
        const request = (async () => {
            try {
                const created = await api.retryVideoTask(projectId, task.id);
                if (!created.id || created.project_id !== projectId || created.retry_of_task_id !== task.id) throw new Error("Retry returned an unrelated task");
                if (!isCurrent()) return;
                const tasks = useProjectStore.getState().currentProject?.video_tasks ?? [];
                // A poll may already have the new task's processing/completed state.
                if (!tasks.some(existing => existing.id === created.id)) updateProject(projectId, { video_tasks: [...tasks, created] });
            } catch (error) {
                if (!context.active && isCurrent()) toast.error(t("queueActionFailed"));
                throw error;
            } finally {
                useVideoRetryRequests.setState(state => {
                    const remaining = { ...state };
                    delete remaining[key];
                    return remaining;
                }, true);
            }
        })();
        useVideoRetryRequests.setState({ [key]: request });
        return request;
    }, [currentProject?.id, updateProject, t]);

    const handleCandidateClick = useCallback((task: VideoTask, mods: { shift: boolean; meta: boolean }) => {
        if (!mods.shift || task.status !== "completed" || !task.video_url || task.frame_id !== selectedShot?.id) return;
        setCompareSelectedIds(previous => {
            const next = new Set(previous);
            if (next.has(task.id)) next.delete(task.id);
            else if (next.size < 4) next.add(task.id);
            return next;
        });
    }, [selectedShot?.id]);

    // 复用此批参数: copy a batch's model + neg_prompt into videoConfig,
    // so the next Generate uses the same recipe. We don't change count
    // here — count remains the per-shot knob the user chose.
    const handleReuseBatchParams = useCallback((batch: BatchSummary) => {
        const first = batch.tasks[0];
        if (!first) return;
        setVideoConfig(prev => {
            const updated = { ...prev };
            // Decide which slot the batch's model lives in (I2V or R2V).
            if (VIDEO_R2V_MODELS.some(m => m.id === first.model)) {
                updated.r2vModel = first.model!;
            } else if (VIDEO_I2V_MODELS.some(m => m.id === first.model)) {
                updated.model = first.model!;
            }
            if (first.duration) updated.duration = first.duration;
            if (first.resolution) updated.resolution = first.resolution;
            if (first.negative_prompt !== undefined) updated.negativePrompt = first.negative_prompt;
            return updated;
        });
    }, []);

    // Select the queued shot and reveal its settings and candidates.
    const handleJumpToShot = useCallback((frameId: string) => {
        setSelectedFrameId(frameId);
        setQueueOpen(false);

        // Force inner sections open too — feels right when arriving from
        // a queue task: you want to see Params + Candidates for that shot.
        overridePanelSectionState([frameId], ["params", "candidates"], true);
        // Scroll after the next paint so the newly-expanded body is
        // measured correctly. RAF is sufficient — we don't need the
        // full layout effect cycle.
        requestAnimationFrame(() => {
            const el = shotWrapperRefs.current.get(frameId);
            if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
        });
    }, []);

    // Active candidate URL resolver — many backend video URLs are
    // relative paths needing the asset prefix to render in <video>.
    const resolveAssetUrl = useCallback((u: string) => getAssetUrl(u), []);

    // In-flight shot count for trailing slot stat
    const totalInFlight = useMemo(
        () => Object.values(shotCounts).reduce((acc: number, c: any) => acc + (c?.processing ?? 0) + (c?.pending ?? 0), 0),
        [shotCounts],
    );

    return (
        <div className={styles.page}>
        <div className={styles.main}>
            <header className={styles.header}>
                <div><p>{currentProject?.title} / {tStudio("storyboard")}</p><h2>{selectedShot ? tStudio("shotNumber", { number: shots.indexOf(selectedShot) + 1 }) : tStudio("storyboard")}</h2></div>
                <div className={styles.saveState}>
                        <span role="status" aria-label={t("saveStatus")} aria-live="polite" data-error={draftSave.hasError || undefined}>
                            {structurePending || draftSave.saving ? t("saving") : draftSave.hasError ? t("saveFailedRetained") : draftSave.pending ? t("unsaved") : t("saved")}
                        </span>
                        {draftSave.pending && <Button variant="quiet" isDisabled={draftSave.saving || !!(selectedShot && draftSave.isRefining(selectedShot.id))} onPress={() => { void saveAllDrafts(); }}>{t(draftSave.hasError ? "retrySave" : "saveNow")}</Button>}
                        {draftSave.pending && draftSave.storageUnavailable && <span role="alert">{t("draftStorageUnavailable")}</span>}
                    </div>
                <div className={styles.headerActions}>
                    <Button variant="quiet" onPress={() => document.dispatchEvent(new CustomEvent("omni_studio:navigateStep", { detail: "assembly" }))}>{tStudio("previewCut")}</Button>
                    <TaskQueueButton inFlightCount={inFlightTaskCount} open={queueOpen} onToggle={() => setQueueOpen(value => !value)} />
                    <Button variant="secondary" onPress={() => setGenDialogOpen(true)} isPending={generating}>{!generating && <Sparkles size={16} aria-hidden="true" />}{generating ? t("genInFlight") : t("genShots")}</Button>
                </div>
            </header>
            <GenerationBanner
                state={bannerState}
                phase1Captions={PHASE1_CAPTIONS}
                refineProgress={refineProgress}
                dialogueProgress={dialogueProgress}
                summary={bannerSummary}
                onGenerateDialogue={handleBatchDialogue}
            />

            <div className={styles.workbench}>
                {!shots.length && <EmptyState title={t("emptyTitle")} description={t("emptyBody")} action={<><Button onPress={() => setGenDialogOpen(true)} isPending={generating}>{t("emptyCTA")}</Button><Button variant="quiet" onPress={() => addShot(-1)}>{t("emptyManualAdd")}</Button></>} />}
                {shots.map((shot, index) => {
                    if (shot.id !== selectedShot?.id) return null;
                    const shotTasks = tasksForShot(shot);
                    const shotInFlight = shotTasks.filter(task => task.status === "pending" || task.status === "processing").length;
                    const paramsState = paramsStateForShot(shot);
                    const isI2vTab = shot.tabMode === "t2i_i2v";
                    const modelList = isI2vTab ? VIDEO_I2V_MODELS : VIDEO_R2V_MODELS;
                    return <div key="selected-shot" className={styles.selectedShot} ref={el => { shotWrapperRefs.current.set(shot.id, el); }}>
                        <ShotCard
                            shot={shot}
                            index={index}
                            totalShots={shots.length}
                            characters={characters}
                            scenes={scenes}
                            props={props}
                            onUpdatePrompt={(prompt) => updatePrompt(index, prompt)}
                            onUpdateField={(field, value) => handleUpdateField(index, field, value)}
                            durationEditorConfig={durationEditorCfg}
                            onGenerateT2I={() => generateT2I(index)}
                            onGenerateVideo={() => generateVideo(index)}
                            structurePending={structurePending || draftSave.materializing}
                            onDelete={() => deleteShot(index)}
                            onMoveUp={() => moveShot(index, "up")}
                            onMoveDown={() => moveShot(index, "down")}
                            onDuplicate={() => duplicateShot(index)}
                            onSetTabMode={(mode) => setTabMode(index, mode)}
                            onOpenDrawer={() => setDrawerState({ isOpen: true, targetShotIndex: index })}
                            onInsertAsset={(type, name) => {
                                // Direct chip insert (same as chip bar logic, delegated to chip bar)
                                const tag = `[${type}:${name}]`;
                                updatePrompt(index, shots[index].prompt + " " + tag);
                            }}
                            onCancelVideo={shot.videoTaskId ? () => cancelTask(shot.videoTaskId!) : undefined}
                            /* PR-3c · 闭环生成: ShotCard 内全宽生成行 + count selector.
                               canGenerate: direct_r2v 需 prompt; t2i_i2v 还需 first frame. */
                            generateCount={paramsState.count}
                            genSummary={`${
                                shot.tabMode === "direct_r2v"
                                    ? (VIDEO_R2V_MODELS.find(m => m.id === videoConfig.r2vModel)?.name ?? videoConfig.r2vModel ?? "")
                                    : (VIDEO_I2V_MODELS.find(m => m.id === videoConfig.model)?.name ?? videoConfig.model ?? "")
                            } · ${paramsState.duration}s`}
                            canGenerate={
                                shot.prompt.trim().length > 0
                                && (
                                    shot.tabMode === "direct_r2v"
                                    || !!shot.t2iImageUrl
                                    || (shot.t2iImageUrls?.length ?? 0) > 0
                                )
                            }
                            onSetGenerateCount={(n) => handleShotParamsChange(shot, { ...paramsState, count: n })}
                            onGenerateBatch={(n) => generateVideoBatch(index, n, paramsState)}
                            inFlightCount={shotInFlight}
                            onRefineFrame={() => handleRefineFrame(shot.id)}
                            isRefining={draftSave.isRefining(shot.id)}
                            onUnpinVideo={() => handleUnpinVideo(shot.id)}
                            isSelectingVideo={!!selectingVideoFrames[shot.id]}
                            onUpdateDialogue={async (text: string) => {
                                if (!currentProject) return;
                                try {
                                    await api.updateFrame(currentProject.id, shot.id, { dialogue: text });
                                    const updated = await api.getProject(currentProject.id);
                                    if (updated?.frames) updateProject(currentProject.id, { frames: updated.frames });
                                } catch (e) {
                                    debugLog.error("Studio", "update dialogue failed", e);
                                }
                            }}
                            referenceImages={parseAssetTags(shot.prompt)}
                            sequence={<section className={styles.sequence} aria-label={tStudio("sequence")}>
                                <header><span>{tStudio("sequence")}</span><span>{tStudio("shotCount", { count: shots.length })}</span></header>
                                <div className={styles.strip}>
                                    {shots.map((item, i) => <Button key={item.id} variant="quiet" className={styles.thumbnail} aria-pressed={item.id === shot.id} aria-label={tStudio("selectShot", { number: i + 1 })} onPress={() => setSelectedFrameId(item.id)}>
                                        {item.imageUrl || item.t2iImageUrl ? <img src={getAssetUrl(item.imageUrl || item.t2iImageUrl!)} alt="" /> : <span className={styles.noImage}><Film size={22} /></span>}
                                        <span>{tStudio("shotNumber", { number: i + 1 })}{item.duration ? ` · ${item.duration}s` : ""}</span>
                                        <strong>{item.visualDescription || item.prompt || tStudio("untitledShot")}</strong>
                                    </Button>)}
                                </div>
                                <footer><Button variant="quiet" isDisabled={structurePending || draftSave.materializing} onPress={() => addShot(index)}><Plus size={15} />{t("addShot")}</Button></footer>
                            </section>}
                            audio={(() => {
                            const frame = currentProject?.frames?.find((f: any) => f.id === shot.id);
                            if (!frame) return null;
                            const dialogueText = frame?.dialogue_structured?.line || frame?.dialogue;
                            const hasVideoTask = !!(frame.selected_video_id || (currentProject as any)?.video_tasks?.find((t: any) => t.frame_id === frame.id && t.status === "completed"));
                            // Show row when dialogue exists, or when video exists (dub available)
                            if (!dialogueText?.trim() && !hasVideoTask) return null;
                            const charId = Array.isArray(frame.character_ids) ? frame.character_ids[0] : null;
                            const speaker = charId ? characters.find((c: any) => c.id === charId) : null;
                            return (
                                <div className="mx-5 mb-4">
                                    <DialogueAudioRow key={frame.id}
                                        scriptId={currentProject!.id}
                                        frameId={frame.id}
                                        dialogue={dialogueText}
                                        voiceId={speaker?.voice_id}
                                        audioUrl={frame.audio_url}
                                        audioError={frame.audio_error}
                                        snapshotDialogue={dialogueText}
                                        snapshotVoiceId={frame.dialogue_voice_id}
                                        snapshotInstructions={frame.dialogue_instructions}
                                        onUpdateDialogue={async (text: string) => {
                                            if (!currentProject) return;
                                            try {
                                                await api.updateFrame(currentProject.id, frame.id, { dialogue: text });
                                                const updated = await api.getProject(currentProject.id);
                                                if (updated?.frames) updateProject(currentProject.id, { frames: updated.frames });
                                            } catch (e) {
                                                debugLog.error("Studio", "update dialogue from audio row failed", e);
                                            }
                                        }}
                                        onAudioUpdated={async () => {
                                            if (!currentProject) return;
                                            try {
                                                const updated = await api.getProject(currentProject.id);
                                                if (updated?.frames) {
                                                    updateProject(currentProject.id, { frames: updated.frames });
                                                }
                                            } catch (e) {
                                                debugLog.warn("Studio", "refresh after audio gen failed", e);
                                            }
                                        }}
                                        videoUrl={(() => {
                                            const selectedId = frame.selected_video_id;
                                            const task = (currentProject as any)?.video_tasks?.find(
                                                (t: any) => selectedId ? t.id === selectedId : (t.frame_id === frame.id && t.status === "completed")
                                            );
                                            return task?.video_url;
                                        })()}
                                        videoTaskId={frame.selected_video_id ||
                                            (currentProject as any)?.video_tasks?.find(
                                                (t: any) => t.frame_id === frame.id && t.status === "completed"
                                            )?.id}
                                        previewVideoUrl={frame.preview_video_url}
                                        dubbedVideoUrl={frame.dubbed_video_url}
                                        dubOffsetMs={frame.dub_offset_ms ?? 0}
                                        onPreviewDub={async (videoTaskId: string, offsetMs: number) => {
                                            if (!currentProject) return;
                                            await api.previewDub(currentProject.id, frame.id, videoTaskId, offsetMs);
                                            const updated = await api.getProject(currentProject.id);
                                            if (updated?.frames) {
                                                updateProject(currentProject.id, { frames: updated.frames });
                                            }
                                        }}
                                        onApplyDub={async () => {
                                            if (!currentProject) return;
                                            await api.applyDub(currentProject.id, frame.id);
                                            const updated = await api.getProject(currentProject.id);
                                            if (updated?.frames) {
                                                updateProject(currentProject.id, { frames: updated.frames });
                                            }
                                        }}
                                        onRevertDub={async () => {
                                            if (!currentProject) return;
                                            await api.revertDub(currentProject.id, frame.id);
                                            const updated = await api.getProject(currentProject.id);
                                            if (updated?.frames) {
                                                updateProject(currentProject.id, { frames: updated.frames });
                                            }
                                        }}
                                    />
                                </div>
                            );
                        })()}
                            configuration={<>                            {isI2vTab ? (
                                <div>
                                    <T2ISubsection key={shot.id}
                                        imageUrls={shot.t2iImageUrls ?? []}
                                        selectedIndex={shot.t2iSelectedIndex ?? 0}
                                        storyboardFrameUrl={shot.imageUrl || undefined}
                                        promptIsEmpty={!shot.prompt.trim()}
                                        generating={shot.t2iStatus === "pending" || shot.t2iStatus === "processing"}
                                        inFlightTaskId={shot.t2iTaskId}
                                        inFlightStatus={shot.t2iStatus}
                                        onSelect={(i) => updateT2IWorkbench(shot.id, s => setActiveT2IIndex(s, i))}
                                        onRemove={(i) => updateT2IWorkbench(shot.id, s => removeT2IImage(s, i))}
                                        onGenerate={() => generateT2I(index)}
                                        onUpload={async (file) => {
                                            // Issue 10: upload an external image as a T2I首帧 candidate.
                                            // Backend appends + auto-selects; we mirror state from the
                                            // returned frame (single source of truth for the URL the
                                            // server actually persisted).
                                            //
                                            // Frontend may hold a synthetic shot id (`shot_<ts>_<rand>`)
                                            // for shots created via the + button that haven't been
                                            // persisted yet. The backend has no such frame_id → 404.
                                            // Lazy-create the frame on backend first, then upload.
                                            if (!currentProject) return { code: "network", detail: "no current project" };
                                            try {
                                                let effectiveFrameId = shot.id;
                                                const isSynthetic = effectiveFrameId.startsWith("shot_");
                                                if (isSynthetic) {
                                                    // Materialize the shot on backend before any
                                                    // frame-scoped op. Send minimum viable payload —
                                                    // the prompt + tab mode survives via separate
                                                    // workbench PATCH calls already triggered elsewhere.
                                                    try {
                                                        const created = await crudApi.createFrame(currentProject.id, {
                                                            scene_id: "",
                                                            action_description: shot.prompt || "",
                                                            insert_at: index,
                                                        } as any);
                                                        // Find the newly inserted frame by index in the response
                                                        const newFrame = Array.isArray(created?.frames)
                                                            ? created.frames[Math.min(index, created.frames.length - 1)]
                                                            : null;
                                                        if (newFrame?.id) {
                                                            effectiveFrameId = newFrame.id;
                                                            // Swap synthetic id → backend id locally so
                                                            // subsequent ops (workbench persist, generate, etc.)
                                                            // hit the real frame.
                                                            setShots(prev => prev.map((s, j) =>
                                                                j === index ? { ...s, id: newFrame.id } : s,
                                                            ));
                                                        }
                                                    } catch (createErr: any) {
                                                        debugLog.error("Studio", "Lazy createFrame failed", createErr);
                                                        const cdetail = createErr?.response?.data?.detail || createErr?.message || "create frame failed";
                                                        return { code: "server", detail: `先创建镜头失败：${cdetail}` };
                                                    }
                                                }

                                                const updatedFrame = await api.uploadT2IFrame(
                                                    currentProject.id,
                                                    effectiveFrameId,
                                                    file,
                                                );
                                                if (!updatedFrame) return { code: "network", detail: "empty response" };
                                                const nextUrls: string[] = updatedFrame.t2i_image_urls ?? [];
                                                const nextIdx: number = typeof updatedFrame.t2i_selected_index === "number"
                                                    ? updatedFrame.t2i_selected_index
                                                    : Math.max(0, nextUrls.length - 1);
                                                setShots(prev => prev.map((s, j) => {
                                                    if (j !== index) return s;
                                                    return {
                                                        ...s,
                                                        t2iImageUrls: nextUrls,
                                                        t2iSelectedIndex: nextIdx,
                                                        t2iImageUrl: nextUrls[nextIdx],
                                                        t2iStatus: "completed",
                                                    };
                                                }));
                                                return undefined;
                                            } catch (err: any) {
                                                debugLog.error("Studio", "T2I upload failed", err);
                                                const status = err?.response?.status;
                                                // Always surface the backend detail string so the
                                                // user can self-diagnose ("frame not found", "OSS
                                                // write denied", etc.) instead of "请重试".
                                                const detail = err?.response?.data?.detail
                                                    || err?.message
                                                    || `HTTP ${status ?? "?"}`;
                                                if (status === 413) return { code: "size", detail: String(detail) };
                                                if (status === 415) return { code: "type", detail: String(detail) };
                                                if (status === 404) return { code: "not_found", detail: String(detail) };
                                                if (status && status >= 500) return { code: "server", detail: String(detail) };
                                                return { code: "network", detail: String(detail) };
                                            }
                                        }}
                                        resolveUrl={resolveAssetUrl}
                                    />
                                </div>
                            ) : null}
                            {/* Step 2 · 生成视频 (ParamsSection) — always shown
                                when shot expanded; renders below Step 1 in
                                t2i_i2v mode, and is the only section above
                                candidates in direct_r2v mode. */}
                            <div className={isI2vTab ? "border-t border-glass-border" : ""}>
                                <ParamsSection key={shot.id}
                                    shotId={shot.id}
                                    modelList={modelList}
                                    title={t("generationSettings")}
                                    params={paramsState}
                                    onChange={(next) => handleShotParamsChange(shot, next)}
                                    inFlightCount={shotInFlight}
                                    errorMessage={shotErrors[shot.id] ?? null}
                                />
                            </div>
</>}
                            candidates={                                <CandidatesSection key={shot.id}
                                    shotId={shot.id}
                                    tasks={shotTasks}
                                    activeModel={paramsState.model}
                                    compareSelectedIds={compareSelectedIds}
                                    activeTaskId={currentProject?.frames?.find((f: any) => f.id === shot.id)?.selected_video_id ?? null}
                                    dubbedVideoUrl={currentProject?.frames?.find((f: any) => f.id === shot.id)?.dubbed_video_url}
                                    dubbedVideoTaskId={currentProject?.frames?.find((f: any) => f.id === shot.id)?.dubbed_video_task_id}
                                    onClickThumb={handleCandidateClick}
                                    onToggleStar={handleToggleStar}
                                    onSetLabel={handleSetLabel}
                                    onSetActive={(task) => handleSetActive(shot.id, task)}
                                    isSelecting={!!selectingVideoFrames[shot.id]}
                                    isPinned={!!currentProject?.frames?.find(frame => frame.id === shot.id)?.is_video_pinned}
                                    onClearCompare={() => setCompareSelectedIds(new Set())}
                                    onCancel={handleCancelTask}
                                    onRetry={handleRetryTask}
                                    retryingTaskIds={retryingTaskIds}
                                    onReuseBatchParams={handleReuseBatchParams}
                                    onOpenCompare={() => setCompareModalOpen(true)}
                                    resolveUrl={resolveAssetUrl}
                                />}
                        />
                    </div>;
                })}
            </div>

            {/* Asset Drawer (fixed overlay) */}
            <AssetDrawer
                isOpen={drawerState.isOpen}
                onClose={() => setDrawerState({ isOpen: false, targetShotIndex: null })}
                characters={characters}
                scenes={scenes}
                props={props}
                onSelectAsset={insertAssetFromDrawer}
            />
        </div>
        {/* Right-side Task Queue — pushes (does not overlay) the main
            column. Mounted in the layout flex, not as a fixed overlay,
            so width compression is automatic when it opens. */}
        <TaskQueuePanel
            open={queueOpen}
            onClose={() => setQueueOpen(false)}
            tasks={allVideoTasks}
            refreshing={refreshingTasks}
            refreshError={taskRefreshError}
            onRefresh={refreshProject}
            shotLabelByFrameId={shotLabelByFrameId}
            onJumpToShot={handleJumpToShot}
            onCancel={handleCancelTask}
            onRetry={handleRetryTask}
            retryingTaskIds={retryingTaskIds}
        />
        {/* Keep the shared dialog mounted for its closing transition. */}
        <CompareModal
            isOpen={compareModalOpen && compareTasks.length >= 2}
            tasks={compareTasks}
            onClose={() => setCompareModalOpen(false)}
            resolveUrl={resolveAssetUrl}
        />
        {/* LLM-generate frames dialog */}
        <StoryboardGenerateDialog
            isOpen={genDialogOpen}
            onClose={() => setGenDialogOpen(false)}
            project={currentProject as any}
            existingShotCount={shots.length}
            onConfirm={handleSmartGenerate}
            onJumpToScript={() => {
                setGenDialogOpen(false);
                document.dispatchEvent(new CustomEvent("omni_studio:navigateStep", { detail: "script" }));
            }}
        />
        </div>
    );
}
