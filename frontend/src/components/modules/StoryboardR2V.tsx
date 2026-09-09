"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { create } from "zustand";
import { Button, EmptyState } from "@omnistudio/ui";
import styles from "./StoryboardR2V.module.css";
import { Plus, Film, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import { useProjectStore, mergeFrameStructure, addedFrame } from "@/store/projectStore";
import { useAuthStore } from "@/store/authStore";
import { useShotDrafts, mergeRefinementFields } from "./storyboard-r2v/useShotDrafts";
import { api, crudApi, type VideoTask, type RefineSSEEvent } from "@/lib/api";
import { getAssetUrl } from "@/lib/utils";
import { selectedVariantUrl } from "@/lib/characterImage";
import { debugLog } from "@/lib/debugLog";
import type { BatchSummary } from "./storyboard-r2v/shot-panel/CandidatesSection";
import { getR2vRouteModelId, isR2vImageBased, VIDEO_I2V_MODELS, VIDEO_R2V_MODELS, DEFAULT_I2V_MODEL_ID, DEFAULT_R2V_MODEL_ID } from "@/lib/modelCatalog";
import ShotCard, { type ShotNode } from "./storyboard-r2v/ShotCard";
import { buildAssembledPrompt } from "./storyboard-r2v/buildAssembledPrompt";
import DialogueAudioRow, { useDialogueAudioRequests } from "./storyboard-r2v/DialogueAudioRow";
import StoryboardGenerateDialog from "./storyboard-r2v/StoryboardGenerateDialog";
import { toast } from "@/store/toastStore";
import AssetDrawer from "./storyboard-r2v/AssetDrawer";
import { type VideoConfig, DEFAULT_VIDEO_CONFIG } from "./storyboard-r2v/VideoConfigModal";
import {
    migrateShotNode,
    extractT2IImageUrl,
    setActiveT2IIndex,
    removeT2IImage,
    getActiveT2IImageUrl,
    frameToShotNode,
    resolveDialogueSpeaker,
} from "./storyboard-r2v/shotNodeHelpers";
import { overridePanelSectionState } from "./storyboard-r2v/shot-panel/usePanelSectionState";
import ParamsSection, { type ParamsState } from "./storyboard-r2v/shot-panel/ParamsSection";
import T2ISubsection, { type T2IUploadError } from "./storyboard-r2v/shot-panel/T2ISubsection";
import CandidatesSection from "./storyboard-r2v/shot-panel/CandidatesSection";
import CompareModal from "./storyboard-r2v/shot-panel/CompareModal";
import TaskQueueButton from "./storyboard-r2v/shot-panel/TaskQueueButton";
import TaskQueuePanel from "./storyboard-r2v/shot-panel/TaskQueuePanel";
import { GenerationBanner } from "./storyboard-r2v/GenerationBanner";
import DirectorPlanEditor from "@/components/modules/DirectorPlan/DirectorPlanEditor";

// Pending retries outlive the panel so navigation cannot dispatch the same request twice.
// Reload recovery uses the frame's persisted image state; live requests stay in this tab.
const useFirstFrameRequests = create<Partial<Record<string, { pending: boolean; operation: "generate" | "upload"; error?: string; recovering?: boolean; previousGenerationId?: string }>>>(() => ({}));
const firstFrameFields = ["image_generation_id", "image_generation_status", "image_error", "image_url", "rendered_image_url", "t2i_image_urls", "t2i_selected_index"] as const;
const audioFields = ["audio_url", "audio_error", "audio_generation_id", "audio_generation_status", "dialogue_snapshot_text", "dialogue_voice_id", "dialogue_instructions", "dialogue_text_hash", "dialogue_snapshot_speed", "dialogue_snapshot_pitch", "dialogue_snapshot_volume", "sfx_url", "preview_sfx_url", "sfx_fingerprint", "preview_sfx_fingerprint"] as const;
const dubFields = ["preview_video_url", "preview_audio_url", "preview_video_task_id", "preview_source_video_url", "preview_offset_ms", "dub_generation_status", "dub_generation_id", "dub_error", "dubbed_video_url", "dubbed_video_task_id", "dub_offset_ms"] as const;
const useVideoRetryRequests = create<Partial<Record<string, Promise<void>>>>(() => ({}));
const useVideoSelectionRequests = create<Partial<Record<string, { mode: string; taskId?: string; promise: Promise<void> }>>>(() => ({}));
// Live submissions outlive the page; persisted jobs provide full-reload recovery.
export const useStoryboardRequests = create<Partial<Record<string, {
    id: string; phase: "analyze" | "refine"; pending?: boolean; submitted?: boolean; recovering?: boolean;
    previousGenerationId?: string; frameIds?: string[]; progress?: { current: number; total: number }; error?: string;
    baselineFrames?: any[];
}>>>(() => ({}));

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

    const firstFrameRequests = useFirstFrameRequests();
    const dialogueRequests = useDialogueAudioRequests();
    const storyboardRequests = useStoryboardRequests();
    const firstFrameContext = useRef({
        userId: useAuthStore.getState().user?.id,
        workspaceId: useAuthStore.getState().activeWorkspace?.id,
    }).current;
    const firstFrameKey = useCallback((frameId: string) => JSON.stringify([
        firstFrameContext.userId, firstFrameContext.workspaceId, currentProject?.id, frameId,
    ]), [firstFrameContext, currentProject?.id]);
    const isCurrentProject = useCallback(() => useAuthStore.getState().user?.id === firstFrameContext.userId
        && useAuthStore.getState().activeWorkspace?.id === firstFrameContext.workspaceId
        && useProjectStore.getState().currentProject?.id === currentProject?.id, [firstFrameContext, currentProject?.id]);


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
    const { structurePending, beginStructure, endStructure, localShots } = draftSave;
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

    // Another mount can complete a structure request. Reconcile order and IDs while
    // retaining local shot edits and any creation draft that has not received its ID.
    useEffect(() => {
        if (!currentProject) return;
        setShots(previous => {
            const existing = new Map(previous.map(shot => {
                const id = resolveId(shot.id);
                return [id, id === shot.id ? shot : { ...shot, id }];
            }));
            const next = currentProject.frames.map(frame => existing.get(frame.id)
                ?? restoreDraft(frameToShotNode(frame, currentProject.video_tasks ?? [], currentProject.default_generation_mode === "i2v" ? "t2i_i2v" : "direct_r2v")));
            const localIds = new Set(localShots().map(shot => shot.id));
            previous.forEach((shot, index) => {
                if (resolveId(shot.id) === shot.id && (localIds.has(shot.id)
                    || !currentProject.frames.length && previous.length === 1 && shot.id.startsWith("shot_") && !shot.prompt)) {
                    next.splice(Math.min(index, next.length), 0, shot);
                }
            });
            return next.length === previous.length && next.every((shot, index) => shot === previous[index]) ? previous : next;
        });
    }, [currentProject?.frames, resolveId, restoreDraft, localShots]);

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
        const ownsStructure = beginStructure();
        if (!ownsStructure) return;
        structurePendingRef.current = true;
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
            endStructure(ownsStructure);
        }
    }, [currentProject, t, queueDraft, materializeShot, beginStructure, endStructure]);

    const [genDialogOpen, setGenDialogOpen] = useState(false);
    const [storyboardReadiness, setStoryboardReadiness] = useState<Awaited<ReturnType<typeof api.getStoryboardReadiness>> | null>(null);
    const [storyboardReadinessLoading, setStoryboardReadinessLoading] = useState(false);
    useEffect(() => {
        if (!genDialogOpen || !currentProject?.id) return;
        let active = true;
        // Older test clients and embedded shells may not expose the optional
        // readiness endpoint yet; preserve the pre-readiness flow there.
        if (typeof api.getStoryboardReadiness !== "function") {
            setStoryboardReadiness(null);
            setStoryboardReadinessLoading(false);
            return () => { active = false; };
        }
        setStoryboardReadinessLoading(true);
        void api.getStoryboardReadiness(currentProject.id).then(report => {
            if (active) setStoryboardReadiness(report);
        }).catch(() => {
            if (active) setStoryboardReadiness(null);
        }).finally(() => {
            if (active) setStoryboardReadinessLoading(false);
        });
        return () => { active = false; };
    }, [genDialogOpen, currentProject?.id]);
    const batchScope = JSON.stringify([firstFrameContext.userId, firstFrameContext.workspaceId, currentProject?.id]);
    const storyboardRequest = storyboardRequests[batchScope];
    const storyboardJob = currentProject?.storyboard_generation;
    const storyboardRunning = storyboardJob?.status === "processing" || storyboardJob?.status === "pending";
    const storyboardSubmitting = !!storyboardRequest?.pending || !!storyboardRequest?.recovering;
    const generating = storyboardRunning || storyboardSubmitting;
    const bannerState = storyboardSubmitting ? (storyboardRequest.phase === "analyze" ? "phase1" : "phase2")
        : storyboardRunning ? (storyboardJob.phase === "analyze" ? "phase1" : "phase2") : (currentProject?.frames.length ? "summary" : "idle");
    const refineProgress = storyboardRunning && storyboardJob.phase === "refine"
        ? { current: Object.keys(storyboardJob.results).length, total: storyboardJob.frame_ids.length } : storyboardRequest?.progress ?? null;
    const { acceptRefinement, holdRefinements, hasPendingDrafts } = draftSave;
    const analysisBaseline = useRef<{ id: string; frames: any[] } | null>(null);
    if (storyboardRunning && storyboardJob.phase === "analyze" && analysisBaseline.current?.id !== storyboardJob.id) {
        analysisBaseline.current = { id: storyboardJob.id, frames: currentProject?.frames ?? [] };
    }
    useEffect(() => {
        holdRefinements(storyboardSubmitting && storyboardRequest.submitted ? storyboardRequest.frameIds ?? [] : storyboardRunning
            ? storyboardJob.frame_ids.filter(id => storyboardJob.phase === "analyze" || !storyboardJob.results[id]) : []);
    }, [storyboardJob, storyboardRunning, storyboardRequest, storyboardSubmitting, holdRefinements]);
    structurePendingRef.current = structurePending || draftSave.materializing || generating;
    const refinementIds = storyboardJob && (storyboardJob.phase === "refine" || storyboardJob.status === "completed")
        ? storyboardJob.frame_ids.filter(id => currentProject?.frames.some(frame => frame.id === id)
            && (storyboardJob.phase === "analyze" || !["completed", "skipped"].includes(storyboardJob.results[id]))) : [];
    const batchRequest = dialogueRequests[batchScope];
    const dialogueBatch = currentProject?.dialogue_audio_batch;
    const batchRunning = dialogueBatch?.status === "processing" || dialogueBatch?.status === "pending";
    const batchPending = !!batchRequest?.operation || !!batchRequest?.recovering || batchRunning;
    const dialogueProgress = batchRunning ? { current: Object.keys(dialogueBatch.results).length, total: dialogueBatch.frame_ids.length } : null;
    const batchInstructions = useCallback((frame: any) => {
        const draft = useDialogueAudioRequests.getState()[firstFrameKey(frame.id)]?.instructions;
        const previous = currentProject?.dialogue_audio_batch;
        const result = previous?.results[frame.id];
        return draft ?? (result !== "generated" && result !== "skipped" ? previous?.instructions[frame.id] : undefined);
    }, [firstFrameKey, currentProject?.dialogue_audio_batch]);

    const PHASE1_CAPTIONS = useMemo(() => [t("storyboardAnalyzing")], [t]);

    const adoptAnalyzedFrames = useCallback((fresh: any, before: any[] | undefined) => {
        const current = useProjectStore.getState().currentProject;
        if (!current || !Array.isArray(fresh.frames) || !fresh.frames.length) return null;
        // Repeated reads and the POST can observe the same completed analysis.
        // Keep edits to shots already adopted from that job.
        if (current.storyboard_generation?.id === fresh.storyboard_generation?.id
            && current.frames.length === fresh.frames.length
            && current.frames.every((frame, index) => frame.id === fresh.frames[index].id)) return current.frames;
        if (current.frames !== before || hasPendingDrafts()) return null;
        const defaultMode = current.default_generation_mode === "i2v" ? "t2i_i2v" : "direct_r2v";
        shotsRef.current = fresh.frames.map((frame: any) => restoreDraft(frameToShotNode(frame, fresh.video_tasks ?? [], defaultMode)));
        setShots(shotsRef.current);
        setSelectedFrameId(fresh.frames[0].id);
        return fresh.frames as any[];
    }, [hasPendingDrafts, restoreDraft, setSelectedFrameId]);

    const bannerSummary = useMemo(() => {
        const frames = currentProject?.frames ?? [];
        let dialogueReady = 0, dialogueMissing = 0;
        for (const frame of frames) {
            const text = restoreDraft(frameToShotNode(frame, [])).dialogueStructured?.line ?? frame.dialogue_structured?.line ?? frame.dialogue ?? "";
            if (!text.trim()) continue;
            const speaker = resolveDialogueSpeaker(frame, characters);
            if (!speaker?.voice_id) { dialogueMissing++; continue; }
            const instructions = batchInstructions(frame) ?? frame.dialogue_instructions ?? "";
            if (!frame.audio_url || frame.dialogue_snapshot_text !== text || frame.dialogue_voice_id !== speaker.voice_id || (frame.dialogue_instructions ?? "") !== instructions) dialogueReady++;
        }
        return { frameCount: frames.length, dialogueReady, dialogueMissing };
    }, [currentProject?.frames, characters, batchInstructions, dialogueRequests, restoreDraft]);

    const handleBatchDialogue = useCallback(async () => {
        const projectId = currentProject?.id;
        const existing = useDialogueAudioRequests.getState()[batchScope];
        if (!projectId || existing?.operation || existing?.recovering || batchRunning || generating) return;
        const isCurrent = () => useAuthStore.getState().user?.id === firstFrameContext.userId
            && useAuthStore.getState().activeWorkspace?.id === firstFrameContext.workspaceId
            && useProjectStore.getState().currentProject?.id === projectId;
        let submitted = false;
        const previousGenerationId = currentProject.dialogue_audio_batch?.id;
        useDialogueAudioRequests.setState({ [batchScope]: { operation: "batch", previousGenerationId } });
        try {
            if (!await saveAllDrafts()) throw new Error(t("saveFailed"));
            if (!isCurrent()) return;
            const current = useProjectStore.getState().currentProject!;
            const instructions = Object.fromEntries(current.frames.flatMap(frame => {
                const value = batchInstructions(frame);
                return value === undefined ? [] : [[frame.id, value]];
            }));
            submitted = true;
            const result = await api.generateDialogueAudioBatch(projectId, instructions);
            if (!isCurrent()) return;
            if (!result.dialogue_audio_batch?.id || !Array.isArray(result.frames)) throw new Error(t("batchDialogueFailed"));
            const latest = useProjectStore.getState().currentProject!;
            if (latest.dialogue_audio_batch?.id && latest.dialogue_audio_batch.id !== previousGenerationId && latest.dialogue_audio_batch.id !== result.dialogue_audio_batch.id) return;
            // The batch response owns audio fields only; editing may continue while it runs.
            updateProject(projectId, { dialogue_audio_batch: result.dialogue_audio_batch, frames: latest.frames.map(frame => {
                const saved = result.frames.find(saved => saved.id === frame.id);
                const before = current.frames.find(before => before.id === frame.id);
                const newerAudio = frame.audio_generation_id && frame.audio_generation_id !== before?.audio_generation_id && frame.audio_generation_id !== saved?.audio_generation_id;
                return saved && !newerAudio && result.dialogue_audio_batch.frame_ids.includes(frame.id)
                    ? { ...frame, ...Object.fromEntries(audioFields.map(field => [field, saved[field]])) } : frame;
            }) });
            useDialogueAudioRequests.setState({ [batchScope]: undefined });
        } catch (error: any) {
            const status = error?.response?.status;
            const recovering = submitted && (!status || status === 409 || status >= 500);
            useDialogueAudioRequests.setState({ [batchScope]: {
                error: recovering ? t("batchDialogueUnknown") : error?.response?.data?.detail || error?.message || t("batchDialogueFailed"),
                recovering, previousGenerationId,
            } });
        } finally {
            const request = useDialogueAudioRequests.getState()[batchScope];
            if (request?.operation) useDialogueAudioRequests.setState({ [batchScope]: undefined });
        }
    }, [currentProject?.id, currentProject?.dialogue_audio_batch?.id, batchScope, batchRunning, firstFrameContext, saveAllDrafts, batchInstructions, updateProject, t, generating]);

    const startRefinement = useCallback(async (frameIds: string[]) => {
        const projectId = currentProject?.id;
        const existing = useStoryboardRequests.getState()[batchScope];
        if (!projectId || !frameIds.length || existing?.pending || existing?.recovering || batchPending || storyboardRunning) return;
        const isCurrent = () => useAuthStore.getState().user?.id === firstFrameContext.userId
            && useAuthStore.getState().activeWorkspace?.id === firstFrameContext.workspaceId
            && useProjectStore.getState().currentProject?.id === projectId;
        const request = { id: crypto.randomUUID(), phase: "refine" as const, pending: true, frameIds,
            previousGenerationId: useProjectStore.getState().currentProject?.storyboard_generation?.id };
        useStoryboardRequests.setState({ [batchScope]: request });
        let submitted = false;
        try {
            if (!await saveAllDrafts()) throw new Error(t("saveFailed"));
            if (!isCurrent()) { useStoryboardRequests.setState({ [batchScope]: undefined }); return; }
            submitted = true;
            holdRefinements(frameIds);
            useStoryboardRequests.setState({ [batchScope]: { ...request, submitted, progress: { current: 0, total: frameIds.length } } });
            await api.refineBatchFrames(projectId, (event: RefineSSEEvent) => {
                const latest = useStoryboardRequests.getState()[batchScope];
                if (latest?.id !== request.id || !["frame_refine_complete", "frame_refine_error"].includes(event.type)) return;
                useStoryboardRequests.setState({ [batchScope]: { ...latest, progress: { current: (event.frame_index ?? 0) + 1, total: event.total ?? frameIds.length } } });
            }, frameIds);
            const latest = useStoryboardRequests.getState()[batchScope];
            if (latest?.id === request.id) useStoryboardRequests.setState({ [batchScope]: { ...latest, pending: false, recovering: true } });
        } catch (error: any) {
            const status = error?.response?.status;
            const recovering = submitted && (!status || status === 409 || status >= 500);
            if (useStoryboardRequests.getState()[batchScope]?.id === request.id) useStoryboardRequests.setState({ [batchScope]: {
                ...request, pending: false, submitted, recovering,
                error: typeof error?.response?.data?.detail === "string" ? error.response.data.detail : recovering ? t("storyboardUnknown") : error?.message || t("refineFailedToast"),
            } });
        }
    }, [currentProject?.id, batchScope, batchPending, storyboardRunning, firstFrameContext, saveAllDrafts, holdRefinements, t]);

    const handleSmartGenerate = useCallback(async () => {
        const existing = useStoryboardRequests.getState()[batchScope];
        if (!currentProject?.id || batchPending || structurePending || storyboardRunning || existing?.pending || existing?.recovering) return;
        const projectId = currentProject.id;
        const scriptText = (currentProject as any).original_text ?? currentProject.originalText ?? "";
        if (!scriptText.trim()) { toast.warning(t("genToastNoScript")); return; }
        const isCurrent = () => useAuthStore.getState().user?.id === firstFrameContext.userId
            && useAuthStore.getState().activeWorkspace?.id === firstFrameContext.workspaceId
            && useProjectStore.getState().currentProject?.id === projectId;
        const request = { id: crypto.randomUUID(), phase: "analyze" as const, pending: true,
            previousGenerationId: currentProject.storyboard_generation?.id };
        useStoryboardRequests.setState({ [batchScope]: request });
        let submitted = false;
        try {
            if (!await saveAllDrafts()) throw new Error(t("saveFailed"));
            if (!isCurrent()) { useStoryboardRequests.setState({ [batchScope]: undefined }); return; }
            const baselineFrames = useProjectStore.getState().currentProject!.frames;
            const frameIds = baselineFrames.map(frame => frame.id);
            submitted = true;
            holdRefinements(frameIds);
            useStoryboardRequests.setState({ [batchScope]: { ...request, submitted, frameIds, baselineFrames } });
            const updated = await api.analyzeToStoryboard(projectId, scriptText);
            const latest = useStoryboardRequests.getState()[batchScope];
            if (latest?.id !== request.id) return;
            if (updated?.storyboard_generation?.status !== "completed" || !updated.frames?.length) throw new Error(t("storyboardUnknown"));
            const observedProject = useProjectStore.getState().currentProject;
            const observedId = observedProject?.storyboard_generation?.id;
            if (!isCurrent() || !taskContext.current.active
                || observedId && observedId !== request.previousGenerationId && observedId !== updated.storyboard_generation.id) {
                useStoryboardRequests.setState({ [batchScope]: { ...latest, pending: false, recovering: true } });
                return;
            }
            const adopted = adoptAnalyzedFrames(updated, baselineFrames);
            if (!adopted) {
                updateProject(projectId, { storyboard_generation: updated.storyboard_generation });
                useStoryboardRequests.setState({ [batchScope]: { ...request, pending: false, error: t("storyboardChangedDuringAnalysis") } });
                return;
            }
            updateProject(projectId, { frames: adopted, storyboard_generation: updated.storyboard_generation });
            useStoryboardRequests.setState({ [batchScope]: undefined });
            holdRefinements([]);
            // Continue the confirmed generation through the same path as a failed-item retry.
            await startRefinement(updated.frames.map((frame: { id: string }) => frame.id));
        } catch (error: any) {
            const status = error?.response?.status;
            const recovering = submitted && (!status || status === 409 || status >= 500);
            const latest = useStoryboardRequests.getState()[batchScope];
            if (latest?.id !== request.id) return;
            const detail = typeof error?.response?.data?.detail === "string" ? error.response.data.detail : recovering ? t("storyboardUnknown") : error?.message || t("genToastErrUnknown");
            useStoryboardRequests.setState({ [batchScope]: { ...latest, pending: false, recovering, error: detail } });
            if (isCurrent()) toast.error(`${t("genToastErr")}: ${String(detail).slice(0, 200)}`);
        }
    }, [currentProject, batchScope, batchPending, structurePending, storyboardRunning, firstFrameContext, saveAllDrafts, holdRefinements, adoptAnalyzedFrames, updateProject, startRefinement, t]);

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
        const ownsStructure = beginStructure();
        if (!ownsStructure) return;
        structurePendingRef.current = true;
        try {
            if (projectId && !target.id.startsWith("shot_")) {
                const resp = await crudApi.deleteFrame(projectId, target.id);
                if (!isCurrentProject()) return;
                updateProject(projectId, { frames: mergeFrameStructure(useProjectStore.getState().currentProject!.frames, resp?.frames) });
            }
            if (!isCurrentProject()) return;
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
            endStructure(ownsStructure);
        }
    }, [shots, currentProject?.id, t, updateProject, setSelectedFrameId, discardDraft, isCurrentProject, beginStructure, endStructure]);

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
        const ownsStructure = beginStructure();
        if (!ownsStructure) return;
        structurePendingRef.current = true;
        try {
            if (projectId) {
                const resp = await crudApi.reorderFrames(projectId, ids);
                if (!isCurrentProject()) return;
                updateProject(projectId, { frames: mergeFrameStructure(useProjectStore.getState().currentProject!.frames, resp?.frames) });
            }
            if (!isCurrentProject()) return;
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
            endStructure(ownsStructure);
        }
    }, [shots, currentProject?.id, t, updateProject, isCurrentProject, beginStructure, endStructure]);

    // Copy only after the source edits are saved; a failed copy leaves the sequence intact.
    const duplicateShot = useCallback(async (index: number) => {
        const source = shots[index];
        const projectId = currentProject?.id;
        if (!source || !projectId || structurePendingRef.current) return;
        const ownsStructure = beginStructure();
        if (!ownsStructure) return;
        structurePendingRef.current = true;
        const selectedAtStart = useProjectStore.getState().selectedFrameId;
        try {
            if (!await saveAllDrafts()) return;
            if (!isCurrentProject()) return;
            const sourceId = await materializeShot(source, index);
            if (!isCurrentProject()) return;
            const previousIds = new Set<string>(useProjectStore.getState().currentProject!.frames.map(frame => frame.id));
            const resp = await crudApi.copyFrame(projectId, sourceId, index + 1);
            if (!isCurrentProject()) return;
            const frames = mergeFrameStructure(useProjectStore.getState().currentProject!.frames, resp?.frames);
            const frame = addedFrame(previousIds, frames);
            setShots(prev => {
                const next = [...prev];
                next.splice(index + 1, 0, frameToShotNode(frame, []));
                return next;
            });
            if (useProjectStore.getState().selectedFrameId === selectedAtStart) setSelectedFrameId(frame.id);
            updateProject(projectId, { frames });
        } catch (err) {
            toast.error(t("saveFailed"), { body: err instanceof Error ? err.message : t("unknownError") });
        } finally {
            structurePendingRef.current = false;
            endStructure(ownsStructure);
        }
    }, [shots, currentProject?.id, saveAllDrafts, materializeShot, updateProject, setSelectedFrameId, t, isCurrentProject, beginStructure, endStructure]);

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

    const mergeAudioResult = (frameId: string, result: any, fields: readonly string[]) => {
        const auth = useAuthStore.getState();
        const current = useProjectStore.getState().currentProject;
        if (!current || auth.user?.id !== firstFrameContext.userId || auth.activeWorkspace?.id !== firstFrameContext.workspaceId || current.id !== currentProject?.id) return;
        const saved = result?.frames?.find((frame: { id: string }) => frame.id === frameId);
        if (!saved) throw new Error(t("saveFailed"));
        updateProject(current.id, { frames: current.frames.map(frame => frame.id === frameId
            ? { ...frame, ...Object.fromEntries(fields.map(field => [field, saved[field]])) } : frame) });
    };

    // Reentry observes the same request. Image readback must not replace prompt drafts.
    useEffect(() => {
        setShots(previous => previous.map(shot => {
            const request = firstFrameRequests[firstFrameKey(shot.id)];
            const frame = currentProject?.frames.find(frame => frame.id === shot.id);
            const saved = frame ? restoreDraft(frameToShotNode(frame, [])) : shot;
            const next = {
                ...shot, imageUrl: saved.imageUrl,
                dialogueStructured: saved.dialogueStructured,
                t2iImageUrls: saved.t2iImageUrls, t2iSelectedIndex: saved.t2iSelectedIndex,
                t2iError: request?.error || frame?.image_error || undefined,
                t2iOperation: request?.operation,
                t2iRecovering: request?.recovering,
            };
            return { ...next, t2iImageUrl: getActiveT2IImageUrl(next),
                t2iStatus: request?.pending || frame?.image_generation_status === "processing" ? "processing" : next.t2iError ? "failed"
                    : getActiveT2IImageUrl(next) || next.imageUrl ? "completed" : undefined };
        }));
    }, [currentProject?.frames, firstFrameRequests, firstFrameKey, restoreDraft]);

    // storyboard/render is a long synchronous request; its Script id is never a task id.
    const submitFirstFrame = useCallback(async (index: number, file?: File): Promise<T2IUploadError | void> => {
        const shot = shotsRef.current[index];
        if (!currentProject || !shot || (!file && !shot.prompt.trim())) return;
        const operation = file ? "upload" : "generate";
        let key = firstFrameKey(shot.id);
        if (useFirstFrameRequests.getState()[key]?.pending || currentProject.frames.find(frame => frame.id === shot.id)?.image_generation_status === "processing") return;
        const isCurrentScope = () => useAuthStore.getState().user?.id === firstFrameContext.userId
            && useAuthStore.getState().activeWorkspace?.id === firstFrameContext.workspaceId;
        const clearRequest = (requestKey: string) => useFirstFrameRequests.setState(state => {
            const next = { ...state }; delete next[requestKey]; return next;
        }, true);
        const requestState = { pending: true, operation, previousGenerationId: currentProject.frames.find(frame => frame.id === shot.id)?.image_generation_id } as const;
        useFirstFrameRequests.setState({ [key]: requestState });
        let dispatched = false;
        let received = false;
        try {
            const frameId = await materializeShot(shot, index);
            if (!isCurrentScope()) { clearRequest(key); return; }
            const persistedKey = firstFrameKey(frameId);
            if (persistedKey !== key) {
                clearRequest(key);
                if (useFirstFrameRequests.getState()[persistedKey]?.pending) return;
                key = persistedKey;
                useFirstFrameRequests.setState({ [key]: requestState });
            }
            // A queued history edit must settle before the server appends a new candidate.
            if (!await flushDrafts()) throw new Error(t("saveFailed"));
            if (!isCurrentScope()) { clearRequest(key); return; }
            dispatched = true;
            const result = file ? await api.uploadT2IFrame(currentProject.id, frameId, file)
                : await api.renderFrame(currentProject.id, frameId, {}, cleanPrompt(shot.prompt), 1);
            received = true;
            const rendered = file ? result : result?.frames?.find((frame: { id: string }) => frame.id === frameId);
            const imageUrl = file ? rendered?.t2i_image_urls?.[rendered.t2i_selected_index ?? 0] : extractT2IImageUrl(result, frameId);
            if ((!file && rendered?.status === "failed") || !imageUrl) throw new Error(rendered?.image_error || t("t2iFailed"));
            const project = useProjectStore.getState().currentProject;
            if (isCurrentScope() && project?.id === currentProject.id) {
                updateProject(project.id, { frames: project.frames.map(frame => frame.id === frameId ? {
                    ...frame, ...(!file ? { image_url: imageUrl, rendered_image_url: imageUrl } : {}), image_error: null,
                    image_generation_status: rendered?.image_generation_status ?? null,
                    image_generation_id: rendered?.image_generation_id ?? null,
                    t2i_image_urls: rendered?.t2i_image_urls?.length ? rendered.t2i_image_urls : [imageUrl],
                    t2i_selected_index: rendered?.t2i_selected_index ?? 0,
                } : frame) });
            }
            clearRequest(key);
        } catch (error: any) {
            debugLog.error("Studio", "Failed to generate T2I for shot:", error);
            const detail = error?.response?.data?.detail || error?.message || t("t2iFailed");
            const recovering = !file && dispatched && !received && (!error?.response || error.response.status === 409 || error.response.status >= 500);
            useFirstFrameRequests.setState({ [key]: { ...requestState, pending: recovering, recovering, error: String(detail) } });
            if (file) return { code: "network", detail: String(detail) };
        }
    }, [currentProject, materializeShot, flushDrafts, firstFrameKey, firstFrameContext, updateProject, t]);

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
    const missingFirstFrameMessage = t("t2iFrameMissing");
    const storyboardUnknownMessage = t("storyboardUnknown");
    const storyboardChangedMessage = t("storyboardChangedDuringAnalysis");
    const refinementDoneMessage = t("refineDoneToast");
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
        const imagesAtStart = useFirstFrameRequests.getState();
        const audioAtStart = useDialogueAudioRequests.getState();
        const storyboardAtStart = projectAtStart?.storyboard_generation;
        const storyboardRequestAtStart = useStoryboardRequests.getState()[batchScope];
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
                const batchAtStart = audioAtStart[batchScope];
                const batchObserved = projectAtStart?.dialogue_audio_batch;
                const watchBatch = batchObserved?.status === "processing" || batchObserved?.status === "pending" || !!batchAtStart?.operation || !!batchAtStart?.recovering;
                const batchReadSafe = batchAtStart === useDialogueAudioRequests.getState()[batchScope] && batchObserved === current.dialogue_audio_batch;
                if (watchBatch && !batchReadSafe) selectionReadNeeded = true;
                const watchStoryboard = storyboardAtStart?.status === "processing" || storyboardAtStart?.status === "pending"
                    || storyboardRequestAtStart?.submitted && (storyboardRequestAtStart.pending || storyboardRequestAtStart.recovering || !!storyboardRequestAtStart.error);
                const storyboardReadSafe = current.storyboard_generation === storyboardAtStart
                    && storyboardRequestAtStart?.id === useStoryboardRequests.getState()[batchScope]?.id;
                const storyboardObserved = !storyboardRequestAtStart?.submitted
                    || !!fresh.storyboard_generation?.id && fresh.storyboard_generation.id !== storyboardRequestAtStart.previousGenerationId;
                const completedAnalysis = watchStoryboard && storyboardReadSafe && storyboardObserved
                    && fresh.storyboard_generation?.phase === "analyze" && fresh.storyboard_generation.status === "completed";
                const acceptedAnalysis = completedAnalysis && adoptAnalyzedFrames(fresh, storyboardRequestAtStart?.baselineFrames ?? analysisBaseline.current?.frames ?? projectAtStart?.frames);
                if (watchStoryboard && !storyboardReadSafe) selectionReadNeeded = true;
                const refinedFrames: any[] = [];
                const frames = current.frames.map(frame => {
                    const saved = fresh.frames?.find((saved: { id: string }) => saved.id === frame.id);
                    const before = projectAtStart?.frames.find(before => before.id === frame.id);
                    const key = JSON.stringify([context.userId, context.workspaceId, projectId, frame.id]);
                    let next = frame;
                    if (watchStoryboard && storyboardReadSafe && storyboardObserved && fresh.storyboard_generation?.phase === "refine"
                        && fresh.storyboard_generation.results[frame.id] === "completed" && saved) {
                        next = mergeRefinementFields(next, saved, before);
                        refinedFrames.push(next);
                    }
                    for (const kind of ["audio", "dub"] as const) {
                        const fields = kind === "audio" ? audioFields : dubFields;
                        const statusField = `${kind}_generation_status` as const;
                        const generationField = `${kind}_generation_id` as const;
                        const errorField = kind === "audio" ? "audio_error" : "dub_error";
                        const request = audioAtStart[key];
                        const recovering = request?.recovering && (request.recoveryKind ?? "audio") === kind;
                        const batchAudio = kind === "audio" && watchBatch && batchReadSafe
                            && (fresh.dialogue_audio_batch?.frame_ids.includes(frame.id) || batchObserved?.frame_ids.includes(frame.id));
                        if (before?.[statusField] !== "processing" && request?.operation !== (kind === "audio" ? "generate" : "preview") && !recovering && !batchAudio) continue;
                        if (audioAtStart[key] !== useDialogueAudioRequests.getState()[key] || fields.some(field => before?.[field] !== frame[field])) {
                            selectionReadNeeded = true;
                        } else if (!saved) {
                            useDialogueAudioRequests.setState({ [key]: { instructions: audioAtStart[key]?.instructions } });
                            next = { ...next, [statusField]: "failed", [errorField]: missingFirstFrameMessage };
                        } else {
                            next = { ...next, ...Object.fromEntries(fields.map(field => [field, saved[field]])) };
                            if (recovering) {
                                useDialogueAudioRequests.setState(state => {
                                    const requests = { ...state };
                                    if (saved[generationField] && saved[generationField] !== audioAtStart[key]?.previousGenerationId) {
                                        if (saved[statusField] === "failed") requests[key] = { instructions: audioAtStart[key]?.instructions };
                                        else delete requests[key];
                                    }
                                    else requests[key] = { ...audioAtStart[key], recovering: false };
                                    return requests;
                                }, true);
                            }
                        }
                    }
                    const imageRequest = imagesAtStart[key];
                    if (before?.image_generation_status === "processing" || (imageRequest?.operation === "generate" && imageRequest.pending)) {
                        if (imageRequest !== useFirstFrameRequests.getState()[key] || firstFrameFields.some(field => before?.[field] !== frame[field])) {
                            selectionReadNeeded = true;
                        } else {
                            if (!saved) {
                                useFirstFrameRequests.setState(state => {
                                    const requests = { ...state }; delete requests[key]; return requests;
                                }, true);
                                return { ...next, image_generation_status: "failed", image_error: missingFirstFrameMessage };
                            }
                            // Never replace prompt drafts or a history selection written during this read.
                            next = { ...next, ...Object.fromEntries(firstFrameFields.map(field => [field, saved[field]])) };
                            if (imageRequest?.recovering) {
                                const observed = saved.image_generation_id && saved.image_generation_id !== imageRequest.previousGenerationId;
                                useFirstFrameRequests.setState(state => {
                                    const requests = { ...state };
                                    if (observed) delete requests[key];
                                    else requests[key] = { ...imageRequest, pending: false, recovering: false };
                                    return requests;
                                }, true);
                            }
                        }
                    }
                    if (!saved) return next;
                    const fields = ["selected_video_id", "video_url", "is_video_pinned"] as const;
                    if (fields.every(field => saved[field] === frame[field])) return next;
                    if (selectionWriteOccurred || selectionsAtStart[key] || fields.some(field => before?.[field] !== frame[field])) {
                        selectionReadNeeded = true;
                        return next;
                    }
                    return { ...next, selected_video_id: saved.selected_video_id, video_url: saved.video_url, is_video_pinned: saved.is_video_pinned };
                });
                // Completion and adoption are saved together by the backend. Do not
                // replace prompt edits or a selection written while this read ran.
                if (watchBatch && batchReadSafe && batchAtStart?.recovering) {
                    const observed = fresh.dialogue_audio_batch?.id && fresh.dialogue_audio_batch.id !== batchAtStart.previousGenerationId;
                    useDialogueAudioRequests.setState({ [batchScope]: observed ? undefined : { ...batchAtStart, recovering: false } });
                }
                updateProject(projectId, {
                    ...(watchStoryboard && storyboardReadSafe && storyboardObserved ? { storyboard_generation: fresh.storyboard_generation ?? null } : {}),
                    ...(watchBatch && batchReadSafe ? { dialogue_audio_batch: fresh.dialogue_audio_batch ?? null } : {}),
                    video_tasks: fresh.video_tasks ?? [], frames: acceptedAnalysis && acceptedAnalysis !== current.frames ? acceptedAnalysis : frames.some((frame, index) => frame !== current.frames[index]) ? frames : current.frames,
                });
                refinedFrames.forEach(acceptRefinement);
                const refinedJob = fresh.storyboard_generation;
                if (watchStoryboard && storyboardReadSafe && storyboardObserved && refinedJob?.phase === "refine" && refinedJob.status === "completed"
                    && (storyboardAtStart?.id !== refinedJob.id || storyboardAtStart?.status !== "completed")
                    && refinedJob.frame_ids.length > 0 && refinedJob.frame_ids.every((id: string) => ["completed", "skipped"].includes(refinedJob.results[id]))) {
                    toast.success(refinementDoneMessage);
                }
                if (watchStoryboard && storyboardReadSafe && storyboardRequestAtStart && !storyboardRequestAtStart.pending) {
                    useStoryboardRequests.setState({ [batchScope]: storyboardObserved ? undefined : { ...storyboardRequestAtStart, recovering: false, error: storyboardRequestAtStart.error || storyboardUnknownMessage } });
                }
                if (completedAnalysis && !acceptedAnalysis) useStoryboardRequests.setState({ [batchScope]: {
                    id: storyboardRequestAtStart?.id ?? crypto.randomUUID(), phase: "analyze", error: storyboardChangedMessage,
                } });
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
    }, [currentProject?.id, updateProject, missingFirstFrameMessage, batchScope, acceptRefinement, storyboardUnknownMessage, storyboardChangedMessage, refinementDoneMessage, adoptAnalyzedFrames]);

    useEffect(() => {
        if (storyboardRequest?.recovering) void refreshProject();
    }, [storyboardRequest?.id, storyboardRequest?.recovering, refreshProject]);

    const hasPendingVideoTasks = (currentProject?.video_tasks ?? []).some(task =>
        task.status === "pending" || task.status === "processing",
    ) || shots.some(shot => {
        if (!shot.videoTaskId) return false;
        const task = currentProject?.video_tasks?.find(task => task.id === shot.videoTaskId);
        return !task || task.status === "pending" || task.status === "processing";
    });
    const hasPendingImages = currentProject?.frames.some(frame => frame.image_generation_status === "processing")
        || shots.some(shot => firstFrameRequests[firstFrameKey(shot.id)]?.pending);
    const hasPendingDialogueMedia = batchPending || currentProject?.frames.some(frame => frame.audio_generation_status === "processing" || frame.dub_generation_status === "processing")
        || shots.some(shot => dialogueRequests[firstFrameKey(shot.id)]?.operation === "generate" || dialogueRequests[firstFrameKey(shot.id)]?.operation === "preview" || dialogueRequests[firstFrameKey(shot.id)]?.recovering);
    useEffect(() => {
        if (!hasPendingVideoTasks && !hasPendingImages && !hasPendingDialogueMedia && !generating && !taskRefreshNeeded) return;
        // Editing a shot must not postpone task updates. Slow reads share one request.
        const timer = window.setInterval(() => { void refreshProject(); }, 5000);
        return () => window.clearInterval(timer);
    }, [hasPendingVideoTasks, hasPendingImages, hasPendingDialogueMedia, generating, taskRefreshNeeded, refreshProject]);

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

    const handleDownloadBatch = useCallback(async (tasks: VideoTask[]) => {
        const projectId = currentProject?.id;
        const ids = tasks.filter(task => task.status === "completed" && task.video_url).map(task => task.id);
        if (!projectId || ids.length === 0) return;
        const blob = await api.downloadVideoCandidates(projectId, ids);
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `${projectId}_video_candidates.zip`;
        anchor.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }, [currentProject?.id]);

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
                    <Button variant="secondary" onPress={() => setGenDialogOpen(true)} isPending={generating} isDisabled={batchPending || structurePending}>{!generating && <Sparkles size={16} aria-hidden="true" />}{generating ? t("genInFlight") : t("genShots")}</Button>
                </div>
            </header>
            <GenerationBanner
                state={batchPending ? "dialogue" : bannerState}
                phase1Captions={PHASE1_CAPTIONS}
                refineProgress={refineProgress}
                dialogueProgress={dialogueProgress}
                summary={bannerSummary}
                onGenerateDialogue={handleBatchDialogue}
                batch={dialogueBatch}
                batchError={batchRequest?.error}
                storyboard={storyboardJob}
                storyboardError={storyboardRequest?.error}
                storyboardRecovering={storyboardRequest?.recovering}
                refinementCount={refinementIds.length}
                onRefine={() => { void startRefinement(refinementIds); }}
                refreshFailed={taskRefreshError && (generating || !!storyboardJob || batchPending || !!dialogueBatch)}
                refreshing={refreshingTasks}
                onRefresh={() => { void refreshProject(); }}
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
                        <DirectorPlanEditor projectId={currentProject!.id} episodeId={currentProject!.id} shotId={shot.id} />
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
                            onGenerateT2I={() => submitFirstFrame(index)}
                            onGenerateVideo={() => generateVideo(index)}
                            structurePending={structurePending || draftSave.materializing || generating}
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
                                <footer><Button variant="quiet" isDisabled={structurePending || draftSave.materializing || generating} onPress={() => addShot(index)}><Plus size={15} />{t("addShot")}</Button></footer>
                            </section>}
                            audio={(() => {
                            const frame = currentProject?.frames?.find((f: any) => f.id === shot.id);
                            if (!frame) return null;
                            const dialogueText = frame?.dialogue_structured?.line || frame?.dialogue;
                            const hasVideoTask = !!(frame.selected_video_id || (currentProject as any)?.video_tasks?.find((t: any) => t.frame_id === frame.id && t.status === "completed"));
                            // Show row when dialogue exists, or when video exists (dub available)
                            if (!dialogueText?.trim() && !hasVideoTask) return null;
                            const speaker = resolveDialogueSpeaker(frame, characters);
                            return (
                                <div className="mx-5 mb-4">
                                    <DialogueAudioRow key={frame.id}
                                        scriptId={currentProject!.id}
                                        frameId={frame.id}
                                        dialogue={dialogueText}
                                        actionDescription={frame.action_description}
                                        draftDialogue={restoreDraft(frameToShotNode(frame, [])).dialogueStructured?.line}
                                        voiceId={speaker?.voice_id}
                                        voiceSpeed={speaker?.voice_speed}
                                        voicePitch={speaker?.voice_pitch}
                                        voiceVolume={speaker?.voice_volume}
                                        audioUrl={frame.audio_url}
                                        sfxUrl={frame.sfx_url}
                                        previewSfxUrl={frame.preview_sfx_url}
                                        sfxFingerprint={frame.sfx_fingerprint}
                                        previewSfxFingerprint={frame.preview_sfx_fingerprint}
                                        audioError={frame.audio_error}
                                        generationStatus={frame.audio_generation_status}
                                        batchPending={batchPending || generating}
                                        generationId={frame.audio_generation_id}
                                        refreshFailed={taskRefreshError}
                                        refreshing={refreshingTasks}
                                        onRefresh={() => { void refreshProject(); }}
                                        snapshotDialogue={frame.dialogue_snapshot_text}
                                        snapshotVoiceId={frame.dialogue_voice_id}
                                        snapshotInstructions={frame.dialogue_instructions}
                                        snapshotSpeed={frame.dialogue_snapshot_speed}
                                        snapshotPitch={frame.dialogue_snapshot_pitch}
                                        snapshotVolume={frame.dialogue_snapshot_volume}
                                        onUpdateDialogue={async (text: string) => {
                                            queueDraft(frame.id, "fields", { dialogue: text }, 1000);
                                            if (!await flushDrafts()) throw new Error(t("saveFailed"));
                                        }}
                                        onDraftChange={text => queueDraft(frame.id, "fields", { dialogue: text }, 1000)}
                                        onAudioUpdated={result => mergeAudioResult(frame.id, result, audioFields)}
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
                                        previewAudioUrl={frame.preview_audio_url}
                                        previewVideoTaskId={frame.preview_video_task_id}
                                        previewSourceVideoUrl={frame.preview_source_video_url}
                                        previewOffsetMs={frame.preview_offset_ms}
                                        dubGenerationStatus={frame.dub_generation_status}
                                        dubGenerationId={frame.dub_generation_id}
                                        dubError={frame.dub_error}
                                        dubbedVideoTaskId={frame.dubbed_video_task_id}
                                        dubbedVideoUrl={frame.dubbed_video_url}
                                        dubOffsetMs={frame.dub_offset_ms ?? 0}
                                        onPreviewDub={async (videoTaskId: string, offsetMs: number) => {
                                            const result = await api.previewDub(currentProject!.id, frame.id, videoTaskId, offsetMs);
                                            mergeAudioResult(frame.id, result, dubFields);
                                        }}
                                        onApplyDub={async () => {
                                            const result = await api.applyDub(currentProject!.id, frame.id);
                                            mergeAudioResult(frame.id, result, dubFields);
                                        }}
                                        onRevertDub={async () => {
                                            const result = await api.revertDub(currentProject!.id, frame.id);
                                            mergeAudioResult(frame.id, result, dubFields);
                                        }}
                                        onPreviewSfx={async () => {
                                            const result = await api.previewSfx(currentProject!.id, frame.id);
                                            mergeAudioResult(frame.id, result, audioFields);
                                        }}
                                        onApplySfx={async () => {
                                            const result = await api.applySfx(currentProject!.id, frame.id);
                                            mergeAudioResult(frame.id, result, audioFields);
                                        }}
                                        onRevertSfx={async () => {
                                            const result = await api.revertSfx(currentProject!.id, frame.id);
                                            mergeAudioResult(frame.id, result, audioFields);
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
                                        generating={shot.t2iOperation !== "upload" && (shot.t2iStatus === "pending" || shot.t2iStatus === "processing")}
                                        uploading={shot.t2iOperation === "upload" && shot.t2iStatus === "processing"}
                                        operation={shot.t2iOperation}
                                        errorMessage={shot.t2iError}
                                        checking={shot.t2iRecovering}
                                        refreshFailed={taskRefreshError}
                                        refreshing={refreshingTasks}
                                        onRefresh={() => { void refreshProject(); }}
                                        onSelect={(i) => updateT2IWorkbench(shot.id, s => setActiveT2IIndex(s, i))}
                                        onRemove={(i) => updateT2IWorkbench(shot.id, s => removeT2IImage(s, i))}
                                        onGenerate={() => submitFirstFrame(index)}
                                        onUpload={file => submitFirstFrame(index, file)}
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
                                    onDownloadBatch={handleDownloadBatch}
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
            readiness={storyboardReadinessLoading ? null : storyboardReadiness}
            readinessLoading={storyboardReadinessLoading}
            onJumpToScript={() => {
                setGenDialogOpen(false);
                document.dispatchEvent(new CustomEvent("omni_studio:navigateStep", { detail: "script" }));
            }}
        />
        </div>
    );
}
