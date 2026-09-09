import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DialogueAudioRow from './DialogueAudioRow';

const { generate, previewSfx, applySfx, revertSfx } = vi.hoisted(() => ({ generate: vi.fn(), previewSfx: vi.fn(), applySfx: vi.fn(), revertSfx: vi.fn() }));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@/lib/api', () => ({ API_URL: 'http://localhost:17177', api: { generateLineAudio: generate, previewSfx, applySfx, revertSfx } }));

const props = { scriptId: 'dialogue-project', frameId: 'dialogue-frame', dialogue: 'Original dialogue', voiceId: 'voice', audioUrl: 'old.mp3', audioError: null,
    snapshotDialogue: 'Original dialogue', snapshotVoiceId: 'voice', snapshotInstructions: 'happy; whisper', onAudioUpdated: vi.fn() };

describe('Dialogue audio workbench', () => {
    beforeEach(() => { generate.mockReset(); previewSfx.mockReset(); applySfx.mockReset(); revertSfx.mockReset(); });

    it('previews SFX before applying it and can discard the preview', async () => {
        previewSfx.mockResolvedValueOnce({ frames: [{ id: 'sfx-frame', sfx_url: 'old.wav', preview_sfx_url: 'preview.wav' }] });
        applySfx.mockResolvedValueOnce({ frames: [{ id: 'sfx-frame', sfx_url: 'preview.wav', preview_sfx_url: null }] });
        revertSfx.mockResolvedValueOnce({ frames: [{ id: 'sfx-frame', sfx_url: 'old.wav', preview_sfx_url: null }] });
        const view = render(<DialogueAudioRow {...props} frameId="sfx-frame" actionDescription="Door slam" videoUrl="take.mp4" onPreviewSfx={async () => { await previewSfx(); }} onApplySfx={async () => { await applySfx(); }} onRevertSfx={async () => { await revertSfx(); }} />);
        fireEvent.click(screen.getByRole('button', { name: /openVoiceGen/ }));
        fireEvent.click(screen.getByRole('button', { name: 'previewSfx' }));
        await waitFor(() => expect(previewSfx).toHaveBeenCalledOnce());
        view.rerender(<DialogueAudioRow {...props} frameId="sfx-frame" actionDescription="Door slam" videoUrl="take.mp4" previewSfxUrl="preview.wav" sfxUrl="old.wav" onPreviewSfx={async () => { await previewSfx(); }} onApplySfx={async () => { await applySfx(); }} onRevertSfx={async () => { await revertSfx(); }} />);
        fireEvent.click(screen.getByRole('button', { name: 'applySfx' }));
        await waitFor(() => expect(applySfx).toHaveBeenCalledOnce());
        fireEvent.click(screen.getByRole('button', { name: 'discardSfx' }));
        await waitFor(() => expect(revertSfx).toHaveBeenCalledOnce());
    });

    it('recognizes renewed OSS signatures while retaining media version checks', () => {
        const current = 'https://media.example.test/voice.mp3?OSSAccessKeyId=test&Expires=20&Signature=new&version=1';
        const dub = { ...props, frameId: 'dub-signed', audioUrl: current, videoUrl: 'take.mp4', videoTaskId: 'take', previewVideoUrl: 'preview.mp4', previewAudioUrl: current.replace('20', '10').replace('new', 'old'), previewSourceVideoUrl: 'take.mp4', previewVideoTaskId: 'take', previewOffsetMs: 0, onPreviewDub: vi.fn(), onApplyDub: vi.fn() };
        const view = render(<DialogueAudioRow {...dub} />);
        fireEvent.click(screen.getByRole('button', { name: /openWorkbench/ }));
        expect(screen.getByRole('button', { name: 'applyOverride' })).toBeEnabled();
        view.rerender(<DialogueAudioRow {...dub} audioUrl={current.replace('version=1', 'version=2')} />);
        expect(screen.getByRole('button', { name: 'applyOverride' })).toBeDisabled();
    });

    it('marks audio stale and regenerates with changed voice controls', async () => {
        generate.mockResolvedValueOnce({ frames: [{ id: 'voice-controls', audio_url: 'new.mp3' }] });
        const view = render(<DialogueAudioRow {...props} frameId="voice-controls" voiceSpeed={1.2} voicePitch={0.9} voiceVolume={70} snapshotSpeed={1} snapshotPitch={1} snapshotVolume={50} onUpdateDialogue={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: /openVoiceGen/ }));
        expect(screen.getByText('staleHint')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'regenerate' }));
        await waitFor(() => expect(generate).toHaveBeenCalledWith('dialogue-project', 'voice-controls', 1.2, 0.9, 70, 'happy; whisper'));
        view.unmount();
    });

    it('invalidates a preview after audio replacement and supports earlier audio offsets', async () => {
        const dub = { ...props, frameId: 'dub-source', videoUrl: 'take.mp4', videoTaskId: 'take', previewVideoUrl: 'preview.mp4', previewAudioUrl: 'old.mp3', previewSourceVideoUrl: 'take.mp4', previewVideoTaskId: 'take', previewOffsetMs: 0, onPreviewDub: vi.fn(), onApplyDub: vi.fn() };
        const view = render(<DialogueAudioRow {...dub} />);
        fireEvent.click(screen.getByRole('button', { name: /openWorkbench/ }));
        const apply = screen.getByRole('button', { name: 'applyOverride' });
        expect(apply).toBeEnabled();
        view.rerender(<DialogueAudioRow {...dub} audioUrl="replacement.mp3" />);
        expect(apply).toBeDisabled();
        const video = screen.getByRole('dialog').querySelector('video')!;
        Object.defineProperty(video, 'duration', { value: 1 });
        fireEvent.loadedMetadata(video);
        fireEvent.click(screen.getByRole('button', { name: 'earlier' }));
        expect(screen.getByRole('textbox', { name: 'audioPosition (ms)' })).toHaveValue('-50');
    });

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
