import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import PromptConfigModal from './PromptConfigModal';
import SeriesPromptConfigModal from '../series/SeriesPromptConfigModal';

const { config, save, updateProject } = vi.hoisted(() => ({
    config: { storyboard_polish: '', video_polish: '', r2v_polish: '', polish_model: '' },
    save: vi.fn(), updateProject: vi.fn(),
}));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@/store/projectStore', () => ({ useProjectStore: (select: (state: unknown) => unknown) => select({ currentProject: { id: 'project' }, updateProject }) }));
vi.mock('@/lib/api', () => ({ api: {
    getPromptConfig: vi.fn().mockResolvedValue({ prompt_config: config, defaults: config }),
    getSeriesPromptConfig: vi.fn().mockResolvedValue({ prompt_config: config, defaults: config }),
    updatePromptConfig: save,
    updateSeriesPromptConfig: save,
} }));

it.each(['project', 'series'])('preserves inherited %s model and saves an explicit Sol choice', async (scope) => {
    save.mockResolvedValue({ prompt_config: config });
    render(scope === 'project'
        ? <PromptConfigModal isOpen onClose={vi.fn()} />
        : <SeriesPromptConfigModal isOpen onClose={vi.fn()} seriesId="series" />);
    const inherit = scope === 'project' ? 'polishInheritProject' : 'polishInheritWorkspace';
    const select = await screen.findByRole('button', { name: new RegExp(inherit) });
    fireEvent.click(screen.getByRole('button', { name: 'save' }));
    await waitFor(() => expect(save).toHaveBeenCalledWith(scope, expect.objectContaining({ polish_model: '' })));
    fireEvent.click(select);
    fireEvent.click(await screen.findByRole('option', { name: 'GPT 5.6 Sol · 文本与视觉' }));
    fireEvent.click(screen.getByRole('button', { name: 'save' }));
    await waitFor(() => expect(save).toHaveBeenCalledWith(scope, expect.objectContaining({ polish_model: 'gpt-5.6-sol' })));
});
