import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { GenerationBanner } from './GenerationBanner';
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
it('announces generation and retains the dialogue action without duplicate frame-only chrome', () => {
    const generate = vi.fn();
    const { rerender } = render(<GenerationBanner state="phase1" phase1Captions={[]} />);
    expect(screen.getByRole('status')).toHaveTextContent('genInFlight');
    rerender(<GenerationBanner state="summary" phase1Captions={[]} summary={{ frameCount: 4, dialogueReady: 0, dialogueMissing: 0 }} />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    rerender(<GenerationBanner state="summary" phase1Captions={[]} summary={{ frameCount: 4, dialogueReady: 2, dialogueMissing: 0 }} onGenerateDialogue={generate} />);
    expect(screen.getByRole('status')).toHaveTextContent('bannerDialoguePending');
    fireEvent.click(screen.getByRole('button', { name: 'bannerSynthDialogue' }));
    expect(generate).toHaveBeenCalledOnce();
});

it('keeps the focused batch action mounted while pending, then presents retry and read failure', () => {
    const generate = vi.fn(), refresh = vi.fn();
    const summary = { frameCount: 2, dialogueReady: 2, dialogueMissing: 0 };
    const { rerender } = render(<GenerationBanner state="summary" phase1Captions={[]} summary={summary} onGenerateDialogue={generate} />);
    const action = screen.getByRole('button', { name: 'bannerSynthDialogue' });
    action.focus();
    rerender(<GenerationBanner state="dialogue" phase1Captions={[]} summary={summary} onGenerateDialogue={generate} />);
    expect(action).toHaveFocus();
    expect(action).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText('batchDialoguePreparing')).toBeInTheDocument();
    fireEvent.click(action);
    expect(generate).not.toHaveBeenCalled();
    rerender(<GenerationBanner state="summary" phase1Captions={[]} summary={summary} onGenerateDialogue={generate}
        batch={{ id: 'batch', status: 'completed', frame_ids: ['one', 'two'], instructions: {}, results: { one: 'generated', two: 'failed' } }} refreshFailed onRefresh={refresh} />);
    expect(screen.getByText(/batchDialogueResults/)).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('batchDialogueRefreshFailed');
    fireEvent.click(screen.getByRole('button', { name: 'batchDialogueRetry' }));
    fireEvent.click(screen.getByRole('button', { name: 'refreshStatus' }));
    expect(generate).toHaveBeenCalledOnce();
    expect(refresh).toHaveBeenCalledOnce();
});

it('keeps the refinement retry focused during recovery and exposes a failed status read', () => {
    const refine = vi.fn(), refresh = vi.fn();
    const storyboard = { id: 'refinement', phase: 'refine' as const, status: 'failed' as const, frame_ids: ['one', 'two'], results: { one: 'completed' as const, two: 'failed' as const } };
    const props = { storyboard, refinementCount: 1, phase1Captions: [], onRefine: refine, onRefresh: refresh };
    const { rerender } = render(<GenerationBanner {...props} state="summary" />);
    const retry = screen.getByRole('button', { name: 'storyboardRetryRefinement' });
    retry.focus();
    fireEvent.click(retry);
    expect(refine).toHaveBeenCalledOnce();
    rerender(<GenerationBanner {...props} state="phase2" storyboardRecovering refreshFailed />);
    expect(retry).toHaveFocus();
    expect(retry).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText('storyboardChecking')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('storyboardRefreshFailed');
    fireEvent.click(retry);
    expect(refine).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'refreshStatus' }));
    expect(refresh).toHaveBeenCalledOnce();
});
