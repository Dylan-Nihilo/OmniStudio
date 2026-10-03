export type AudioMode = 'post' | 'native' | 'driven' | 'silent';
export interface AudioPolicy {
    mode: AudioMode;
    audio_url?: string | null;
    original_audio: 'drop' | 'remove_vocals' | 'keep';
}
export interface VideoAudioCapabilities {
    backend: string;
    modes: AudioMode[];
    input_kind?: 'reference' | 'timing' | null;
    can_disable_native: boolean;
}
export const DEFAULT_AUDIO_POLICY: AudioPolicy = { mode: 'post', original_audio: 'drop' };
export const UNKNOWN_AUDIO_CAPABILITIES: VideoAudioCapabilities = {
    backend: 'unknown', modes: ['post', 'silent'], can_disable_native: false,
};
export function shotAudioPolicy(project?: AudioPolicy | null, override?: AudioPolicy | null,
    legacy?: { audio_mode: AudioMode; audios: { url: string }[] } | null): AudioPolicy {
    return override ?? project ?? (legacy ? { mode: legacy.audio_mode, audio_url: legacy.audios[0]?.url, original_audio: 'drop' } : DEFAULT_AUDIO_POLICY);
}
export function audioPoliciesEqual(left: AudioPolicy, right: AudioPolicy): boolean {
    return left.mode === right.mode && (left.audio_url ?? '') === (right.audio_url ?? '')
        && left.original_audio === right.original_audio;
}

interface AudioPreviewFrame {
    selected_video_id?: string | null;
    audio_policy_override?: AudioPolicy | null;
    omni_reference_settings?: { audio_mode: AudioMode; audios: { url: string }[] } | null;
    audio_url?: string | null;
    dubbed_video_url?: string | null;
    dubbed_video_task_id?: string | null;
    dubbed_audio_policy?: AudioPolicy | null;
    dubbed_audio_url?: string | null;
}

export function appliedDubVideoUrl(frame: AudioPreviewFrame | null | undefined, project?: AudioPolicy | null,
    taskId?: string | null): string | undefined {
    if (!frame) return undefined;
    const candidate = taskId ?? frame.selected_video_id;
    if (candidate && frame.dubbed_video_task_id !== candidate) return undefined;
    const policy = shotAudioPolicy(project, frame.audio_policy_override, frame.omni_reference_settings);
    if (policy.mode === 'silent' || policy.mode === 'driven') return undefined;
    const snapshot = frame.dubbed_audio_policy;
    const current = snapshot ? audioPoliciesEqual(snapshot, policy) && frame.dubbed_audio_url === frame.audio_url
        : policy.mode === 'post';
    return current ? frame.dubbed_video_url ?? undefined : undefined;
}
