import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useToastStore } from "@/store/toastStore";

describe("toastStore", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        useToastStore.getState().clear();
    });

    afterEach(() => {
        useToastStore.getState().clear();
        vi.useRealTimers();
    });

    it("auto-dismisses a toast when an update adds an auto-close duration", () => {
        const id = useToastStore.getState().push({ kind: "progress", title: "正在分析" });

        useToastStore.getState().update(id, { kind: "success", autoCloseMs: 5000 });

        vi.advanceTimersByTime(4999);
        expect(useToastStore.getState().toasts).toHaveLength(1);

        vi.advanceTimersByTime(1);
        expect(useToastStore.getState().toasts).toHaveLength(0);
    });
});
