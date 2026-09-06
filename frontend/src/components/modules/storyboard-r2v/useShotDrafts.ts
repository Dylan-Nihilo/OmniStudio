import { useCallback, useEffect } from 'react';
import { create } from 'zustand';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import { useProjectStore } from '@/store/projectStore';
import type { ShotNode } from './ShotCard';

type Fields = Parameters<typeof api.updateFrame>[2];
type Workbench = Parameters<typeof api.updateFrameWorkbench>[2];
type Draft = { scope: string; projectId: string; shotId: string; fields: Fields; workbench: Workbench };
const STORAGE_KEY = 'omni-studio.shot-drafts.v1';
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const requests = new Map<string, Promise<void>>();
const authScope = () => {
    const { user, activeWorkspace } = useAuthStore.getState();
    return JSON.stringify([user?.id ?? null, activeWorkspace?.id ?? null]);
};
const draftKey = (scope: string, projectId: string, shotId: string) => JSON.stringify([scope, projectId, shotId]);

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
}>(() => ({ drafts: readDrafts(), errors: {}, saving: {}, storageUnavailable: false }));

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
            if (!draft) return state;
            const drafts = { ...state.drafts, [nextKey]: { ...draft, shotId: persistedId } };
            delete drafts[key];
            return { drafts };
        });
    }, [scope, projectId]);
    const markFailed = useCallback((shotId: string) => {
        if (!projectId) return;
        const key = draftKey(scope, projectId, shotId);
        useShotDraftStore.setState(state => ({ errors: { ...state.errors, [key]: true } }));
    }, [scope, projectId]);
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
    return { queue, flush, discard, adopt, markFailed, countFor, restore, localShots, pending: keys.length > 0, hasError, saving, storageUnavailable: state.storageUnavailable };
}
