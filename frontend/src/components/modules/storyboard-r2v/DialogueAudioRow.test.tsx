import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DialogueAudioRow from './DialogueAudioRow';

const { generate, previewSfx, applySfx, revertSfx } = vi.hoisted(() => ({ generate: vi.fn(), previewSfx: vi.fn(), applySfx: vi.fn(), revertSfx: vi.fn() }));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    key === 'lineBudget' ? `${key}:${values?.required}:${values?.available}` : key }));
vi.mock('@/lib/api', () => ({ API_URL: 'http://localhost:17177', api: { generateLineAudio: generate, previewSfx, applySfx, revertSfx } }));

const props = { scriptId: 'dialogue-project', frameId: 'dialogue-frame', dialogue: 'Original dialogue', voiceId: 'voice', audioUrl: 'old.mp3', audioError: null,
    snapshotDialogue: 'Original dialogue', snapshotVoiceId: 'voice', snapshotInstructions: 'happy; whisper', onAudioUpdated: vi.fn() };

describe('Dialogue audio workbench', () => {
    beforeEach(() => { generate.mockReset(); previewSfx.mockReset(); applySfx.mockReset(); revertSfx.mockReset(); });

    it('shows calibrated timing and blocks a preview or application that would cut speech', () => {
        const line = { speaker: 'Sue', line: props.dialogue, start_seconds: 1,
            scheduled_start_seconds: 3, duration: 4, voice_id: 'voice', audio_url: 'line.mp3' };
        render(<DialogueAudioRow {...props} frameId="calibrated" dialogueLines={[line]}
            resolveSpeakerVoice={() => ({ id: 'voice', name: 'Sue' })} frameDurationSeconds={5}
            videoUrl="take.mp4" videoTaskId="take" onPreviewDub={vi.fn()} onApplyDub={vi.fn()}
            previewVideoUrl="preview.mp4" previewVideoTaskId="take" previewAudioUrl="old.mp3"
            previewSourceVideoUrl="take.mp4" previewOffsetMs={0} />);
        fireEvent.click(screen.getByRole('button', { name: /openWorkbench/ }));
        expect(screen.getByText('lineTiming')).toBeVisible();
        expect(screen.getByText('lineShifted')).toBeVisible();
        expect(screen.getByText('audioTooLong')).toBeVisible();
        expect(screen.getByRole('button', { name: 'preview' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'applyOverride' })).toBeDisabled();
    });

    it('requires old per-speaker tracks to be regenerated before previewing', () => {
        render(<DialogueAudioRow {...props} frameId="uncalibrated" dialogueLines={[
            { speaker: 'Sue', line: props.dialogue, start_seconds: 0, duration: 2,
                voice_id: 'voice', audio_url: 'line.mp3' },
        ]} resolveSpeakerVoice={() => ({ id: 'voice', name: 'Sue' })} frameDurationSeconds={5}
            videoUrl="take.mp4" videoTaskId="take" onPreviewDub={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: /openWorkbench/ }));
        expect(screen.getByText('staleHint')).toBeVisible();
        expect(screen.getByRole('button', { name: 'preview' })).toBeDisabled();
    });

    it('compares measured speech against the remaining line window', () => {
        render(<DialogueAudioRow {...props} frameId="line-window" dialogueLines={[
            { speaker: 'Sue', line: props.dialogue, start_seconds: 5, scheduled_start_seconds: 5,
                duration: 4, voice_id: 'voice', audio_url: 'line.mp3' },
        ]} resolveSpeakerVoice={() => ({ id: 'voice', name: 'Sue' })} frameDurationSeconds={8} />);
        fireEvent.click(screen.getByRole('button', { name: /openVoiceGen/ }));
        expect(screen.getByText('lineBudget:4.0:3.0')).toBeVisible();
    });

    it('does not approve old timing after editing an unsaved dialogue line', () => {
        render(<DialogueAudioRow {...props} frameId="dirty-timing" dialogueLines={[
            { speaker: 'Sue', line: props.dialogue, start_seconds: 0, scheduled_start_seconds: 0,
                duration: 2, voice_id: 'voice', audio_url: 'line.mp3' },
        ]} resolveSpeakerVoice={() => ({ id: 'voice', name: 'Sue' })} frameDurationSeconds={8}
            onUpdateDialogueLines={vi.fn()} videoUrl="take.mp4" videoTaskId="take" onPreviewDub={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: /openWorkbench/ }));
        fireEvent.change(screen.getByRole('textbox', { name: 'Sue' }), { target: { value: 'A much longer new dialogue' } });
        expect(screen.getByRole('button', { name: 'preview' })).toBeDisabled();
        expect(screen.getByText('lineBudgetUnmeasured')).toBeVisible();
    });

    it('does not count a negative preview offset twice after metadata loads', () => {
        render(<DialogueAudioRow {...props} frameId="negative-duration" dialogueLines={[
            { speaker: 'Sue', line: props.dialogue, start_seconds: 0, scheduled_start_seconds: 0,
                duration: 7, voice_id: 'voice', audio_url: 'line.mp3' },
        ]} resolveSpeakerVoice={() => ({ id: 'voice', name: 'Sue' })} frameDurationSeconds={10}
            videoUrl="take.mp4" videoTaskId="take" onPreviewDub={vi.fn()}
            previewVideoUrl="preview.mp4" previewVideoTaskId="take" previewOffsetMs={-1000} />);
        fireEvent.click(screen.getByRole('button', { name: /openWorkbench/ }));
        const video = screen.getByRole('dialog').querySelector('video')!;
        Object.defineProperty(video, 'duration', { value: 6 });
        fireEvent.loadedMetadata(video);
        expect(screen.getByRole('button', { name: 'preview' })).toBeDisabled();
        expect(screen.getByText('audioTooLong')).toBeVisible();
    });

    it('uploads the speaker reference and requests lip sync without applying the preview', async () => {
        const preview = vi.fn().mockResolvedValue(undefined), upload = vi.fn().mockResolvedValue(undefined), apply = vi.fn();
        const dub = { ...props, frameId: 'lip-sync', videoUrl: 'take.mp4', videoTaskId: 'take', allowLipSync: true,
            speakerName: 'Sue', onUploadSpeakerFace: upload, onPreviewDub: preview, onApplyDub: apply };
        const view = render(<DialogueAudioRow {...dub} />);
        fireEvent.click(screen.getByRole('button', { name: /openVoiceGen|openWorkbench/ }));
        const dialog = screen.getByRole('dialog');
        const file = new File(['face'], 'sue.png', { type: 'image/png' });
        fireEvent.change(dialog.querySelector('input[type=file]')!, { target: { files: [file] } });
        await waitFor(() => expect(upload).toHaveBeenCalledWith(file));
        const video = dialog.querySelector('video')!;
        Object.defineProperty(video, 'duration', { value: 8 }); fireEvent.loadedMetadata(video);
        await waitFor(() => expect(screen.getByRole('button', { name: 'matchLips' })).toBeEnabled());
        fireEvent.click(screen.getByRole('button', { name: 'matchLips' }));
        await waitFor(() => expect(preview).toHaveBeenCalledWith('take', 0, true));
        view.rerender(<DialogueAudioRow {...dub} dubGenerationStatus="pending" />);
        expect(screen.getByRole('button', { name: 'matchLips' })).toBeDisabled();
        expect(apply).not.toHaveBeenCalled();
    });

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

    it('does not advertise an applied dub when its audio snapshot is older', () => {
        render(<DialogueAudioRow {...props} frameId="stale-applied-dub" videoUrl="take.mp4" videoTaskId="take"
            audioUrl="new.mp3" dubbedVideoUrl="old-dub.mp4" dubbedVideoTaskId="take" dubbedAudioUrl="old.mp3"
            onPreviewDub={vi.fn()} onApplyDub={vi.fn()} onRevertDub={vi.fn()} />);
        expect(screen.queryByText('overridden')).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /openWorkbench/ }));
        expect(screen.getByText('dubStaleHint')).toBeVisible();
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

describe('per-speaker dialogue', () => {
    // Nothing synthesised yet, which is the state a freshly planned segment is in — the
    // voice has to come from the characters, not from a clip that does not exist.
    const lines = [
        { speaker: '中年测验员', line: '下一个，萧媚！', start_seconds: 0 },
        { speaker: '萧媚', line: '斗之气：七段！', start_seconds: 9, overruns_shot: true },
        { speaker: '旁白', line: '全场哗然。', start_seconds: 19 },
    ];
    const assigned: Record<string, { id: string; name: string }> = {
        中年测验员: { id: 'sage', name: 'Eldric Sage · 沧明子' },
        萧媚: { id: 'longyuan', name: '龙媛 (治愈女)' },
    };
    const resolveSpeakerVoice = (speaker: string) => assigned[speaker];

    it('shows each line with its speaker, time and the voice it will be spoken in', () => {
        // A segment is a conversation, and it used to be one text box read in one voice.
        render(<DialogueAudioRow {...props} dialogueLines={lines} resolveSpeakerVoice={resolveSpeakerVoice}
                                 onUpdateDialogueLines={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: /openVoiceGen|openWorkbench/ }));
        const dialog = screen.getByRole('dialog');

        expect(within(dialog).getByText('linesTitle')).toBeVisible();
        // Each speaker names its own box, once.
        for (const line of lines) expect(within(dialog).getByRole('textbox', { name: line.speaker })).toBeVisible();
        // The resolved voice is named, not printed as an opaque id.
        expect(within(dialog).getAllByText('lineVoice')).toHaveLength(2);
        // A speaker with nothing assigned is called out rather than silently borrowing one.
        expect(within(dialog).getByText('lineNoVoice')).toBeVisible();
        // These lines have no measurements; an old overrun flag cannot approve timing.
        expect(within(dialog).getAllByText('lineUnmeasured')).toHaveLength(3);
        expect(within(dialog).queryByText('lineOverruns')).not.toBeInTheDocument();
        // The single-blob editor is gone, so there is only one source of truth.
        expect(within(dialog).queryByText('stepDialogueText')).not.toBeInTheDocument();
    });

    it('saves an edited line without touching its speaker or its placement', async () => {
        const save = vi.fn().mockResolvedValue(undefined);
        render(<DialogueAudioRow {...props} dialogueLines={lines} resolveSpeakerVoice={resolveSpeakerVoice}
                                 onUpdateDialogueLines={save} />);
        fireEvent.click(screen.getByRole('button', { name: /openVoiceGen|openWorkbench/ }));
        const dialog = screen.getByRole('dialog');

        fireEvent.change(within(dialog).getByRole('textbox', { name: '萧媚' }), { target: { value: '斗之气：八段！' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'saveLines' }));
        await waitFor(() => expect(save).toHaveBeenCalledOnce());
        // Saving normalises each line's own direction; none of these has one, so they are
        // written as null and fall through to the segment's setting.
        expect(save.mock.calls[0][0]).toEqual([
            { ...lines[0], instructions: null },
            { ...lines[1], line: '斗之气：八段！', instructions: null },
            { ...lines[2], instructions: null },
        ]);
    });

    it('keeps the single text box for a frame that has no per-speaker lines', () => {
        render(<DialogueAudioRow {...props} onUpdateDialogue={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: /openVoiceGen|openWorkbench/ }));
        const dialog = screen.getByRole('dialog');
        expect(within(dialog).getByText('stepDialogueText')).toBeVisible();
        expect(within(dialog).queryByText('linesTitle')).not.toBeInTheDocument();
    });
});

describe('per-speaker workbench, reported from production', () => {
    const lines = [
        { speaker: '中年测验员', line: '下一个，萧媚！', start_seconds: 0, scheduled_start_seconds: 0, duration: 2, audio_url: 'a.mp3', voice_id: 'sage' },
        { speaker: '萧媚', line: '斗之气：七段！', start_seconds: 9, scheduled_start_seconds: 9, duration: 3, audio_url: 'b.mp3', voice_id: 'longyuan' },
    ];
    const assigned: Record<string, { id: string; name: string }> = {
        中年测验员: { id: 'sage', name: 'Eldric Sage · 沧明子' },
        萧媚: { id: 'longyuan', name: '龙媛 (治愈女)' },
    };
    const resolve = (speaker: string) => assigned[speaker];
    const dub = { ...props, dialogueLines: lines, resolveSpeakerVoice: resolve, frameDurationSeconds: 27,
        videoUrl: 'take.mp4', videoTaskId: 'take', onPreviewDub: vi.fn(), allowLipSync: true,
        speakerName: '萧炎', onUploadSpeakerFace: vi.fn(),
        snapshotInstructions: 'happy; whisper' };

    it('names every assigned voice instead of claiming the speaker has none', () => {
        // The row read `line.voice_id`, which is only written when a clip is made, so a
        // freshly planned segment showed "没有音色" for everyone who did have one.
        render(<DialogueAudioRow {...props} dialogueLines={lines.map(({ voice_id, ...rest }) => rest)}
                                 resolveSpeakerVoice={resolve} onUpdateDialogueLines={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: /openVoiceGen|openWorkbench/ }));
        const dialog = screen.getByRole('dialog');
        expect(within(dialog).getAllByText('lineVoice')).toHaveLength(2);
        expect(within(dialog).queryByText('lineNoVoice')).not.toBeInTheDocument();
    });

    it('does not report a freshly generated per-speaker track as out of date', () => {
        // The frame-level snapshot check compared one voice id against another and could
        // never match here, so 预听 and 匹配口型 stayed disabled for ever.
        render(<DialogueAudioRow {...dub} />);
        fireEvent.click(screen.getByRole('button', { name: /openVoiceGen|openWorkbench/ }));
        const dialog = screen.getByRole('dialog');
        expect(within(dialog).queryByText('staleHint')).not.toBeInTheDocument();
        expect(within(dialog).getByRole('button', { name: 'preview' })).toBeEnabled();
    });

    it('reports it as out of date once a voice is reassigned', () => {
        const reassigned = (speaker: string) => speaker === '萧媚'
            ? { id: 'longhua', name: '龙华' } : assigned[speaker];
        render(<DialogueAudioRow {...dub} resolveSpeakerVoice={reassigned} />);
        fireEvent.click(screen.getByRole('button', { name: /openVoiceGen|openWorkbench/ }));
        expect(within(screen.getByRole('dialog')).getByText('staleHint')).toBeVisible();
    });

    it('lets the audio be positioned from the segment length before the video reports one', () => {
        // The offset controls only knew the length the video element gave them, so they sat
        // at 0 and disabled — the "音频长度为 0" report.
        render(<DialogueAudioRow {...dub} />);
        fireEvent.click(screen.getByRole('button', { name: /openVoiceGen|openWorkbench/ }));
        const dialog = screen.getByRole('dialog');
        expect(within(dialog).getByRole('textbox', { name: /audioPosition/ })).toBeEnabled();
        expect(within(dialog).getByRole('button', { name: 'markStartPoint' })).toBeEnabled();
    });

    it('says why lip-sync cannot be aimed at a segment with several speakers', () => {
        render(<DialogueAudioRow {...dub} />);
        fireEvent.click(screen.getByRole('button', { name: /openVoiceGen|openWorkbench/ }));
        const dialog = screen.getByRole('dialog');
        expect(within(dialog).getByText('matchLipsMultiSpeaker')).toBeVisible();
        expect(within(dialog).queryByRole('button', { name: 'matchLips' })).not.toBeInTheDocument();
        // And it stops asking for a face that could only ever be right for one of them.
        expect(within(dialog).queryByRole('button', { name: /speakerFace/ })).not.toBeInTheDocument();
    });

    it('states that the emotion covers every speaker in the segment', () => {
        render(<DialogueAudioRow {...dub} />);
        fireEvent.click(screen.getByRole('button', { name: /openVoiceGen|openWorkbench/ }));
        expect(within(screen.getByRole('dialog')).getByText('emotionAppliesToAll')).toBeVisible();
    });
});

describe('per-line direction', () => {
    // One emotion for a whole segment reads as flat as one voice did: a segment is a
    // conversation, and 「耶！」 wants the opposite of 「唉…」 three shots later.
    const lines = [
        { speaker: '萧媚', line: '耶！', start_seconds: 0, instructions: '情绪：欢呼' },
        { speaker: '萧炎', line: '唉…', start_seconds: 12 },
    ];
    const directable = (speaker: string) => ({
        id: speaker === '萧媚' ? 'Cherry' : 'Moon', name: speaker, carriesDirection: true,
    });

    it('edits and saves each line’s own direction, clearing back to the segment’s', async () => {
        const save = vi.fn().mockResolvedValue(undefined);
        render(<DialogueAudioRow {...props} dialogueLines={lines} resolveSpeakerVoice={directable}
                                 onUpdateDialogueLines={save} />);
        fireEvent.click(screen.getByRole('button', { name: /openVoiceGen|openWorkbench/ }));
        const dialog = screen.getByRole('dialog');

        const fields = within(dialog).getAllByRole('textbox', { name: 'lineDirection' });
        expect(fields).toHaveLength(2);
        expect(fields[0]).toHaveValue('情绪：欢呼');
        // The line that wrote nothing shows the segment's setting as its placeholder
        // rather than pretending to have one of its own.
        expect(fields[1]).toHaveValue('');

        fireEvent.change(fields[1], { target: { value: '情绪：惋惜；演绎：只一声轻叹' } });
        fireEvent.change(fields[0], { target: { value: '   ' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'saveLines' }));

        await waitFor(() => expect(save).toHaveBeenCalledOnce());
        expect(save.mock.calls[0][0]).toEqual([
            { ...lines[0], instructions: null },
            { ...lines[1], instructions: '情绪：惋惜；演绎：只一声轻叹' },
        ]);
    });

    const ignored = (node: HTMLElement) => node.textContent?.includes('lineVoiceIgnoresDirection');

    it('says the direction will not take and refuses to generate it', () => {
        // Two thirds of the catalogue has no instruction parameter, so the emotion was
        // accepted, discarded, and the line came back flat with nothing saying why.
        const undirectable = (speaker: string) => ({ ...directable(speaker), carriesDirection: false });
        render(<DialogueAudioRow {...props} snapshotInstructions="" dialogueLines={lines}
                                 resolveSpeakerVoice={undirectable} onUpdateDialogueLines={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: /openVoiceGen|openWorkbench/ }));
        const dialog = screen.getByRole('dialog');

        // Named against the line that has a direction to lose, and only that one — with no
        // segment setting, the undirected line has nothing to be discarded.
        expect(within(dialog).getAllByRole('alert').filter(ignored)).toHaveLength(1);
        // Not paid for and then thrown away.
        expect(within(dialog).getByRole('button', { name: /generate/ })).toBeDisabled();
    });

    it('warns on every line once a segment-wide emotion is the one being discarded', () => {
        const undirectable = (speaker: string) => ({ ...directable(speaker), carriesDirection: false });
        render(<DialogueAudioRow {...props} snapshotInstructions="情绪：平稳" dialogueLines={lines}
                                 resolveSpeakerVoice={undirectable} onUpdateDialogueLines={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: /openVoiceGen|openWorkbench/ }));
        // Both lines are read with a direction now, and neither voice can act on it.
        expect(within(screen.getByRole('dialog')).getAllByRole('alert').filter(ignored)).toHaveLength(2);
    });

    it('stays quiet while the voice catalogue is unknown', () => {
        // A catalogue that failed to load must not put a warning on every line.
        const unknown = (speaker: string) => ({ id: 'x', name: speaker });
        render(<DialogueAudioRow {...props} dialogueLines={lines} resolveSpeakerVoice={unknown}
                                 onUpdateDialogueLines={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: /openVoiceGen|openWorkbench/ }));
        const dialog = screen.getByRole('dialog');
        expect(within(dialog).queryByText('lineVoiceIgnoresDirection')).not.toBeInTheDocument();
        expect(within(dialog).getByRole('button', { name: /generate/ })).toBeEnabled();
    });

    it('reports a track as out of date once a line’s direction is rewritten', () => {
        const generated = [
            { ...lines[0], scheduled_start_seconds: 0, duration: 2, audio_url: 'a.mp3', voice_id: 'Cherry', instructions_used: '情绪：欢呼' },
            { ...lines[1], scheduled_start_seconds: 9, duration: 2, audio_url: 'b.mp3', voice_id: 'Moon', instructions_used: '' },
        ];
        const fresh = { ...props, dialogueLines: generated, resolveSpeakerVoice: directable,
            audioUrl: 'track.mp3', snapshotInstructions: '' };
        render(<DialogueAudioRow {...fresh} />);
        fireEvent.click(screen.getByRole('button', { name: /openVoiceGen|openWorkbench/ }));
        expect(within(screen.getByRole('dialog')).queryByText('staleHint')).not.toBeInTheDocument();
        cleanup();

        const rewritten = [{ ...generated[0], instructions: '情绪：自嘲' }, generated[1]];
        render(<DialogueAudioRow {...fresh} dialogueLines={rewritten} />);
        fireEvent.click(screen.getByRole('button', { name: /openVoiceGen|openWorkbench/ }));
        expect(within(screen.getByRole('dialog')).getByText('staleHint')).toBeVisible();
    });

    it('does not date a clip that never recorded what it was read with', () => {
        // Every episode made before the direction was tracked would otherwise read as
        // permanently stale — and with an undirectable voice, regeneration is refused.
        const legacy = [{ ...lines[0], scheduled_start_seconds: 0, duration: 2, audio_url: 'a.mp3', voice_id: 'Cherry' },
                        { ...lines[1], scheduled_start_seconds: 9, duration: 2, audio_url: 'b.mp3', voice_id: 'Moon' }];
        render(<DialogueAudioRow {...props} dialogueLines={legacy} resolveSpeakerVoice={directable}
                                 audioUrl="track.mp3" snapshotInstructions="" />);
        fireEvent.click(screen.getByRole('button', { name: /openVoiceGen|openWorkbench/ }));
        expect(within(screen.getByRole('dialog')).queryByText('staleHint')).not.toBeInTheDocument();
    });
});
