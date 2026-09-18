import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CastWorkbenchModal, { activePolls } from "./CastWorkbenchModal";
import { useProjectStore } from "@/store/projectStore";
import { useToastStore } from "@/store/toastStore";

const api = vi.hoisted(() => ({
    generateAsset: vi.fn(),
    getProject: vi.fn(),
    getStylePresets: vi.fn(),
    getTaskStatus: vi.fn(),
    selectAssetVariant: vi.fn(),
    favoriteAssetVariant: vi.fn(),
    cancelTask: vi.fn(),
}));

vi.mock("next-intl", () => ({
    useTranslations: () => (key: string) => key,
}));

vi.mock("@/lib/api", () => ({ api, API_URL: "http://localhost:17177" }));

vi.mock("@/components/common/GroupedModelGrid", () => ({
    default: () => <div data-testid="model-grid" />,
}));

vi.mock("@/components/shared/preview/PreviewImage", () => ({
    default: () => null,
}));

const project = {
    id: "project-1",
    title: "Issue 17 repro",
    characters: [{
        id: "character-1",
        name: "林默",
        description: "测试角色",
        age: "65岁",
        clothing: "旧蓝衬衫和棕色马甲",
        reference_sheet: { selected_image_id: null, image_variants: [] },
    }],
    scenes: [],
    props: [],
    model_settings: { t2i_model: "wan2.7-image-pro" },
};

describe("CastWorkbenchModal asset generation", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-08-30T12:00:00Z"));
        vi.clearAllMocks();
        activePolls.forEach((poll) => clearInterval(poll));
        activePolls.clear();
        useToastStore.getState().clear();
        useProjectStore.setState({
            ...useProjectStore.getInitialState(),
            currentProject: project as any,
            projects: [project as any],
            generatingTasks: [],
        }, true);
        api.getStylePresets.mockResolvedValue([]);
        api.getProject.mockResolvedValue(project);
        api.generateAsset.mockResolvedValue({ _task_id: "task-1" });
        api.getTaskStatus.mockResolvedValue({ status: "processing" });
    });

    it("shows batch accounting and cancels without counting pending work as failed", async () => {
        api.generateAsset.mockResolvedValue({ _task_id: "task-1", _job_id: "job-1" });
        api.cancelTask.mockResolvedValue({ status: "canceled" });
        render(
            <CastWorkbenchModal isOpen kind="character" entityId="character-1" onClose={vi.fn()} />,
        );
        await act(async () => {});
        fireEvent.click(screen.getByRole("button", { name: "generateFirst" }));
        await act(async () => { await Promise.resolve(); await Promise.resolve(); });
        expect(screen.getByRole("button", { name: "cancelGeneration" })).toBeEnabled();
        expect(screen.getByText(/batchPending: 2/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "cancelGeneration" }));
        await act(async () => { await Promise.resolve(); await Promise.resolve(); });
        expect(api.cancelTask).toHaveBeenCalledWith("job-1");
        expect(screen.getByText(/batchCanceled: 2/)).toBeInTheDocument();
        expect(screen.queryByText(/batchFailed: 2/)).not.toBeInTheDocument();
        expect(useToastStore.getState().toasts.some((toast) => toast.kind === "progress")).toBe(false);
    });

    function withReferences() {
        const ready: any = structuredClone(project);
        ready.model_settings.t2i_model = 'gpt-image-2';
        ready.characters[0].reference_sheet = { selected_image_id: 'base-1', image_variants: [{ id: 'base-1', url: '/base.png' }] };
        ready.props = [{ id: 'sword', name: '佩剑', image_asset: { selected_id: 'sword-1', variants: [{ id: 'sword-1', url: '/sword.png', params: { reference_inputs: [{ asset_name: '陆青', asset_type: 'character', asset_id: 'character-1', variant_id: 'base-1', image_url: '/base.png' }] } }] } }];
        useProjectStore.setState({ currentProject: ready, projects: [ready] });
        api.getProject.mockResolvedValue(ready);
        return ready;
    }

    it('requires an actual character reference before extracting a prop', async () => {
        withReferences();
        render(<CastWorkbenchModal isOpen kind="prop" entityId="sword" onClose={vi.fn()} />);
        await act(async () => {});
        expect(screen.getByRole('button', { name: 'generateMore' })).toBeDisabled();
        expect(screen.getByText('sourceLabel: 陆青')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /sourceCharacter/ }));
        fireEvent.click(screen.getByRole('option', { name: '林默' }));
        fireEvent.click(screen.getByRole('button', { name: 'generateMore' }));
        await act(async () => { await Promise.resolve(); await Promise.resolve(); });
        expect(api.generateAsset.mock.calls[0][13]).toEqual({ purpose: 'prop_extract', inputs: [
            { asset_type: 'character', asset_id: 'character-1', variant_id: 'base-1' },
        ] });
    });

    it('combines character and prop images without replacing the base gallery or losing drafts', async () => {
        withReferences();
        render(<CastWorkbenchModal isOpen kind="character" entityId="character-1" onClose={vi.fn()} />);
        await act(async () => {});
        fireEvent.change(screen.getByRole('textbox'), { target: { value: '保留人物眉眼' } });
        fireEvent.click(screen.getByRole('button', { name: 'mode.character_holding' }));
        expect(screen.getByRole('button', { name: 'generateFirst' })).toBeDisabled();
        fireEvent.click(screen.getByRole('checkbox', { name: /佩剑/ }));
        fireEvent.click(screen.getByRole('radio', { name: 'position.right' }));
        fireEvent.click(screen.getByRole('button', { name: 'mode.character_base' }));
        expect(screen.getByRole('textbox')).toHaveValue('保留人物眉眼');
        fireEvent.click(screen.getByRole('button', { name: 'mode.character_holding' }));
        fireEvent.click(screen.getByRole('button', { name: 'generateFirst' }));
        await act(async () => { await Promise.resolve(); await Promise.resolve(); });
        expect(api.generateAsset.mock.calls[0][5]).toBe('holding_reference');
        expect(api.generateAsset.mock.calls[0][13]).toEqual({ purpose: 'character_holding', holdingPosition: 'right', inputs: [
            { asset_type: 'character', asset_id: 'character-1', variant_id: 'base-1' },
            { asset_type: 'prop', asset_id: 'sword', variant_id: 'sword-1' },
        ] });
        expect(useProjectStore.getState().currentProject?.characters[0].reference_sheet?.selected_image_id).toBe('base-1');
    });

    it('selects a holding candidate through an explicit button in its own container', async () => {
        const ready = withReferences();
        ready.characters[0].holding_reference = { selected_image_id: null, image_variants: [{ id: 'holding-1', url: '/holding.png' }] };
        api.selectAssetVariant.mockResolvedValue(ready);
        render(<CastWorkbenchModal isOpen kind="character" entityId="character-1" onClose={vi.fn()} />);
        await act(async () => {});
        fireEvent.click(screen.getByRole('button', { name: 'mode.character_holding' }));
        fireEvent.click(screen.getByRole('button', { name: 'selectHolding' }));
        await act(async () => {});
        expect(api.selectAssetVariant).toHaveBeenCalledWith('project-1', 'character-1', 'character', 'holding-1', 'holding_reference');
        expect(useProjectStore.getState().currentProject?.characters[0].reference_sheet?.selected_image_id).toBe('base-1');
    });

    afterEach(() => {
        activePolls.forEach((poll) => clearInterval(poll));
        activePolls.clear();
        vi.useRealTimers();
    });

    it("retains a running generation past 45 seconds and waits for its real outcome", async () => {
        render(
            <CastWorkbenchModal
                isOpen
                kind="character"
                entityId="character-1"
                onClose={vi.fn()}
            />,
        );

        await act(async () => {});
        expect(screen.getByRole("textbox").getAttribute("value") || (screen.getByRole("textbox") as HTMLTextAreaElement).value).toContain("65岁");
        expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toContain("旧蓝衬衫和棕色马甲");
        await act(async () => {
            fireEvent.click(screen.getByRole("button", { name: "generateFirst" }));
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(api.generateAsset).toHaveBeenCalledTimes(1);
        expect(useProjectStore.getState().generatingTasks).toHaveLength(1);

        await act(async () => {
            await vi.advanceTimersByTimeAsync(47_500);
        });

        expect(useProjectStore.getState().generatingTasks).toHaveLength(1);
        expect(useToastStore.getState().toasts.some(toast => toast.kind === "error")).toBe(false);
        api.getTaskStatus.mockResolvedValue({ status: "completed" });
        await act(async () => { await vi.advanceTimersByTimeAsync(2_500); });
        expect(useProjectStore.getState().generatingTasks).toHaveLength(0);
    });
});
