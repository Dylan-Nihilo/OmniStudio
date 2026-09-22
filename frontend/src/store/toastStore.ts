/**
 * toastStore — project-aware notification queue.
 *
 * Why a global store: long-running LLM tasks (storyboard generation,
 * audio batch, voice clone) often outlive the page the user kicked them
 * off from. When the user is on Project A and the storyboard generation
 * for Project B finishes, the toast needs to identify B by name so the
 * user can decide whether to switch projects. Per-page transient state
 * (a simple alert/local toast) can't do that.
 */
import { create } from "zustand";

export type ToastKind = "info" | "progress" | "success" | "error" | "warning";

export interface ToastAction {
    label: string;
    onClick: () => void;
}

export interface Toast {
    id: string;
    kind: ToastKind;
    title: string;
    /** Optional body line. Plain text or short markup. */
    body?: string;
    /** Project context — surfaces "[项目名]" prefix so cross-project
     *  notifications are unambiguous. */
    projectId?: string;
    projectTitle?: string;
    /** Primary action (e.g. "去看看", "重试"). */
    action?: ToastAction;
    /** Auto-dismiss after ms. 0 / undefined = sticky until user closes. */
    autoCloseMs?: number;
    createdAt: number;
}

interface ToastStore {
    toasts: Toast[];
    push: (toast: Omit<Toast, "id" | "createdAt">) => string;
    update: (id: string, patch: Partial<Omit<Toast, "id" | "createdAt">>) => void;
    dismiss: (id: string) => void;
    clear: () => void;
}

let counter = 0;
const dismissTimers = new Map<string, ReturnType<typeof setTimeout>>();

function nextId(): string {
    counter += 1;
    return `toast-${Date.now()}-${counter}`;
}

function clearDismissTimer(id: string): void {
    const timer = dismissTimers.get(id);
    if (timer) {
        clearTimeout(timer);
        dismissTimers.delete(id);
    }
}

function scheduleDismiss(id: string, autoCloseMs: number): void {
    clearDismissTimer(id);
    dismissTimers.set(id, setTimeout(() => {
        dismissTimers.delete(id);
        useToastStore.getState().dismiss(id);
    }, autoCloseMs));
}

export const useToastStore = create<ToastStore>((set) => ({
    toasts: [],
    push: (toast) => {
        const id = nextId();
        const full: Toast = { ...toast, id, createdAt: Date.now() };
        set((state) => ({ toasts: [...state.toasts, full] }));
        if (full.autoCloseMs && full.autoCloseMs > 0) {
            scheduleDismiss(id, full.autoCloseMs);
        }
        return id;
    },
    update: (id, patch) => {
        set((state) => ({
            toasts: state.toasts.map((t) => (t.id === id ? { ...t, ...patch } : t)),
        }));
        if (Object.prototype.hasOwnProperty.call(patch, "autoCloseMs")) {
            if (patch.autoCloseMs && patch.autoCloseMs > 0) scheduleDismiss(id, patch.autoCloseMs);
            else clearDismissTimer(id);
        }
    },
    dismiss: (id) => {
        clearDismissTimer(id);
        set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
    },
    clear: () => {
        for (const id of dismissTimers.keys()) clearDismissTimer(id);
        set({ toasts: [] });
    },
}));

/** Convenience helpers — keep call sites short. */
export const toast = {
    info: (title: string, opts?: Partial<Toast>) =>
        useToastStore.getState().push({ kind: "info", title, autoCloseMs: 5000, ...opts }),
    success: (title: string, opts?: Partial<Toast>) =>
        useToastStore.getState().push({ kind: "success", title, autoCloseMs: 6000, ...opts }),
    error: (title: string, opts?: Partial<Toast>) =>
        useToastStore.getState().push({ kind: "error", title, autoCloseMs: 0, ...opts }),
    warning: (title: string, opts?: Partial<Toast>) =>
        useToastStore.getState().push({ kind: "warning", title, autoCloseMs: 6000, ...opts }),
    /** Returns an id you can later update() to "success"/"error" + dismiss. */
    progress: (title: string, opts?: Partial<Toast>) =>
        useToastStore.getState().push({ kind: "progress", title, autoCloseMs: 0, ...opts }),
    update: (id: string, patch: Partial<Omit<Toast, "id" | "createdAt">>) =>
        useToastStore.getState().update(id, patch),
    dismiss: (id: string) => useToastStore.getState().dismiss(id),
};
