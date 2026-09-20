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

it.each(['project', 'series'])('preserves the inherited %s model and saves an explicit tier by its upstream name', async (scope) => {
    save.mockResolvedValue({ prompt_config: config });
    render(scope === 'project'
        ? <PromptConfigModal isOpen onClose={vi.fn()} />
        : <SeriesPromptConfigModal isOpen onClose={vi.fn()} seriesId="series" />);
    const inherit = scope === 'project' ? 'polishInheritProject' : 'polishInheritWorkspace';
    const select = await screen.findByRole('button', { name: new RegExp(inherit) });
    fireEvent.click(screen.getByRole('button', { name: 'save' }));
    await waitFor(() => expect(save).toHaveBeenCalledWith(scope, expect.objectContaining({ polish_model: '' })));
    fireEvent.click(select);
    // Options are catalog tiers now, not one hardcoded model name. What gets stored is still
    // the provider's own model id, because that string goes upstream and billing charges it.
    // Only the tiers the relay can actually serve are listed; all three answer today.
    for (const tier of ['标准', '高级', '极致']) {
        expect(await screen.findByRole('option', { name: tier })).toBeInTheDocument();
    }
    fireEvent.click(await screen.findByRole('option', { name: '高级' }));
    fireEvent.click(screen.getByRole('button', { name: 'save' }));
    await waitFor(() => expect(save).toHaveBeenCalledWith(scope, expect.objectContaining({ polish_model: 'gpt-5.6-sol' })));
});

it.each(['project', 'series'])('retains %s edits after a save failure and exposes an inline retry state', async (scope) => {
    const close = vi.fn();
    save.mockRejectedValueOnce(new Error('offline'));
    render(scope === 'project'
        ? <PromptConfigModal isOpen onClose={close} />
        : <SeriesPromptConfigModal isOpen onClose={close} seriesId="series" />);
    const editor = (await screen.findAllByRole('textbox'))[0];
    fireEvent.change(editor, { target: { value: 'keep this draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('promptSaveFailed');
    expect(editor).toHaveValue('keep this draft');
    expect(close).not.toHaveBeenCalled();

    save.mockResolvedValueOnce({ prompt_config: config });
    fireEvent.click(screen.getByRole('button', { name: 'save' }));
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
});

it.each(['project', 'series'])('asks before closing a dirty %s prompt dialog and keeps the draft when cancelled', async (scope) => {
    const close = vi.fn();
    render(scope === 'project'
        ? <PromptConfigModal isOpen onClose={close} />
        : <SeriesPromptConfigModal isOpen onClose={close} seriesId="series" />);
    const editor = (await screen.findAllByRole('textbox'))[0];
    fireEvent.change(editor, { target: { value: 'unsaved draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'cancel' }));
    expect(await screen.findByRole('dialog', { name: 'unsavedChangesTitle' })).toBeInTheDocument();
    expect(close).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'keepEditing' }));
    expect(screen.queryByRole('dialog', { name: 'unsavedChangesTitle' })).not.toBeInTheDocument();
    expect(editor).toHaveValue('unsaved draft');
    fireEvent.click(screen.getByRole('button', { name: 'cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'discardChanges' }));
    expect(close).toHaveBeenCalledOnce();
});
