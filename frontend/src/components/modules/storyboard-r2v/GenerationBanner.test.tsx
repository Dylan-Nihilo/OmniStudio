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
