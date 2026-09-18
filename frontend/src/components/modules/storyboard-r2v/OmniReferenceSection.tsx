"use client";
import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, SelectField, TextAreaField } from '@omnistudio/ui';
import { api } from '@/lib/api';
import { getAssetUrl } from '@/lib/utils';
import { publicMediaUrl, omniReferenceLimits, type OmniReferenceSettings } from '@/lib/omniReferences';
import styles from './OmniReferenceSection.module.css';

interface Props {
    value: OmniReferenceSettings;
    supported: boolean;
    readOnly?: boolean;
    imageCount: number;
    onChange: (value: OmniReferenceSettings) => void;
    onPendingChange: (pending: boolean) => void;
}
export default function OmniReferenceSection({ value, supported, readOnly, imageCount, onChange, onPendingChange }: Props) {
    const t = useTranslations('omniReference');
    const limits = omniReferenceLimits();
    const [videoUrl, setVideoUrl] = useState('');
    const [audioUrl, setAudioUrl] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const active = useRef(true);
    const latest = useRef(value); latest.current = value;
    const input = useRef<HTMLInputElement>(null);
    useEffect(() => { active.current = true; return () => { active.current = false; onPendingChange(false); }; }, []);
    function add(kind: 'videos' | 'audios', raw: string) {
        const url = raw.trim();
        if (!publicMediaUrl(url)) { setError(t('httpsRequired')); return; }
        if (value[kind].some(item => item.url === url)) { setError(t('duplicate')); return; }
        if (value[kind].length >= limits[kind]) { setError(t('limit', { count: limits[kind] })); return; }
        onChange({ ...value, [kind]: [...value[kind], { url, purpose: '' }], ...(kind === 'audios' ? { audio_mode: 'driven' } : {}) });
        setError(''); if (kind === 'videos') setVideoUrl(''); else setAudioUrl('');
    }
    async function upload(file?: File) {
        if (!file) return;
        if (!/\.(mp4|mov)$/i.test(file.name) || file.size > 50 * 1024 * 1024 || !file.size) { setError(t('videoLimits')); return; }
        setBusy(true); onPendingChange(true); setError('');
        try {
            const result = await api.uploadFile(file);
            if (!active.current) return;
            onChange({ ...latest.current, videos: [...latest.current.videos, { url: result.url, purpose: '' }] });
        } catch { if (active.current) setError(t('uploadFailed')); }
        finally { if (active.current) { setBusy(false); onPendingChange(false); } }
    }
    function remove(kind: 'videos' | 'audios', index: number) {
        const items = value[kind].filter((_, i) => i !== index);
        onChange({ ...value, [kind]: items, ...(kind === 'audios' && !items.length && value.audio_mode === 'driven' ? { audio_mode: 'post' } : {}) });
    }
    return <section className={styles.root} aria-label={t('title')}>
        <header><h3>{t('title')}</h3><span>{t('imageCount', { count: imageCount })}</span></header>
        <p className={styles.hint}>{t('intro')}</p>
        {!supported ? <><p role="alert">{t('unsupported')}</p><Button variant="quiet" isDisabled={readOnly} onPress={() => onChange({ videos: [], audios: [], audio_mode: 'post' })}>{t('clear')}</Button></> :
        <fieldset disabled={readOnly || busy} className={styles.fields}>
            <SelectField label={t('sound')} value={value.audio_mode} isDisabled={readOnly || busy}
                onChange={key => onChange({ ...value, audio_mode: String(key) as OmniReferenceSettings['audio_mode'] })}
                options={(['native', 'driven', 'post', 'silent'] as const).map(id => ({ id, label: t(id) }))} />
            {value.audio_mode === 'silent' && <p className={styles.hint}>{t('silentHint')}</p>}
            {error && <p role="alert" className={styles.error}>{error}</p>}
            {(['videos', 'audios'] as const).map(kind => <div key={kind} className={styles.group}>
                <h4>{t(kind)} <span>{value[kind].length}/{limits[kind]}</span></h4>
                <p className={styles.hint}>{t(kind === 'videos' ? 'videoHint' : 'audioHint')}</p>
                {value[kind].map((item, index) => <div className={styles.reference} key={`${kind}-${index}-${item.url}`}>
                    <div className={styles.row}><strong>{t(kind === 'videos' ? 'videoNumber' : 'audioNumber', { number: index + 1 })}</strong>
                        <Button variant="quiet" onPress={() => remove(kind, index)} aria-label={t('remove', { number: index + 1, type: t(kind) })}>{t('removeShort')}</Button></div>
                    {kind === 'videos' ? <video src={getAssetUrl(item.url)} controls preload="metadata" /> : <audio src={getAssetUrl(item.url)} controls preload="none" />}
                    <TextAreaField label={t('purpose')} rows={2} maxLength={500} value={item.purpose} placeholder={t(kind === 'videos' ? 'videoPurpose' : 'audioPurpose')}
                        onChange={purpose => onChange({ ...value, [kind]: value[kind].map((old, i) => i === index ? { ...old, purpose } : old) })} />
                </div>)}
                {value[kind].length < limits[kind] && <div className={styles.add}>
                    <label>{t('urlLabel', { type: t(kind) })}<input type="url" maxLength={4096} value={kind === 'videos' ? videoUrl : audioUrl}
                        placeholder="https://…" onChange={event => kind === 'videos' ? setVideoUrl(event.target.value) : setAudioUrl(event.target.value)} /></label>
                    <div className={styles.row}><Button variant="secondary" onPress={() => add(kind, kind === 'videos' ? videoUrl : audioUrl)}>{t('add', { type: t(kind) })}</Button>
                        {kind === 'videos' && <><input ref={input} className={styles.file} type="file" accept="video/mp4,video/quicktime,.mp4,.mov"
                            onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; void upload(file); }} />
                            <Button variant="quiet" isDisabled={busy || readOnly} onPress={() => input.current?.click()}>{t(busy ? 'uploading' : 'uploadVideo')}</Button></>}
                    </div>
                </div>}
            </div>)}
            {value.audio_mode === 'driven' && !value.audios.length && <p role="alert" className={styles.error}>{t('audioRequired')}</p>}
            {value.audio_mode !== 'driven' && value.audios.length > 0 && <p className={styles.hint}>{t('audioInactive')}</p>}
            <p className={styles.hint}>{t('saveHint')}</p>
        </fieldset>}
    </section>;
}
