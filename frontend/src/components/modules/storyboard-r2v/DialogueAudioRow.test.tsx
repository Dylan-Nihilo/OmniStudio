import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DialogueAudioRow from './DialogueAudioRow';

const { generate } = vi.hoisted(() => ({ generate: vi.fn() }));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@/lib/api', () => ({ API_URL: 'http://localhost:17177', api: { generateLineAudio: generate } }));

const props = { scriptId: 'dialogue-project', frameId: 'dialogue-frame', dialogue: 'Original dialogue', voiceId: 'voice', audioUrl: 'old.mp3', audioError: null,
    snapshotDialogue: 'Original dialogue', snapshotVoiceId: 'voice', snapshotInstructions: 'happy; whisper', onAudioUpdated: vi.fn() };

describe('Dialogue audio workbench', () => {
    beforeEach(() => { generate.mockReset(); });

    it.each([false, true])('accepts null project audio fields (empty dialogue: %s)', async empty => {
        generate.mockResolvedValueOnce({ frames: [{ id: 'default-delivery-false', audio_url: 'new.mp3' }] });
        render(<DialogueAudioRow {...props} frameId={`default-delivery-${empty}`} dialogue={empty ? null : props.dialogue} audioUrl={empty ? undefined : props.audioUrl} snapshotInstructions={null} />);
        fireEvent.click(screen.getByRole('button', { name: /openVoiceGen/ }));
        expect(screen.getByRole('textbox', { name: 'deliveryInstructions' })).toHaveValue('');
        expect(screen.queryByText('staleHint')).not.toBeInTheDocument();
        if (empty) {
            expect(screen.getByPlaceholderText('dialoguePlaceholder')).toHaveValue('');
            expect(screen.getByRole('button', { name: 'generate' })).toBeDisabled();
        } else {
            fireEvent.click(screen.getByRole('button', { name: 'regenerate' }));
            await waitFor(() => expect(generate).toHaveBeenCalledWith('dialogue-project', 'default-delivery-false', 1, 1, 50, ''));
        }
    });

    it('saves the displayed dialogue before generating and retains the form when saving fails', async () => {
        let finishSave!: () => void;
        const save = vi.fn().mockReturnValueOnce(new Promise<void>(resolve => { finishSave = resolve; }));
        generate.mockRejectedValueOnce({ response: { status: 400, data: { detail: 'Voice provider unavailable' } } });
        render(<DialogueAudioRow {...props} frameId="save-audio" onUpdateDialogue={save} />);
        fireEvent.click(screen.getByRole('button', { name: /openVoiceGen/ }));
        const input = screen.getByPlaceholderText('dialoguePlaceholder');
        fireEvent.change(input, { target: { value: 'Changed dialogue' } });
        fireEvent.click(screen.getByRole('button', { name: 'regenerate' }));
        await waitFor(() => expect(save).toHaveBeenCalledWith('Changed dialogue'));
        expect(generate).not.toHaveBeenCalled();
        await act(async () => finishSave());
        await waitFor(() => expect(generate).toHaveBeenCalledWith('dialogue-project', 'save-audio', 1, 1, 50, 'happy; whisper'));
        expect(await screen.findByRole('alert')).toHaveTextContent('Voice provider unavailable');
        expect(input).toHaveValue('Changed dialogue');
        save.mockRejectedValueOnce(new Error('Save unavailable'));
        fireEvent.click(screen.getByRole('button', { name: 'regenerate' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('Save unavailable');
        expect(generate).toHaveBeenCalledOnce();
    });

    it('lets a dirty dialog close when a server generation is discovered and keeps the draft on reopen', async () => {
        const save = vi.fn();
        const view = render(<DialogueAudioRow {...props} frameId="remote-audio" onUpdateDialogue={save} />);
        fireEvent.click(screen.getByRole('button', { name: /openVoiceGen/ }));
        fireEvent.change(screen.getByPlaceholderText('dialoguePlaceholder'), { target: { value: 'Unsaved dialogue' } });
        view.rerender(<DialogueAudioRow {...props} frameId="remote-audio" generationStatus="processing" onUpdateDialogue={save} />);
        fireEvent.click(screen.getAllByRole('button', { name: 'close' }).at(-1)!);
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(save).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: /openVoiceGen/ }));
        expect(screen.getByPlaceholderText('dialoguePlaceholder')).toHaveValue('Unsaved dialogue');
    });

    it('uses a named dialog, prevents duplicate generation and stops audio when closing', async () => {
        const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
        const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
        let finish!: (value: unknown) => void;
        generate.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
        const view = render(<DialogueAudioRow {...props} frameId="pending-audio" />);
        try {
            const opener = screen.getByRole('button', { name: /openVoiceGen/ });
            opener.focus(); fireEvent.click(opener);
            const dialog = await screen.findByRole('dialog', { name: 'workbenchTitle' });
            const button = within(dialog).getByRole('button', { name: 'regenerate' });
            fireEvent.click(button); fireEvent.click(button);
            await waitFor(() => expect(generate).toHaveBeenCalledOnce());
            expect(button).toHaveAttribute('aria-disabled', 'true');
            expect(within(dialog).getAllByRole('button', { name: 'close' }).every(button => button.hasAttribute('disabled') || button.getAttribute('aria-disabled') === 'true')).toBe(true);
            await act(async () => finish({ frames: [{ id: 'pending-audio', audio_url: 'new.mp3' }] }));
            fireEvent.click(within(dialog).getByRole('button', { name: 'previewTts' }));
            await waitFor(() => expect(play).toHaveBeenCalledOnce());
            fireEvent.click(within(dialog).getAllByRole('button', { name: 'close' }).at(-1)!);
            await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
            expect(pause).toHaveBeenCalled();
        } finally { view.unmount(); play.mockRestore(); pause.mockRestore(); }
    });
});
