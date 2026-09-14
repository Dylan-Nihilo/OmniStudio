import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import T2ISubsection from './T2ISubsection';

vi.mock('next-intl', () => ({ useTranslations: () => (key: string, values?: Record<string, unknown>) => values?.index ? `${key} ${values.index}` : key }));

describe('First-frame controls', () => {
    it('edits a still-image description while allowing upload without one', () => {
        const onPromptChange = vi.fn(), onUseShotPrompt = vi.fn();
        render(<T2ISubsection imageUrls={[]} selectedIndex={0} prompt="" onPromptChange={onPromptChange}
            onUseShotPrompt={onUseShotPrompt} generating={false} onGenerate={vi.fn()}
            onSelect={vi.fn()} onRemove={vi.fn()} onUpload={vi.fn()} />);
        expect(screen.getByRole('button', { name: 't2iHeroGenerateLabel' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 't2iHeroUploadLabel' })).toBeEnabled();
        fireEvent.change(screen.getByRole('textbox', { name: 'firstFramePromptLabel' }), { target: { value: 'A still frame before the rescue.' } });
        expect(onPromptChange).toHaveBeenCalledWith('A still frame before the rescue.');
        fireEvent.click(screen.getByRole('button', { name: 'firstFrameUseShotPrompt' }));
        expect(onUseShotPrompt).toHaveBeenCalledOnce();
    });

    it('retains the image and keyboard focus while retrying, and exposes removal without hover', () => {
        const onGenerate = vi.fn();
        const onRemove = vi.fn();
        const props = { imageUrls: ['old.png'], selectedIndex: 0, prompt: 'A still frame', onPromptChange: vi.fn(), generating: false,
            errorMessage: 'Image provider unavailable', onGenerate, onRemove, onSelect: vi.fn(), onUpload: vi.fn() };
        const view = render(<T2ISubsection {...props} />);
        expect(screen.getByRole('alert')).toHaveTextContent('Image provider unavailable');
        const retry = screen.getByRole('button', { name: 'retry' });
        retry.focus();
        fireEvent.click(retry);
        expect(onGenerate).toHaveBeenCalledOnce();
        view.rerender(<T2ISubsection {...props} errorMessage={undefined} generating />);
        expect(retry).toHaveFocus();
        expect(retry).toHaveAttribute('aria-disabled', 'true');
        fireEvent.click(retry);
        expect(onGenerate).toHaveBeenCalledOnce();
        expect(screen.getByRole('status')).toHaveTextContent('t2iGenerating');
        const onRefresh = vi.fn();
        view.rerender(<T2ISubsection {...props} errorMessage={undefined} generating checking refreshFailed onRefresh={onRefresh} />);
        expect(screen.getByRole('status')).toHaveTextContent('t2iChecking');
        expect(screen.getByRole('alert')).toHaveTextContent('t2iStatusUnavailable');
        fireEvent.click(screen.getByRole('button', { name: 't2iRefreshStatus' }));
        expect(onRefresh).toHaveBeenCalledOnce();
        expect(onGenerate).toHaveBeenCalledOnce();
        view.rerender(<T2ISubsection {...props} errorMessage={undefined} />);
        fireEvent.click(screen.getByRole('button', { name: 't2iRemoveCandidate 1' }));
        expect(onRemove).toHaveBeenCalledWith(0);
    });
});
