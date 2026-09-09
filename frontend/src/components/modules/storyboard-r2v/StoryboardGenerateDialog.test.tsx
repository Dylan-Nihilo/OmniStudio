import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import StoryboardGenerateDialog from './StoryboardGenerateDialog';

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));

it('gates replacement on project inputs and requires an explicit confirmation', () => {
    const confirm = vi.fn(), close = vi.fn(), jump = vi.fn();
    const props = { isOpen: true, existingShotCount: 2, onClose: close, onConfirm: confirm, onJumpToScript: jump };
    const { rerender } = render(<StoryboardGenerateDialog {...props} project={{ id: 'project', originalText: '' }} />);
    expect(screen.getByRole('dialog', { name: 'title' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'replaceAndGenerate' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'goFixInScript' }));
    expect(jump).toHaveBeenCalledOnce();
    rerender(<StoryboardGenerateDialog {...props} project={{ id: 'project', title: 'Night signal', originalText: 'A radio operator listens for a distant signal in the dark.'.repeat(2), characters: [{ id: 'speaker' }] }} />);
    expect(screen.getByText('willReplaceWarning')).toBeInTheDocument();
    expect(confirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'replaceAndGenerate' }));
    expect(close).toHaveBeenCalledOnce();
    expect(confirm).toHaveBeenCalledOnce();
});

it('blocks generation when the persisted storyboard readiness report has blockers', () => {
    const confirm = vi.fn();
    render(<StoryboardGenerateDialog
        isOpen
        existingShotCount={0}
        onClose={vi.fn()}
        onConfirm={confirm}
        readiness={{ ready: false, blockers: [{ code: 'SCENE_NOT_FOUND', message: 'Missing scene' }] }}
        project={{ id: 'project', originalText: 'A radio operator listens for a distant signal in the dark.'.repeat(2), characters: [{ id: 'speaker' }] }}
    />);

    expect(screen.getByText('Missing scene')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'generate' })).toBeDisabled();
    expect(confirm).not.toHaveBeenCalled();
});
