import { describe, expect, it } from 'vitest';
import { appliedDubVideoUrl, shotAudioPolicy, type AudioPolicy } from '@/lib/audioPolicy';
import { frameToShotNode } from '@/components/modules/storyboard-r2v/shotNodeHelpers';

describe('shot audio intent', () => {
    it('preserves legacy native intent until a project default is established', () => {
        const legacy = { audio_mode: 'native' as const, audios: [] };
        expect(shotAudioPolicy(null, null, legacy).mode).toBe('native');
        expect(shotAudioPolicy({ mode: 'post', original_audio: 'drop' }, null, legacy).mode).toBe('post');
    });
    it('previews the source after switching a previously dubbed shot to native', () => {
        const frame = { id: 'f', selected_video_id: 't', video_url: 'source.mp4',
            audio_policy_override: { mode: 'native', original_audio: 'drop' },
            dubbed_video_url: 'dub.mp4', dubbed_video_task_id: 't',
            dubbed_audio_policy: { mode: 'post', original_audio: 'drop' } };
        expect(frameToShotNode(frame, []).videoUrl).toBe('source.mp4');
    });
    it('uses applied native narration only while its policy and audio still match', () => {
        const policy: AudioPolicy = { mode: 'native', original_audio: 'drop' };
        const frame = { id: 'f', selected_video_id: 't', video_url: 'source.mp4', audio_url: 'voice.wav',
            dubbed_video_url: 'narrated.mp4', dubbed_video_task_id: 't',
            dubbed_audio_url: 'voice.wav', dubbed_audio_policy: policy };
        expect(frameToShotNode(frame, [], 'direct_r2v', policy).videoUrl).toBe('narrated.mp4');
        expect(frameToShotNode({ ...frame, audio_url: 'new.wav' }, [], 'direct_r2v', policy).videoUrl).toBe('source.mp4');
        expect(appliedDubVideoUrl(frame, policy, 'different-take')).toBeUndefined();
        expect(appliedDubVideoUrl(frame, { mode: 'post', original_audio: 'drop' }, 't')).toBeUndefined();
    });
});
