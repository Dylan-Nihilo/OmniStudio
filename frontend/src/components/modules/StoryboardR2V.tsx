"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { motion } from "framer-motion";
import { Plus, Loader2, Sparkles, PanelBottomOpen, PanelBottomClose } from "lucide-react";
import StepPageHeader, { StepPill } from "@/components/shared/StepPageHeader";
import { useTranslations } from "next-intl";
import { useProjectStore } from "@/store/projectStore";
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
import { Wand2 } from "lucide-react";
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

export default function StoryboardR2V() {
    const currentProject = useProjectStore((state) => state.currentProject);
    const updateProject = useProjectStore((state) => state.updateProject);
    const t = useTranslations("storyboardR2V");
    const tStep = useTranslations("stepHeader");

    // Derive shots from project frames. Workbench state (T2I 抽卡
    // history, last-active tab, batch count) now comes from backend-
    // persisted frame fields (added in commit 9149b06) instead of
    // React-only state, so cross-refresh / cross-device users see the
    // same panel state. migrateShotNode still runs as a defensive
    // belt-and-suspenders for very old localStorage drafts.
    const [shots, setShots] = useState<ShotNode[]>(() => {
        if (currentProject?.frames && currentProject.frames.length > 0) {
            const videoTasks: any[] = (currentProject as any).video_tasks ?? [];
            return currentProject.frames.map((frame: any) => frameToShotNode(frame, videoTasks));
        }
        return [migrateShotNode({ id: `shot_${Date.now()}`, prompt: "", tabMode: "direct_r2v" })];
    });

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

    // Compare-mode selection: a Set of task ids the user shift-clicked
    // in any shot's candidate panel. Multi-shot compare is a future
    // feature; for now the same Set is shared across shots so user
    // can only effectively compare within one shot at a time. Cleared
    // on Compare modal close.
    const [compareSelectedIds, setCompareSelectedIds] = useState<Set<string>>(() => new Set());
    const [compareModalOpen, setCompareModalOpen] = useState(false);

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
        const frames: any[] = currentProject?.frames ?? [];
        for (const f of frames) {
            if (typeof f.workbench_generate_count === "number") {
                out[f.id] = f.workbench_generate_count;
            }
        }
        return out;
    });

    // Issue 16 — per-shot expand state (P plan). Default: all collapsed
    // (browse mode). Set persists per project to localStorage so coming back
    // to the project restores the user's last working layout.
    const expandStorageKey = currentProject ? `storyboard-r2v-expanded-${currentProject.id}` : null;
    const [expandedShots, setExpandedShots] = useState<Set<string>>(() => {
        if (typeof window === "undefined" || !expandStorageKey) return new Set();
        try {
            const raw = window.localStorage.getItem(expandStorageKey);
            if (raw) {
                const arr = JSON.parse(raw);
                if (Array.isArray(arr)) return new Set(arr.filter(x => typeof x === "string"));
            }
        } catch { /* corrupt localStorage value — ignore */ }
        return new Set();
    });
    // Persist on change.
    useEffect(() => {
        if (typeof window === "undefined" || !expandStorageKey) return;
        try {
            window.localStorage.setItem(expandStorageKey, JSON.stringify(Array.from(expandedShots)));
        } catch { /* quota exceeded — ignore */ }
    }, [expandedShots, expandStorageKey]);

    const toggleShotExpanded = useCallback((shotId: string) => {
        setExpandedShots(prev => {
            const next = new Set(prev);
            if (next.has(shotId)) next.delete(shotId);
            else next.add(shotId);
            return next;
        });
    }, []);
    const expandAllShots = useCallback(() => {
        const ids = shots.map(s => s.id);
        // Force every inner section open — overrides each shot's sticky
        // preference. Section keys must match what ParamsSection /
        // CandidatesSection register inside their SectionShells.
        overridePanelSectionState(ids, ["params", "candidates"], true);
        setExpandedShots(new Set(ids));
    }, [shots]);
    const collapseAllShots = useCallback(() => {
        // Don't reset section preferences here — sticky memory should
        // survive a global collapse so re-expanding a shot returns to
        // the user's chosen drawer state.
        setExpandedShots(new Set());
    }, []);

    // Debounced backend writer for workbench state. Coalesces rapid
    // changes (e.g. user clicking through T2I thumbs) into one PATCH
    // per shot per second. Per-shot map ensures one shot's pending
    // write doesn't get overwritten by another's.
    const workbenchPendingRef = useRef<Map<string, {
        timer: number;
        patch: Parameters<typeof api.updateFrameWorkbench>[2];
    }>>(new Map());
    const persistWorkbench = useCallback((
        shotId: string,
        patch: Parameters<typeof api.updateFrameWorkbench>[2],
    ) => {
        if (!currentProject?.id) return;
        // Synthetic shot id (not yet materialized on backend) — skip; the
        // workbench state will be re-applied after createFrame swaps the id.
        if (shotId.startsWith("shot_")) return;
        const projectId = currentProject.id;
        const map = workbenchPendingRef.current;
        const existing = map.get(shotId);
        const merged = { ...(existing?.patch ?? {}), ...patch };
        if (existing) {
            window.clearTimeout(existing.timer);
        }
        const timer = window.setTimeout(() => {
            map.delete(shotId);
            api.updateFrameWorkbench(projectId, shotId, merged)
                .then(() => {
                    // Sync store so other tabs (or remount on tab switch)
                    // see the latest workbench state. Read store live to
                    // avoid stale closure.
                    const proj = useProjectStore.getState().currentProject;
                    if (!proj || proj.id !== projectId) return;
                    const nextFrames = (proj.frames ?? []).map((f: any) =>
                        f.id === shotId ? { ...f, ...merged } : f,
                    );
                    updateProject(projectId, { frames: nextFrames });
                })
                .catch((err) => {
                    debugLog.warn("Studio", "Failed to persist workbench state:", err);
                });
        }, 1000);
        map.set(shotId, { timer, patch: merged });
    }, [currentProject?.id, updateProject]);

    // Prompt edits hit a different endpoint (POST /frames/update with
    // action_description) — debounced separately from workbench so a
    // user typing fast doesn't push 6 PATCH /workbench every keystroke.
    const promptPendingRef = useRef<Map<string, { timer: number; prompt: string }>>(new Map());
    const persistPrompt = useCallback((shotId: string, prompt: string) => {
        if (!currentProject?.id) return;
        if (shotId.startsWith("shot_")) return;
        const projectId = currentProject.id;
        const map = promptPendingRef.current;
        const existing = map.get(shotId);
        if (existing) window.clearTimeout(existing.timer);
        const timer = window.setTimeout(() => {
            map.delete(shotId);
            api.updateFrame(projectId, shotId, { action_description: prompt })
                .then(() => {
                    const proj = useProjectStore.getState().currentProject;
                    if (!proj || proj.id !== projectId) return;
                    const nextFrames = (proj.frames ?? []).map((f: any) =>
                        f.id === shotId ? { ...f, action_description: prompt } : f,
                    );
                    updateProject(projectId, { frames: nextFrames });
                })
                .catch((err) => debugLog.warn("Studio", "persistPrompt failed", err));
        }, 800);
        map.set(shotId, { timer, prompt });
    }, [currentProject?.id, updateProject]);

    // Flush all pending writes on unmount (e.g. user switches step tab)
    // so the last keystroke / param change isn't stranded in the debounce
    // window. All queues (workbench, prompt, field) drain in parallel.
    useEffect(() => {
        const wbMap = workbenchPendingRef.current;
        const pMap = promptPendingRef.current;
        const fMap = fieldPendingRef.current;
        return () => {
            const projectId = currentProject?.id;
            if (!projectId) return;
            for (const [shotId, entry] of Array.from(wbMap.entries())) {
                window.clearTimeout(entry.timer);
                api.updateFrameWorkbench(projectId, shotId, entry.patch).catch(() => {});
            }
            wbMap.clear();
            for (const [shotId, entry] of Array.from(pMap.entries())) {
                window.clearTimeout(entry.timer);
                api.updateFrame(projectId, shotId, { action_description: entry.prompt }).catch(() => {});
            }
            pMap.clear();
            for (const [shotId, entry] of Array.from(fMap.entries())) {
                window.clearTimeout(entry.timer);
                api.updateFrame(projectId, shotId, entry.fields).catch(() => {});
            }
            fMap.clear();
        };
    }, [currentProject?.id]);

    // beforeunload guard: warn when structured field edits are pending
    useEffect(() => {
        const handler = (e: BeforeUnloadEvent) => {
            if (fieldPendingRef.current.size > 0 || promptPendingRef.current.size > 0) {
                e.preventDefault();
            }
        };
        window.addEventListener("beforeunload", handler);
        return () => window.removeEventListener("beforeunload", handler);
    }, []);

    const characters = currentProject?.characters || [];
    const scenes = currentProject?.scenes || [];
    const props = currentProject?.props || [];

    // ────────────────────────────────────────────────────────────────────
    // Shot mutations — Optimistic UI + 异步同步后端 + store 更新
    //   Pattern: 立即改本地 state（无闪烁），后台 fire-and-forget call
    //   到 backend，成功后 swap synthetic id with real id（addShot/duplicate）
    //   并 updateProject(store) 让 currentProject.frames 保持权威。
    //   失败仅 log warn，不回滚（避免 UI 闪烁；用户可重试）。
    //   切 step tab → unmount 时 useEffect cleanup 已经 flush pending
    //   debounce writes，所以打字到一半切走也不丢字。
    // ────────────────────────────────────────────────────────────────────

    // Add a new shot after the given index
    const addShot = useCallback(async (afterIndex: number) => {
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
        // Issue 16 — newly-created shots default to expanded so the user
        // can immediately operate on them. Existing shots keep their state.
        setExpandedShots(prev => {
            const next = new Set(prev);
            next.add(synthId);
            return next;
        });
        if (!currentProject?.id) return;
        try {
            const resp = await crudApi.createFrame(currentProject.id, {
                scene_id: "",
                action_description: "",
                insert_at: afterIndex + 1,
            });
            const frames = Array.isArray(resp?.frames) ? resp.frames : null;
            const realFrame = frames?.[Math.min(afterIndex + 1, frames.length - 1)];
            if (realFrame?.id) {
                setShots(prev => prev.map(s => s.id === synthId ? { ...s, id: realFrame.id } : s));
                setExpandedShots(prev => {
                    if (!prev.has(synthId)) return prev;
                    const next = new Set(prev);
                    next.delete(synthId);
                    next.add(realFrame.id);
                    return next;
                });
            }
            if (frames) updateProject(currentProject.id, { frames });
        } catch (err) {
            debugLog.warn("Studio", "addShot backend persist failed", err);
            toast.error(t("saveFailed"), {
                body: err instanceof Error ? err.message : t("unknownError"),
            });
        }
    }, [currentProject, t, updateProject]);

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
                setShots(updated.frames.map((frame: any) => frameToShotNode(frame, videoTasks, defaultMode)));
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
                    setShots(refreshed.frames.map((frame: any) => frameToShotNode(frame, videoTasks, defaultMode)));
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

    const handleRefineFrame = useCallback(async (frameId: string) => {
        if (!currentProject?.id) return;
        try {
            await api.refineSingleFrame(currentProject.id, frameId);
            const updated = await api.getProject(currentProject.id);
            if (updated?.frames) {
                updateProject(currentProject.id, { frames: updated.frames });
                const defaultMode = currentProject.default_generation_mode === "i2v" ? "t2i_i2v" : "direct_r2v";
                const videoTasks: any[] = (updated as any).video_tasks ?? [];
                setShots(updated.frames.map((frame: any) => frameToShotNode(frame, videoTasks, defaultMode)));
            }
            toast.success(t("refineDoneToast"));
        } catch (err) {
            toast.error(t("refineFailedToast"));
            debugLog.warn("Studio", "single frame refine failed", err);
        }
    }, [currentProject, updateProject]);

    // Delete a shot
    const deleteShot = useCallback(async (index: number) => {
        const target = shots[index];
        if (!target) return;
        setShots(prev => prev.filter((_, i) => i !== index));
        setExpandedShots(prev => {
            if (!prev.has(target.id)) return prev;
            const next = new Set(prev);
            next.delete(target.id);
            return next;
        });
        if (!currentProject?.id) return;
        // Synthetic id never reached backend → nothing to delete remotely.
        if (target.id.startsWith("shot_")) return;
        try {
            const resp = await crudApi.deleteFrame(currentProject.id, target.id);
            const frames = Array.isArray(resp?.frames) ? resp.frames : null;
            if (frames) updateProject(currentProject.id, { frames });
        } catch (err) {
            debugLog.warn("Studio", "deleteShot backend persist failed", err);
        }
    }, [shots, currentProject, updateProject]);

    // Move shot up/down
    const moveShot = useCallback(async (index: number, direction: "up" | "down") => {
        const targetIndex = direction === "up" ? index - 1 : index + 1;
        if (targetIndex < 0 || targetIndex >= shots.length) return;
        const updated = [...shots];
        [updated[index], updated[targetIndex]] = [updated[targetIndex], updated[index]];
        setShots(updated);
        if (!currentProject?.id) return;
        const ids = updated.map(s => s.id);
        // Reorder requires every id to be backed on backend — if any
        // are still synthetic (createFrame in-flight), defer; the next
        // move after createFrame settles will reconcile.
        if (ids.some(id => id.startsWith("shot_"))) return;
        try {
            const resp = await crudApi.reorderFrames(currentProject.id, ids);
            const frames = Array.isArray(resp?.frames) ? resp.frames : null;
            if (frames) updateProject(currentProject.id, { frames });
        } catch (err) {
            debugLog.warn("Studio", "moveShot backend persist failed", err);
        }
    }, [shots, currentProject, updateProject]);

    // Duplicate a shot
    const duplicateShot = useCallback(async (index: number) => {
        const source = shots[index];
        if (!source) return;
        const synthId = `shot_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const newShot: ShotNode = {
            ...source,
            id: synthId,
            // Generated artifacts don't carry over; user duplicates
            // the *intent* of the shot, not the output.
            videoUrl: undefined,
            videoTaskId: undefined,
            videoStatus: undefined,
            t2iImageUrl: undefined,
            t2iTaskId: undefined,
            t2iStatus: undefined,
        };
        setShots(prev => {
            const updated = [...prev];
            updated.splice(index + 1, 0, newShot);
            return updated;
        });
        setExpandedShots(prev => {
            const next = new Set(prev);
            next.add(synthId);
            return next;
        });
        if (!currentProject?.id) return;
        // Source itself isn't on backend yet — best-effort: skip remote
        // copy, the next workbench/prompt write will materialize it.
        if (source.id.startsWith("shot_")) return;
        try {
            const resp = await crudApi.copyFrame(currentProject.id, source.id, index + 1);
            const frames = Array.isArray(resp?.frames) ? resp.frames : null;
            const realFrame = frames?.[index + 1];
            if (realFrame?.id) {
                setShots(prev => prev.map(s => s.id === synthId ? { ...s, id: realFrame.id } : s));
                setExpandedShots(prev => {
                    if (!prev.has(synthId)) return prev;
                    const next = new Set(prev);
                    next.delete(synthId);
                    next.add(realFrame.id);
                    return next;
                });
            }
            if (frames) updateProject(currentProject.id, { frames });
        } catch (err) {
            debugLog.warn("Studio", "duplicateShot backend persist failed", err);
        }
    }, [shots, currentProject, updateProject]);

    // Update shot prompt — local immediate + debounced backend write
    const updatePrompt = useCallback((index: number, prompt: string) => {
        setShots(prev => prev.map((s, i) => {
            if (i !== index) return s;
            persistPrompt(s.id, prompt);
            return { ...s, prompt };
        }));
    }, [persistPrompt]);

    // Set shot tab mode + persist so the user's last-active tab
    // survives refresh.
    const setTabMode = useCallback((index: number, mode: "t2i_i2v" | "direct_r2v") => {
        setShots(prev => prev.map((s, i) => {
            if (i !== index) return s;
            persistWorkbench(s.id, { workbench_tab_mode: mode });
            return { ...s, tabMode: mode };
        }));
    }, [persistWorkbench]);

    // Structured field updates — local immediate + debounce 3s auto-save
    const fieldPendingRef = useRef<Map<string, { timer: number; fields: Record<string, any> }>>(new Map());
    const handleUpdateField = useCallback((index: number, field: string, value: string | number | null) => {
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
        // Debounce 3s persist to backend
        const shotId = shots[index]?.id;
        if (!shotId || shotId.startsWith("shot_") || !currentProject?.id) return;
        const projectId = currentProject.id;
        const map = fieldPendingRef.current;
        const existing = map.get(shotId);
        if (existing) window.clearTimeout(existing.timer);
        const backendField: Record<string, any> = {};
        if (field === "duration") backendField.duration = typeof value === "number" ? value : undefined;
        if (field === "shotSize") backendField.shot_size = typeof value === "string" ? value : undefined;
        if (field === "cameraAngle") backendField.camera_angle = typeof value === "string" ? value : undefined;
        if (field === "cameraMovement") backendField.camera_movement_description = typeof value === "string" ? value : undefined;
        if (field === "transitionHint") backendField.transition_hint = typeof value === "string" ? value : undefined;
        const merged = { ...(existing?.fields ?? {}), ...backendField };
        const timer = window.setTimeout(() => {
            map.delete(shotId);
            api.updateFrame(projectId, shotId, merged)
                .then(() => {
                    const proj = useProjectStore.getState().currentProject;
                    if (!proj || proj.id !== projectId) return;
                    const nextFrames = (proj.frames ?? []).map((f: any) =>
                        f.id === shotId ? { ...f, ...merged } : f,
                    );
                    updateProject(projectId, { frames: nextFrames });
                })
                .catch((err) => {
                    debugLog.warn("Studio", "persistField failed", err);
                    toast.error(t("saveFailed"), {
                        body: err instanceof Error ? err.message : t("unknownError"),
                    });
                });
        }, 3000);
        map.set(shotId, { timer, fields: merged });
    }, [shots, currentProject?.id, t, updateProject]);

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

    const materializeShot = useCallback(async (shot: ShotNode, index: number): Promise<string> => {
        if (!shot.id.startsWith("shot_")) return shot.id;
        if (!currentProject?.id) throw new Error("No current project");

        const projectId = currentProject.id;
        const created = await crudApi.createFrame(projectId, {
            scene_id: "",
            action_description: shot.prompt || "",
            insert_at: index,
        });
        const frames = Array.isArray(created?.frames) ? created.frames : [];
        const newFrame = frames[Math.min(index, frames.length - 1)];
        if (!newFrame?.id) throw new Error("Frame creation returned no persisted frame");

        setShots(prev => prev.map((candidate, candidateIndex) =>
            candidateIndex === index ? { ...candidate, id: newFrame.id } : candidate,
        ));
        setExpandedShots(prev => {
            if (!prev.has(shot.id)) return prev;
            const next = new Set(prev);
            next.delete(shot.id);
            next.add(newFrame.id);
            return next;
        });
        updateProject(projectId, { frames });
        return newFrame.id;
    }, [currentProject?.id, updateProject]);

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
                setShots(prev => prev.map((s, i) => {
                    if (i !== index) return s;
                    const updated = appendT2IImage({ ...s, t2iStatus: "completed" }, imageUrl);
                    persistWorkbench(s.id, {
                        t2i_image_urls: updated.t2iImageUrls ?? [],
                        t2i_selected_index: updated.t2iSelectedIndex ?? 0,
                    });
                    return updated;
                }));
            }
        } catch (error) {
            debugLog.error("Studio", "Failed to generate T2I for shot:", error);
            setShots(prev => prev.map((s, i) =>
                i === index ? { ...s, t2iStatus: "failed" } : s
            ));
        }
    }, [shots, currentProject, materializeShot, persistWorkbench]);

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

    // Project-level task refresh: when any task on any shot is in
    // flight, refetch the whole project every 5s. The candidates
    // panel + queue read from currentProject.video_tasks for canonical
    // state. Cheap because it's just a GET; cancels when nothing is
    // in flight. This is independent of the per-shot poll above (the
    // per-shot poll updates shot.videoStatus / videoUrl which drives
    // the ShotCard preview; the project refresh fills in candidate
    // metadata like is_starred / label / error / final video_url).
    useEffect(() => {
        if (!currentProject?.id) return;
        const allTasks: any[] = (currentProject as any).video_tasks ?? [];
        const anyInFlight = allTasks.some(
            (t) => t.status === "pending" || t.status === "processing",
        );
        // Also poll if any shot's locally-tracked videoTaskId is not
        // yet reflected in the project record (closes the just-created
        // window). With the Phase-2 derive-from-tasks model, we only
        // care about the legacy single-id mirror on the shot.
        const localInFlight = shots.some((s) => {
            const id = s.videoTaskId;
            if (!id) return false;
            const t = allTasks.find((tt) => tt.id === id);
            return !t || t.status === "pending" || t.status === "processing";
        });
        if (!anyInFlight && !localInFlight) return;
        const projectId = currentProject.id;
        const id = window.setInterval(async () => {
            try {
                const fresh = await api.getProject(projectId);
                updateProject(projectId, fresh);
            } catch {
                /* swallow — network blips are fine, next tick retries */
            }
        }, 5000);
        return () => window.clearInterval(id);
    }, [currentProject?.id, (currentProject as any)?.video_tasks, shots, updateProject]);

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
                                setShots(prev => prev.map(s => {
                                    if (s.id !== shot.id) return s;
                                    const updated = appendT2IImage({ ...s, t2iStatus: "completed" }, imageUrl);
                                    persistWorkbench(s.id, {
                                        t2i_image_urls: updated.t2iImageUrls ?? [],
                                        t2i_selected_index: updated.t2iSelectedIndex ?? 0,
                                    });
                                    return updated;
                                }));
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
    }, [shots, persistWorkbench]);

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

    const tasksById = useMemo(() => {
        const map = new Map<string, VideoTask>();
        for (const t of allVideoTasks) map.set(t.id, t);
        return map;
    }, [allVideoTasks]);

    // Map shot.id → human label for the queue panel's frame column.
    const shotLabelByFrameId = useMemo(() => {
        const out: Record<string, string> = {};
        shots.forEach((s, i) => { out[s.id] = `Shot ${i + 1}`; });
        return out;
    }, [shots]);

    // In-flight aggregate count drives the TaskQueueButton badge.
    const inFlightTaskCount = useMemo(
        () => allVideoTasks.filter(t => t.status === "pending" || t.status === "processing").length,
        [allVideoTasks],
    );

    // Sync shot.videoStatus from project.video_tasks when the
    // project-level poll refreshes. Video task status is only visible
    // via project refresh (GET /tasks/ only covers asset tasks).
    useEffect(() => {
        if (!allVideoTasks.length) return;
        const autoSelectFrameIds: string[] = [];
        setShots(prev => {
            let changed = false;
            const next = prev.map(s => {
                if (!s.videoTaskId) return s;
                const task = allVideoTasks.find(t => t.id === s.videoTaskId);
                if (!task) return s;
                if (task.status === "completed" && s.videoStatus !== "completed") {
                    changed = true;
                    autoSelectFrameIds.push(s.id);
                    return { ...s, videoStatus: "completed" as const, videoUrl: (task as any).video_url };
                }
                if (task.status === "failed" && s.videoStatus !== "failed") {
                    changed = true;
                    return { ...s, videoStatus: "failed" as const };
                }
                return s;
            });
            return changed ? next : prev;
        });
        // Persist newly-completed videos as the frame's active take so the
        // hero survives reload / refine / cross-device opens. Backend skips
        // pinned frames; failures here are non-fatal (UI already updated).
        const projectId = currentProject?.id;
        if (projectId && autoSelectFrameIds.length > 0) {
            Promise.all(
                autoSelectFrameIds.map(frameId =>
                    api.autoSelectLatestVideo(projectId, frameId).catch(err => {
                        debugLog.warn("Studio", "autoSelectLatestVideo failed for frame:", frameId, err);
                        return null;
                    })
                )
            ).then(results => {
                // Use the last successful response's frames (all calls
                // converge on the same script state — last write wins).
                const last = results.filter(Boolean).pop() as any;
                if (last?.frames) {
                    updateProject(projectId, { frames: last.frames });
                    // Sync the hero on every auto-selected frame: backend may
                    // have picked a sibling take in the same batch, so the
                    // optimistic videoUrl set above could be stale by a hop.
                    setShots(prev => prev.map(s => {
                        if (!autoSelectFrameIds.includes(s.id)) return s;
                        const refreshed = last.frames.find((f: any) => f.id === s.id);
                        if (!refreshed?.video_url) return s;
                        return { ...s, videoUrl: refreshed.video_url, isVideoPinned: Boolean(refreshed.is_video_pinned) };
                    }));
                }
            });
        }
    }, [allVideoTasks, currentProject?.id, updateProject]);

    // Compare modal needs the actual VideoTask objects for the
    // currently-selected ids (in whatever order they were selected).
    const compareTasks = useMemo(() => {
        const out: VideoTask[] = [];
        Array.from(compareSelectedIds).forEach((id) => {
            const t = tasksById.get(id);
            if (t) out.push(t);
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
    }, [persistWorkbench, shotCounts]);

    // Annotate handlers wire CandidateThumb's star/label CTAs to the
    // backend PATCH endpoint. We refresh the project after each call
    // so the candidate cell re-renders with the new flag without
    // waiting for the 5s polling tick.
    const refreshProject = useCallback(async () => {
        if (!currentProject?.id) return;
        try {
            const fresh = await api.getProject(currentProject.id);
            updateProject(currentProject.id, fresh);
        } catch { /* swallow */ }
    }, [currentProject?.id, updateProject]);

    const handleToggleStar = useCallback(async (task: VideoTask, next: boolean) => {
        if (!currentProject?.id) return;
        try {
            await api.annotateVideoTask(currentProject.id, task.id, { is_starred: next });
            await refreshProject();
        } catch (err) {
            debugLog.error("Studio", "Failed to toggle star:", err);
        }
    }, [currentProject?.id, refreshProject]);

    // Manual pin: user explicitly chose this take as the frame's active
    // video. Backend sets is_video_pinned=true so subsequent auto-selects
    // (polling completion) skip this frame. Locally we update the shot's
    // videoUrl + videoStatus immediately so the hero swaps without waiting
    // for the project refresh round-trip.
    const handleSetActive = useCallback(async (frameId: string, task: VideoTask) => {
        if (!currentProject?.id) return;
        const taskVideoUrl = (task as any).video_url as string | undefined;
        setShots(prev => prev.map(s =>
            s.id === frameId
                ? { ...s, videoUrl: taskVideoUrl, videoStatus: "completed" as const, isVideoPinned: true }
                : s
        ));
        try {
            const updated = await api.selectVideo(currentProject.id, frameId, task.id);
            updateProject(currentProject.id, { frames: updated.frames });
        } catch (err) {
            debugLog.error("Studio", "Failed to set active take:", err);
        }
    }, [currentProject?.id, updateProject]);

    // Unpin: clear the manual pin so auto-select resumes on next
    // completion. Selected_video_id / video_url stay put — user keeps
    // seeing the current take until a newer one arrives.
    const handleUnpinVideo = useCallback(async (frameId: string) => {
        if (!currentProject?.id) return;
        setShots(prev => prev.map(s =>
            s.id === frameId ? { ...s, isVideoPinned: false } : s
        ));
        try {
            const updated = await api.unpinVideo(currentProject.id, frameId);
            updateProject(currentProject.id, { frames: updated.frames });
        } catch (err) {
            debugLog.error("Studio", "Failed to unpin video:", err);
        }
    }, [currentProject?.id, updateProject]);

    const handleSetLabel = useCallback(async (task: VideoTask, next: string | null) => {
        if (!currentProject?.id) return;
        try {
            if (next === null || next === "") {
                await api.annotateVideoTask(currentProject.id, task.id, { clear_label: true });
            } else {
                await api.annotateVideoTask(currentProject.id, task.id, { label: next });
            }
            await refreshProject();
        } catch (err) {
            debugLog.error("Studio", "Failed to set label:", err);
        }
    }, [currentProject?.id, refreshProject]);

    const handleCancelTask = useCallback(async (task: VideoTask) => {
        if (!currentProject?.id) return;
        try {
            await api.cancelVideoTask(currentProject.id, task.id);
            await refreshProject();
        } catch (err) {
            debugLog.error("Studio", "Failed to cancel task:", err);
        }
    }, [currentProject?.id, refreshProject]);

    // Retry = fire a fresh batch of 1 for the shot owning this task,
    // reusing the task's params as best-effort. After Phase 2 the
    // task→shot mapping is direct via task.frame_id; falls back to
    // current ParamsSection state if we can't find the owner.
    const handleRetryTask = useCallback(async (task: VideoTask) => {
        const ownerIdx = task.frame_id
            ? shots.findIndex((s) => s.id === task.frame_id)
            : -1;
        if (ownerIdx < 0) return;
        await generateVideoBatch(ownerIdx, 1);
    }, [shots, generateVideoBatch]);

    // Click on a candidate thumb: plain click = preview (open new
    // window for v1), shift-click = toggle compare-selection.
    const handleCandidateClick = useCallback((task: VideoTask, mods: { shift: boolean; meta: boolean }) => {
        if (mods.shift) {
            setCompareSelectedIds(prev => {
                const next = new Set(prev);
                if (next.has(task.id)) next.delete(task.id);
                else next.add(task.id);
                return next;
            });
            return;
        }
        const frame = currentProject?.frames?.find((f: any) => f.dubbed_video_task_id === task.id);
        const url = frame?.dubbed_video_url || task.video_url;
        if (url) {
            window.open(getAssetUrl(url), "_blank", "noopener");
        }
    }, [currentProject]);

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

    // Queue's jump-to-shot: scroll the shot's wrapper into view AND
    // expand the shot panel + its sections (otherwise jumping to a
    // collapsed shot lands the user on a 1-line strip and they have
    // to expand manually).
    const handleJumpToShot = useCallback((frameId: string) => {
        setExpandedShots(prev => {
            if (prev.has(frameId)) return prev;
            const next = new Set(prev);
            next.add(frameId);
            return next;
        });
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
        // Layout v4: outer horizontal split. Custom page header belongs
        // to main column (not page-wide), so the right TaskQueuePanel can
        // be a true floor-to-ceiling sidebar with its own SidePanelHeader.
        <div className="h-full flex overflow-hidden relative">
        {/* Main column — pushed (compressed) when the queue panel opens
            so the queue doesn't overlay content. Bloom/grain now global in
            ProjectClient so the whole pipeline shares one atmosphere. */}
        <div className="relative z-10 flex-1 flex flex-col overflow-hidden min-w-0">
            {/* Unified page header (shared StepPageHeader) */}
            <StepPageHeader
                stepNumber={4}
                englishName="STORYBOARD R2V"
                title={tStep("storyboardTitle")}
                subtitle={tStep("storyboardSubtitle")}
                pills={(
                    <>
                        {currentProject?.art_direction?.style_config?.name ? (
                            <StepPill label={t("artStyleLabel")} value={currentProject.art_direction.style_config.name} />
                        ) : null}
                        <StepPill label={t("currentModel")} value={currentModelName} />
                    </>
                )}
                trailing={(
                    <>
                        <TaskQueueButton
                            inFlightCount={inFlightTaskCount}
                            open={queueOpen}
                            onToggle={() => setQueueOpen(v => !v)}
                        />
                        <button
                            type="button"
                            onClick={() => setGenDialogOpen(true)}
                            disabled={generating}
                            className="inline-flex h-8 items-center gap-1.5 rounded-full bg-primary px-4 py-1.5 font-sans text-[0.8125rem] font-semibold text-on-accent shadow-[var(--btn-pri-glow),inset_0_1.5px_0_rgba(255,255,255,0.14)] transition-all duration-fast ease-out-quart hover:bg-primary-hover disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/55"
                        >
                            {generating ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
                            <span>{generating ? t("genInFlight") : t("genShots")}</span>
                        </button>
                    </>
                )}
            />
            {/* Top Toolbar — mock-aligned: count on the left, expand/collapse pills on the right */}
            <div className="flex flex-wrap items-center gap-3 px-4 py-3 shrink-0 sm:px-6">
                <div className="flex items-center gap-3">
                    <span className="font-mono text-[11px] tracking-[0.04em] text-text-secondary">
                        <span className="text-foreground font-medium">{shots.length}</span>
                        <span className="ml-1.5 uppercase">{shots.length === 1 ? t("shot") : t("shots")}</span>
                        {totalInFlight > 0 ? <span className="ml-2 text-status-processing-fg">· {totalInFlight} {t("inFlightShort")}</span> : null}
                    </span>
                    <motion.button
                        whileHover={{ scale: 1.04 }}
                        whileTap={{ scale: 0.96 }}
                        onClick={() => addShot(shots.length - 1)}
                        className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-primary hover:text-primary/80 transition-colors"
                    >
                        <Plus size={13} strokeWidth={2} />
                        {t("addShot")}
                    </motion.button>
                </div>
                {shots.length > 1 ? (
                    <div className="ml-auto flex items-center gap-2">
                        <button
                            type="button"
                            onClick={expandAllShots}
                            title={t("expandAll")}
                            className="inline-flex h-8 items-center gap-1.5 rounded-full border border-glass-border bg-transparent px-3.5 font-mono text-[13px] uppercase tracking-[0.06em] text-text-secondary transition-colors duration-fast ease-out-quart hover:bg-hover-bg hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/55"
                        >
                            <PanelBottomOpen size={12} strokeWidth={1.8} />
                            {t("expandAll")}
                        </button>
                        <button
                            type="button"
                            onClick={collapseAllShots}
                            title={t("collapseAll")}
                            className="inline-flex h-8 items-center gap-1.5 rounded-full border border-glass-border bg-transparent px-3.5 font-mono text-[13px] uppercase tracking-[0.06em] text-text-secondary transition-colors duration-fast ease-out-quart hover:bg-hover-bg hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/55"
                        >
                            <PanelBottomClose size={12} strokeWidth={1.8} />
                            {t("collapseAll")}
                        </button>
                    </div>
                ) : null}
            </div>

            <GenerationBanner
                state={bannerState}
                phase1Captions={PHASE1_CAPTIONS}
                refineProgress={refineProgress}
                dialogueProgress={dialogueProgress}
                summary={bannerSummary}
                onGenerateDialogue={handleBatchDialogue}
            />

            <div className="flex-1 overflow-y-auto px-5 pt-1.5 pb-10 space-y-5 sm:px-7">
                {shots.length === 0 && (
                    <div className="h-full min-h-[300px] flex flex-col items-center justify-center text-center px-6">
                        <div className="rounded-2xl border border-glass-border bg-glass p-8 max-w-lg">
                            <div className="mx-auto w-12 h-12 grid place-items-center rounded-full bg-primary/10 border border-primary/30 mb-4">
                                <Wand2 size={20} className="text-primary" />
                            </div>
                            <h3 className="text-display font-medium text-foreground">{t("emptyTitle")}</h3>
                            <p className="text-body-sm text-text-secondary mt-1.5 max-w-md mx-auto leading-relaxed">
                                {t("emptyBody")}
                            </p>
                            <div className="mt-5 flex items-center justify-center gap-2">
                                <button
                                    type="button"
                                    onClick={() => setGenDialogOpen(true)}
                                    disabled={generating}
                                    className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-md bg-primary text-white border border-primary/65 shadow-[inset_0_1.5px_0_rgba(255,255,255,0.14)] hover:bg-primary-hover disabled:opacity-40 transition-colors text-[0.8125rem] font-semibold"
                                >
                                    {generating ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />}
                                    {generating ? t("genInFlight") : t("emptyCTA")}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => addShot(-1)}
                                    className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-md bg-glass border border-glass-border text-text-secondary hover:text-foreground hover:bg-hover-bg transition-colors text-[0.75rem]"
                                >
                                    <Plus size={12} />
                                    {t("emptyManualAdd")}
                                </button>
                            </div>
                        </div>
                    </div>
                )}
                {shots.map((shot, index) => {
                    const shotTasks = tasksForShot(shot);
                    const shotInFlight = shotTasks.filter(
                        (t) => t.status === "pending" || t.status === "processing",
                    ).length;
                    const paramsState = paramsStateForShot(shot);
                    const isI2vTab = shot.tabMode === "t2i_i2v";
                    const modelList = shot.tabMode === "direct_r2v" ? VIDEO_R2V_MODELS : VIDEO_I2V_MODELS;
                    return (
                    /* Plain div (was motion.div) — staggered enter
                       animation re-fired every time the user switched
                       step tabs and came back, causing a noticeable
                       全 list opacity flicker. ShotCard hover micro-
                       motion is kept inside the card itself. */
                    <div
                        key={shot.id}
                        ref={(el) => { shotWrapperRefs.current.set(shot.id, el); }}
                    >
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
                            onCancelVideo={
                                shot.videoTaskId && currentProject
                                    ? async () => {
                                        const projectId = currentProject.id;
                                        const taskId = shot.videoTaskId!;
                                        try {
                                            await api.cancelVideoTask(projectId, taskId);
                                        } finally {
                                            // Optimistic local flip — backend has
                                            // already marked failed, but the next
                                            // refetch may take a beat. Failed state
                                            // surfaces the existing Retry button.
                                            setShots(prev => prev.map((s, i) =>
                                                i === index ? { ...s, videoStatus: "failed" as const } : s,
                                            ));
                                        }
                                    }
                                    : undefined
                            }
                            expanded={expandedShots.has(shot.id)}
                            onToggleExpanded={() => toggleShotExpanded(shot.id)}
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
                            onUnpinVideo={() => handleUnpinVideo(shot.id)}
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
                        />
                        {/* PR-3j · Frame-level dialogue audio row. Only renders
                            when the frame has dialogue text; resolves the
                            bound character's voice_id and tracks stale state. */}
                        {(() => {
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
                                    <DialogueAudioRow
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
                        {/* Attached workbench: t2i_i2v 模式下渲染顺序为
                            Step 1 (T2ISubsection) → Step 2 (ParamsSection)
                            → CandidatesSection；direct_r2v 模式无 T2I 区，
                            ParamsSection → CandidatesSection。
                            Spec: docs/design/r2v-workflow-v3-unified.md §4.3.2
                            (PR-3a · Option A 最小修复)
                            v1 不加 explicit section header / first-frame
                            thumbnail in Step 2 — 看用户反馈再升级 v2. */}
                        {expandedShots.has(shot.id) ? (
                        <div className="mx-5 mb-[18px] motion-safe:animate-[shotPanelIn_220ms_cubic-bezier(0.22,1,0.36,1)_both]">
                            {isI2vTab ? (
                                <div>
                                    <T2ISubsection
                                        imageUrls={shot.t2iImageUrls ?? []}
                                        selectedIndex={shot.t2iSelectedIndex ?? 0}
                                        storyboardFrameUrl={shot.imageUrl || undefined}
                                        promptIsEmpty={!shot.prompt.trim()}
                                        generating={shot.t2iStatus === "pending" || shot.t2iStatus === "processing"}
                                        inFlightTaskId={shot.t2iTaskId}
                                        inFlightStatus={shot.t2iStatus}
                                        onSelect={(i) => setShots(prev => prev.map((s, j) => {
                                            if (j !== index) return s;
                                            const next = setActiveT2IIndex(s, i);
                                            persistWorkbench(s.id, {
                                                t2i_selected_index: next.t2iSelectedIndex ?? 0,
                                            });
                                            return next;
                                        }))}
                                        onRemove={(i) => setShots(prev => prev.map((s, j) => {
                                            if (j !== index) return s;
                                            const next = removeT2IImage(s, i);
                                            persistWorkbench(s.id, {
                                                t2i_image_urls: next.t2iImageUrls ?? [],
                                                t2i_selected_index: next.t2iSelectedIndex ?? 0,
                                            });
                                            return next;
                                        }))}
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
                                <ParamsSection
                                    shotId={shot.id}
                                    modelList={modelList}
                                    title={isI2vTab ? "I2V Params" : "R2V Params"}
                                    params={paramsState}
                                    onChange={(next) => handleShotParamsChange(shot, next)}
                                    inFlightCount={shotInFlight}
                                    errorMessage={shotErrors[shot.id] ?? null}
                                />
                            </div>
                            <div className="border-t border-glass-border">
                                <CandidatesSection
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
                                    onCancel={handleCancelTask}
                                    onRetry={handleRetryTask}
                                    onReuseBatchParams={handleReuseBatchParams}
                                    onOpenCompare={() => setCompareModalOpen(true)}
                                    resolveUrl={resolveAssetUrl}
                                />
                            </div>
                        </div>
                        ) : null}
                    </div>
                    );
                })}

                {/* Add shot at end */}
                <motion.button
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: Math.min(shots.length * 0.03, 0.3) }}
                    whileHover={{ scale: 1.005 }}
                    whileTap={{ scale: 0.995 }}
                    onClick={() => addShot(shots.length - 1)}
                    className="w-full py-3.5 border border-dashed border-glass-border hover:border-primary/40 rounded-xl text-text-secondary hover:text-primary text-sm font-medium transition-all duration-300 flex items-center justify-center gap-2 bg-glass hover:bg-hover-bg"
                >
                    <Plus size={16} strokeWidth={1.5} />
                    {t("addShot")}
                </motion.button>
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
            shotLabelByFrameId={shotLabelByFrameId}
            onJumpToShot={handleJumpToShot}
            onCancel={handleCancelTask}
            onRetry={handleRetryTask}
        />
        {/* Compare modal — portaled to body to escape clipped/transformed
            ancestors. Shows once user has shift-selected ≥2 and clicked
            the floating Compare button in any CandidatesSection. */}
        {compareModalOpen && compareTasks.length >= 2 ? (
            <CompareModal
                tasks={compareTasks}
                onClose={() => setCompareModalOpen(false)}
                resolveUrl={resolveAssetUrl}
            />
        ) : null}
        {/* LLM-generate frames dialog */}
        <StoryboardGenerateDialog
            isOpen={genDialogOpen}
            onClose={() => setGenDialogOpen(false)}
            project={currentProject as any}
            existingShotCount={shots.length}
            onConfirm={handleSmartGenerate}
            onJumpToScript={() => {
                setGenDialogOpen(false);
                window.dispatchEvent(new CustomEvent("navigateStep", { detail: "script" }));
            }}
        />
        </div>
    );
}
