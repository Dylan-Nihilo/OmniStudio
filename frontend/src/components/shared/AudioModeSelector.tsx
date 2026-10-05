"use client";
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Mic, Volume2, RotateCcw } from 'lucide-react';
import { Button, SelectField, TextField } from '@omnistudio/ui';
import type { AudioMode, AudioPolicy, VideoAudioCapabilities } from '@/lib/audioPolicy';

interface Props {
    policy: AudioPolicy;
    capabilities: VideoAudioCapabilities;
    onChange: (policy: AudioPolicy) => void;
    disabled?: boolean;
    hasOverride?: boolean;
    onReset?: () => void;
    onSetDefault?: () => void;
    externalAudioInput?: boolean;
}
export default function AudioModeSelector({ policy, capabilities, onChange, disabled, hasOverride,
    onReset, onSetDefault, externalAudioInput }: Props) {
    const t = useTranslations('audioWorkflow');
    const [audioUrl, setAudioUrl] = useState(policy.audio_url ?? '');
    useEffect(() => { setAudioUrl(policy.audio_url ?? ''); }, [policy.audio_url]);
    const supported = capabilities.modes.includes(policy.mode);
    const choose = (mode: AudioMode) => onChange({ ...policy, mode });
    const radio = (mode: AudioMode) => <label key={mode} className="flex min-w-0 items-center gap-2 rounded-md border border-glass-border px-3 py-2 text-sm has-[:checked]:border-primary/60 has-[:checked]:bg-primary/10 has-[:disabled]:opacity-50">
        <input type="radio" checked={policy.mode === mode} disabled={disabled || !capabilities.modes.includes(mode)}
            onChange={() => choose(mode)} aria-label={t(mode)} className="accent-primary" />
        {mode === 'post' ? <Mic size={15} /> : mode === 'native' ? <Volume2 size={15} /> : null}
        <span>{t(mode)}</span>
    </label>;
    return <section className="space-y-2" aria-label={t('title')}>
        <div className="flex items-center justify-between gap-2 text-sm text-text-secondary">
            <span>{t('title')}</span>
            {onReset && hasOverride && <span title={t('inherit')}><Button variant="quiet" isDisabled={disabled} onPress={onReset} aria-label={t('inherit')}><RotateCcw size={14} /></Button></span>}
        </div>
        <div role="radiogroup" aria-label={t('title')} className="grid grid-cols-2 gap-2">
            {radio('post')}{radio('native')}
        </div>
        {!supported && <p role="alert" className="text-xs text-status-failed-fg">{t('unsupported')}</p>}
        {policy.mode === 'native' && <p className="text-xs text-text-muted">{t('nativeLimit')}</p>}
        {policy.mode === 'post' && <SelectField label={t('originalAudio')} value={policy.original_audio} isDisabled={disabled}
            onChange={key => onChange({ ...policy, original_audio: String(key) as AudioPolicy['original_audio'] })}
            options={(['drop', 'remove_vocals', 'keep'] as const).map(id => ({ id, label: t(id) }))} />}
        <details open={policy.mode === 'driven' || policy.mode === 'silent'} className="text-sm">
            <summary className="cursor-pointer text-text-muted">{t('advanced')}</summary>
            <div role="radiogroup" aria-label={t('advanced')} className="mt-2 grid grid-cols-2 gap-2">{radio('driven')}{radio('silent')}</div>
            {policy.mode === 'driven' && <div className="mt-2 space-y-2">
                <p className="text-xs text-text-muted">{t(capabilities.input_kind === 'reference' ? 'referenceLimit' : 'timingLimit')}</p>
                {!externalAudioInput && <TextField label={t('audioUrl')} value={audioUrl} isDisabled={disabled}
                    onChange={setAudioUrl} onBlur={() => { if (audioUrl !== (policy.audio_url ?? '')) onChange({ ...policy, audio_url: audioUrl.trim() }); }} type="url" />}
            </div>}
        </details>
        {onSetDefault && <Button variant="quiet" isDisabled={disabled} onPress={onSetDefault}>{t('setDefault')}</Button>}
    </section>;
}
