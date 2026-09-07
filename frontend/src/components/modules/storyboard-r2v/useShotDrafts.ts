import { useCallback, useEffect } from 'react';
import { create } from 'zustand';
import { api, crudApi } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import { useProjectStore } from '@/store/projectStore';
import type { ShotNode } from './ShotCard';

type Fields = Parameters<typeof api.updateFrame>[2];
type Workbench = Parameters<typeof api.updateFrameWorkbench>[2];
type Draft = { scope: string; projectId: string; shotId: string; fields: Fields; workbench: Workbench };
const STORAGE_KEY = 'omni-studio.shot-drafts.v1';
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const requests = new Map<string, Promise<void>>();
const creations = new Map<string, Promise<string>>();
const refinements = new Map<string, Promise<boolean>>();
const authScope = () => {
    const { user, activeWorkspace } = useAuthStore.getState();
    return JSON.stringify([user?.id ?? null, activeWorkspace?.id ?? null]);
};
const draftKey = (scope: string, projectId: string, shotId: string) => JSON.stringify([scope, projectId, shotId]);
const refinementFields = ['visual_description', 'shot_size', 'camera_angle', 'duration', 'transition_hint', 'camera_movement_structured', 'blocking', 'dialogue_structured', 'dialogue', 'speaker', 'dialogue_instructions', 'audio_note', 'lighting', 'assembled_prompt', 'updated_at'] as const;

export function mergeRefinementFields(current: any, saved: any, before: any) {
    return { ...current, ...Object.fromEntries(refinementFields
        .filter(field => field in saved && current[field] === before?.[field])
        .map(field => [field, saved[field]])) };
}

function readDrafts(): Record<string, Draft> {
    try {
        const value = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '{}');
        if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
        return Object.fromEntries(Object.entries(value).filter(([key, item]) => {
            const draft = item as Draft;
            return draft && typeof draft.scope === 'string' && typeof draft.projectId === 'string'
                && typeof draft.shotId === 'string' && draft.fields && draft.workbench
                && key === draftKey(draft.scope, draft.projectId, draft.shotId);
        })) as Record<string, Draft>;
    } catch { return {}; }
}

// Drafts outlive the panel; sessionStorage also preserves them across reloads in this tab.
export const useShotDraftStore = create<{
    drafts: Record<string, Draft>;
    errors: Record<string, boolean>;
    saving: Record<string, boolean>;
    storageUnavailable: boolean;
    materializedIds: Record<string, string>;
    refining: Record<string, boolean>;
    batchRefining: Record<string, boolean>;
    refinedVersions: Record<string, number>;
}>(() => ({ drafts: readDrafts(), errors: {}, saving: {}, storageUnavailable: false, materializedIds: {}, refining: {}, batchRefining: {}, refinedVersions: {} }));

useShotDraftStore.subscribe((state, previous) => {
    if (state.drafts === previous.drafts) return;
    try {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state.drafts));
        if (state.storageUnavailable) useShotDraftStore.setState({ storageUnavailable: false });
    } catch {
        if (!state.storageUnavailable) useShotDraftStore.setState({ storageUnavailable: true });
    }
});

// Keep the tab-close guard when the user leaves Studio for another module.
if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', event => {
        if (Object.values(useShotDraftStore.getState().drafts).some(draft => draft.scope === authScope())) {
            event.preventDefault();
            event.returnValue = '';
        }
    });
}

function mergeFrameFields(frame: any, patch: Fields & Workbench) {
    return {
        ...frame, ...patch,
        ...(patch.dialogue !== undefined && frame.dialogue_structured ? { dialogue_structured: { ...frame.dialogue_structured, line: patch.dialogue } } : {}),
        ...(patch.camera_movement_description !== undefined ? {
            camera_movement_structured: {
                ...frame.camera_movement_structured,
                primary: patch.camera_movement_description,
                description: patch.camera_movement_description,
            },
        } : {}),
    };
}

function acknowledge(key: string, channel: 'fields' | 'workbench', sent: Fields | Workbench) {
    useShotDraftStore.setState(state => {
        const draft = state.drafts[key];
        if (!draft) return state;
        // A response can acknowledge only the values it sent, never newer edits.
        const remaining = Object.fromEntries(Object.entries(draft[channel]).filter(([name, value]) =>
            !Object.is(value, (sent as Record<string, unknown>)[name]),
        ));
        const next = { ...draft, [channel]: remaining };
        const drafts = { ...state.drafts, [key]: next };
        if (!Object.keys(next.fields).length && !Object.keys(next.workbench).length) delete drafts[key];
        return { drafts };
    });
}

async function saveShot(key: string): Promise<void> {
    clearTimeout(timers.get(key));
    timers.delete(key);
    if (useShotDraftStore.getState().refining[key] || useShotDraftStore.getState().batchRefining[key]) return;
    const running = requests.get(key);
    if (running) return running;
    const request = (async () => {
        useShotDraftStore.setState(state => ({ saving: { ...state.saving, [key]: true }, errors: { ...state.errors, [key]: false } }));
        try {
            let draft: Draft | undefined;
            while ((draft = useShotDraftStore.getState().drafts[key])) {
                // A queued request must never borrow another workspace's credentials/header.
                if (draft.scope !== authScope() || draft.shotId.startsWith('shot_')) break;
                for (const channel of ['fields', 'workbench'] as const) {
                    const patch = draft[channel];
                    if (!Object.keys(patch).length) continue;
                    if (draft.scope !== authScope()) return;
                    if (channel === 'fields') await api.updateFrame(draft.projectId, draft.shotId, draft.fields);
                    else await api.updateFrameWorkbench(draft.projectId, draft.shotId, draft.workbench);
                    acknowledge(key, channel, patch);
                    const project = useProjectStore.getState().currentProject;
                    if (draft.scope === authScope() && project?.id === draft.projectId) {
                        useProjectStore.getState().updateProject(project.id, {
                            frames: project.frames.map(frame => frame.id === draft!.shotId
                                ? mergeFrameFields(frame, patch) : frame),
                        });
                    }
                }
            }
        } catch {
            useShotDraftStore.setState(state => ({ errors: { ...state.errors, [key]: true } }));
        } finally {
            useShotDraftStore.setState(state => ({ saving: { ...state.saving, [key]: false } }));
        }
    })();
    requests.set(key, request);
    await request;
    requests.delete(key);
}

export function useShotDrafts(projectId: string | undefined) {
    const userId = useAuthStore(state => state.user?.id);
    const workspaceId = useAuthStore(state => state.activeWorkspace?.id);
    const scope = JSON.stringify([userId ?? null, workspaceId ?? null]);
    const state = useShotDraftStore();
    const keys = Object.keys(state.drafts).filter(key => {
        const draft = state.drafts[key];
        return draft.scope === scope && draft.projectId === projectId;
    });
    const hasError = keys.some(key => state.errors[key]);
    const saving = keys.some(key => state.saving[key]);
    const queue = useCallback((shotId: string, channel: 'fields' | 'workbench', patch: Fields | Workbench, delay: number) => {
        if (!projectId) return;
        shotId = useShotDraftStore.getState().materializedIds[draftKey(scope, projectId, shotId)] ?? shotId;
        const key = draftKey(scope, projectId, shotId);
        useShotDraftStore.setState(state => {
            const draft = state.drafts[key] ?? { scope, projectId, shotId, fields: {}, workbench: {} };
            return { drafts: { ...state.drafts, [key]: { ...draft, [channel]: { ...draft[channel], ...patch } } } };
        });
        clearTimeout(timers.get(key));
        if (!shotId.startsWith('shot_')) timers.set(key, setTimeout(() => { void saveShot(key); }, delay));
    }, [scope, projectId]);
    const flush = useCallback(async () => {
        const keys = Object.entries(useShotDraftStore.getState().drafts)
            .filter(([, draft]) => draft.scope === scope && draft.projectId === projectId).map(([key]) => key);
        await Promise.all(keys.map(saveShot));
        return !keys.some(key => useShotDraftStore.getState().drafts[key]);
    }, [scope, projectId]);
    const discard = useCallback((shotId: string) => {
        if (!projectId) return;
        const key = draftKey(scope, projectId, shotId);
        clearTimeout(timers.get(key));
        timers.delete(key);
        useShotDraftStore.setState(state => {
            const drafts = { ...state.drafts };
            delete drafts[key];
            return { drafts };
        });
    }, [scope, projectId]);
    const adopt = useCallback((shotId: string, persistedId: string) => {
        if (!projectId) return;
        const key = draftKey(scope, projectId, shotId);
        const nextKey = draftKey(scope, projectId, persistedId);
        clearTimeout(timers.get(key));
        timers.delete(key);
        useShotDraftStore.setState(state => {
            const draft = state.drafts[key];
            const drafts = { ...state.drafts };
            if (draft) drafts[nextKey] = { ...draft, shotId: persistedId };
            delete drafts[key];
            return { drafts, materializedIds: { ...state.materializedIds, [key]: persistedId } };
        });
    }, [scope, projectId]);
    const markFailed = useCallback((shotId: string) => {
        if (!projectId) return;
        const key = draftKey(scope, projectId, shotId);
        useShotDraftStore.setState(state => ({ errors: { ...state.errors, [key]: true } }));
    }, [scope, projectId]);
    const materialize = useCallback(async (shot: ShotNode, index: number): Promise<string> => {
        if (!projectId || scope !== authScope()) throw new Error('Project context changed');
        if (!shot.id.startsWith('shot_')) return shot.id;
        const key = draftKey(scope, projectId, shot.id);
        const persistedId = useShotDraftStore.getState().materializedIds[key];
        if (persistedId) return persistedId;
        const running = creations.get(key);
        if (running) return running;
        const request = (async () => {
            useShotDraftStore.setState(state => ({ saving: { ...state.saving, [key]: true } }));
            try {
                const created = await crudApi.createFrame(projectId, {
                    scene_id: '', action_description: shot.prompt || '', insert_at: index,
                });
                const frames = Array.isArray(created?.frames) ? created.frames : [];
                const frame = frames[Math.min(index, frames.length - 1)];
                if (!frame?.id) throw new Error('Frame creation returned no persisted frame');
                adopt(shot.id, frame.id);
                const projectState = useProjectStore.getState();
                if (scope === authScope() && projectState.currentProject?.id === projectId) {
                    projectState.updateProject(projectId, { frames });
                    if (projectState.selectedFrameId === shot.id) projectState.setSelectedFrameId(frame.id);
                }
                await flush();
                return frame.id;
            } catch (error) {
                markFailed(shot.id);
                throw error;
            } finally {
                useShotDraftStore.setState(state => ({ saving: { ...state.saving, [key]: false } }));
            }
        })();
        creations.set(key, request);
        try { return await request; }
        finally { creations.delete(key); }
    }, [scope, projectId, adopt, flush, markFailed]);
    const resolveId = useCallback((shotId: string) => projectId
        ? state.materializedIds[draftKey(scope, projectId, shotId)] ?? shotId : shotId,
    [scope, projectId, state.materializedIds]);
    const acceptRefinement = useCallback((frame: any) => {
        if (!projectId || scope !== authScope()) return;
        const key = draftKey(scope, projectId, frame.id);
        useShotDraftStore.setState(state => {
            const draft = state.drafts[key];
            // The first refinement changes which field owns the visible prompt.
            let drafts = state.drafts;
            if (frame.visual_description != null && draft?.fields.action_description !== undefined) {
                const { action_description, ...fields } = draft.fields;
                drafts = { ...drafts, [key]: { ...draft, fields: { visual_description: action_description, ...fields } } };
            }
            return { drafts, refinedVersions: { ...state.refinedVersions, [key]: (state.refinedVersions[key] ?? 0) + 1 } };
        });
    }, [scope, projectId]);
    const holdRefinements = useCallback((frameIds: string[]) => {
        if (!projectId || scope !== authScope()) return;
        const held = new Set(frameIds.map(id => draftKey(scope, projectId, id)));
        const released: string[] = [];
        useShotDraftStore.setState(state => {
            const next = { ...state.batchRefining };
            for (const key of Object.keys(next)) {
                const [savedScope, savedProject] = JSON.parse(key);
                if (savedScope === scope && savedProject === projectId && !held.has(key)) { delete next[key]; released.push(key); }
            }
            const changed = released.length || [...held].some(key => !next[key]);
            for (const key of held) next[key] = true;
            return changed ? { batchRefining: next } : state;
        });
        for (const key of released) void saveShot(key);
    }, [scope, projectId]);
    const refine = useCallback(async (shotId: string): Promise<boolean> => {
        if (!projectId || scope !== authScope() || shotId.startsWith('shot_')) return false;
        const key = draftKey(scope, projectId, shotId);
        const running = refinements.get(key);
        if (running) return running;
        const request = (async () => {
            await saveShot(key);
            if (useShotDraftStore.getState().drafts[key] || scope !== authScope()) return false;
            if (useShotDraftStore.getState().batchRefining[key]) return false;
            const before = useProjectStore.getState().currentProject?.frames.find(frame => frame.id === shotId);
            useShotDraftStore.setState(state => ({ refining: { ...state.refining, [key]: true } }));
            try {
                const frame = await api.refineSingleFrame(projectId, shotId);
                if (scope !== authScope()) return false;
                if (frame?.id !== shotId) throw new Error('Refinement returned no matching frame');
                const projectState = useProjectStore.getState();
                if (projectState.currentProject?.id === projectId) {
                    projectState.updateProject(projectId, {
                        frames: projectState.currentProject.frames.map(existing => existing.id === shotId ? mergeRefinementFields(existing, frame, before) : existing),
                    });
                }
                acceptRefinement(frame);
                return true;
            } finally {
                useShotDraftStore.setState(state => ({ refining: { ...state.refining, [key]: false } }));
                // Edits made during refinement are newer than the generated result.
                await saveShot(key);
            }
        })();
        refinements.set(key, request);
        try { return await request; }
        finally { refinements.delete(key); }
    }, [scope, projectId, acceptRefinement]);
    const isRefining = (shotId: string) => !!projectId && !!(state.refining[draftKey(scope, projectId, shotId)] || state.batchRefining[draftKey(scope, projectId, shotId)]);
    const refinedVersion = useCallback((shotId: string) => projectId
        ? state.refinedVersions[draftKey(scope, projectId, shotId)] ?? 0 : 0,
    [scope, projectId, state.refinedVersions]);
    const countFor = useCallback((shotId: string) => projectId
        ? useShotDraftStore.getState().drafts[draftKey(scope, projectId, shotId)]?.workbench.workbench_generate_count
        : undefined, [scope, projectId]);
    const restore = useCallback((shot: ShotNode): ShotNode => {
        if (!projectId) return shot;
        const draft = useShotDraftStore.getState().drafts[draftKey(scope, projectId, shot.id)];
        if (!draft) return shot;
        const f = draft.fields, w = draft.workbench;
        const urls = w.t2i_image_urls ?? shot.t2iImageUrls ?? [];
        const imageIndex = w.t2i_selected_index ?? shot.t2iSelectedIndex ?? 0;
        return {
            ...shot,
            ...(f.dialogue !== undefined ? { dialogueStructured: { speaker: shot.dialogueStructured?.speaker ?? "", ...shot.dialogueStructured, line: f.dialogue } } : {}),
            ...(f.visual_description !== undefined ? { prompt: f.visual_description, visualDescription: f.visual_description }
                : f.action_description !== undefined ? { prompt: f.action_description } : {}),
            ...(f.duration !== undefined ? { duration: f.duration } : {}),
            ...(f.shot_size !== undefined ? { shotSize: f.shot_size } : {}),
            ...(f.camera_angle !== undefined ? { cameraAngle: f.camera_angle } : {}),
            ...(f.transition_hint !== undefined ? { transitionHint: f.transition_hint } : {}),
            ...(f.camera_movement_description !== undefined ? { cameraMovementStructured: {
                ...shot.cameraMovementStructured, primary: f.camera_movement_description,
                description: f.camera_movement_description, speed: shot.cameraMovementStructured?.speed ?? 'normal',
            } } : {}),
            ...(w.workbench_tab_mode ? { tabMode: w.workbench_tab_mode } : {}),
            ...(w.t2i_image_urls ? { t2iImageUrls: w.t2i_image_urls } : {}),
            ...(w.t2i_selected_index !== undefined ? { t2iSelectedIndex: w.t2i_selected_index } : {}),
            ...(w.t2i_image_urls !== undefined || w.t2i_selected_index !== undefined ? { t2iImageUrl: urls[imageIndex] } : {}),
        };
    }, [scope, projectId]);
    useEffect(() => {
        return () => {
            const state = useShotDraftStore.getState();
            for (const [key, draft] of Object.entries(state.drafts)) {
                if (draft.scope === scope && draft.projectId === projectId && timers.has(key)) void saveShot(key);
            }
        };
    }, [scope, projectId]);
    const localShots = () => keys.map(key => state.drafts[key]).filter(draft => draft.shotId.startsWith('shot_'))
        .map(draft => restore({ id: draft.shotId, prompt: '', tabMode: 'direct_r2v' }));
    const materializing = keys.some(key => state.drafts[key].shotId.startsWith('shot_') && state.saving[key]);
    return { queue, flush, discard, materialize, resolveId, materializing, refine, acceptRefinement, holdRefinements, isRefining, refinedVersion, countFor, restore, localShots, pending: keys.length > 0, hasError, saving, storageUnavailable: state.storageUnavailable };
}
