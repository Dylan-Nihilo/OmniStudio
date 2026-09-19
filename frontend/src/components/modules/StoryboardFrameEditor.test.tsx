import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import StoryboardFrameEditor from './StoryboardFrameEditor';

const mocks = vi.hoisted(() => ({ renderFrame: vi.fn(), selectAssetVariant: vi.fn(), deleteAssetVariant: vi.fn(), updateProject: vi.fn() }));

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@/lib/api', () => ({ api: { renderFrame: mocks.renderFrame, selectAssetVariant: mocks.selectAssetVariant, deleteAssetVariant: mocks.deleteAssetVariant } }));
vi.mock('@/store/projectStore', () => ({ useProjectStore: (selector: (state: any) => unknown) => selector({ currentProject: { id: 'project', frames: [{ id: 'frame', image_prompt: 'prompt' }] }, updateProject: mocks.updateProject }) }));
vi.mock('../common/VariantSelector', () => ({ VariantSelector: ({ onGenerate, isGenerating }: { onGenerate: (batchSize: number) => void; isGenerating: boolean }) => <button disabled={isGenerating} onClick={() => onGenerate(1)}>generate</button> }));

beforeEach(() => { vi.clearAllMocks(); vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => vi.restoreAllMocks());

it('shows an inline retryable error when storyboard frame generation fails', async () => {
    mocks.renderFrame.mockRejectedValueOnce(new Error('provider unavailable'));
    render(<StoryboardFrameEditor frame={{ id: 'frame', image_prompt: 'prompt' }} onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'generate' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('generateFailed');
    expect(screen.getByRole('button', { name: 'retry' })).toBeVisible();
});

it('retries generation from the inline error state', async () => {
    mocks.renderFrame.mockRejectedValueOnce(new Error('provider unavailable')).mockResolvedValueOnce({ id: 'project' });
    render(<StoryboardFrameEditor frame={{ id: 'frame', image_prompt: 'prompt' }} onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'generate' }));
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'retry' }));

    await waitFor(() => expect(mocks.renderFrame).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('protects an edited prompt when leaving the editor', async () => {
    const close = vi.fn();
    render(<StoryboardFrameEditor frame={{ id: 'frame', image_prompt: 'prompt' }} onClose={close} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'edited prompt' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'close' })[0]);
    expect(close).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'keepEditing' }));
    expect(screen.getByRole('textbox')).toHaveValue('edited prompt');
});
