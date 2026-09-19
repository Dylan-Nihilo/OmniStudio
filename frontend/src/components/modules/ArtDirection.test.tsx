import { fireEvent, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { api } from '@/lib/api';
import { useProjectStore, type Project } from '@/store/projectStore';
import { renderWithIntl } from '@/test/renderWithIntl';
import ArtDirection, { PresetDetailModal } from './ArtDirection';

vi.mock('./DirectorPlan/DirectorPlanEditor', () => ({ default: () => null }));

it('keeps style setup open on a failed save and continues to assets after a successful retry', async () => {
    const project = { id: 'style-project', title: '测试', workflow_mode: 'r2v', characters: [], scenes: [], props: [],
        art_direction: { style_config: { id: 'anime', name: '动漫', positive_prompt: 'anime', negative_prompt: '', is_custom: false } },
    } as unknown as Project;
    useProjectStore.setState({ ...useProjectStore.getInitialState(), currentProject: project, projects: [project] }, true);
    vi.spyOn(api, 'getVisualHandbook').mockResolvedValue({ markdown: '' } as never);
    vi.spyOn(api, 'listVisualHandbookTemplates').mockResolvedValue({ templates: [] } as never);
    vi.spyOn(api, 'getStylePresets').mockResolvedValue({ presets: [], categories: [] });
    vi.spyOn(api, 'getProject').mockResolvedValue(project);
    const save = vi.spyOn(api, 'saveArtDirection').mockRejectedValueOnce(new Error('offline')).mockResolvedValue({} as never);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const navigate = vi.fn();
    document.addEventListener('omni_studio:navigateStep', navigate);
    const view = renderWithIntl(<ArtDirection />);
    try {
        fireEvent.click(await screen.findByRole('button', { name: '保存画风，进入本集素材' }));
        await screen.findByRole('button', { name: '保存画风，进入本集素材' });
        expect(navigate).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: '保存画风，进入本集素材' }));
        await waitFor(() => expect(navigate).toHaveBeenCalledOnce());
        expect(navigate.mock.lastCall?.[0].detail).toBe('cast');
        expect(save).toHaveBeenCalledTimes(2);
    } finally {
        view.unmount();
        document.removeEventListener('omni_studio:navigateStep', navigate);
        vi.restoreAllMocks();
        useProjectStore.setState(useProjectStore.getInitialState(), true);
    }
});


it('protects custom style edits when closing or switching presets', async () => {
    const close = vi.fn(), switchPreset = vi.fn();
    const preset = { id: 'a', name: 'Anime', name_zh: '动漫', positive_prompt: 'anime', negative_prompt: '', category: 'anime' } as any;
    renderWithIntl(<PresetDetailModal preset={preset} isSelected={false} editing positivePrompt="my draft" negativePrompt="" onPositiveChange={vi.fn()} onNegativeChange={vi.fn()} onStartEditing={vi.fn()} onApply={vi.fn()} onClose={close} sameCategoryPresets={[{...preset, id:'b', name_zh:'另一风格'}]} onSwitchPreset={switchPreset} />);
    expect(screen.getByRole('dialog', {name:'动漫'})).toBeVisible();
    fireEvent.click(screen.getByRole('button', {name:'取消'}));
    expect(await screen.findByRole('dialog', {name:'有未保存的修改'})).toBeVisible();
    fireEvent.click(screen.getByRole('button', {name:'继续编辑'}));
    expect(close).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', {name:'另一风格'}));
    fireEvent.click(await screen.findByRole('button', {name:'放弃修改'}));
    expect(switchPreset).toHaveBeenCalledOnce();
});
