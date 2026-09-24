"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Pause, Play, RefreshCw, Upload } from 'lucide-react';
import { Button, Dialog, TextAreaField } from '@omnistudio/ui';
import { useTranslations } from 'next-intl';
import { api } from '@/lib/api';
import type { ProductionReview } from '@/lib/productionPlan';
import type { Project } from '@/store/projectStore';
import PreviewImage from '@/components/shared/preview/PreviewImage';
import PreviewVideo from '@/components/shared/preview/PreviewVideo';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import { getAssetUrl } from '@/lib/utils';
import styles from './ProductionPlanDialog.module.css';

type Preview = NonNullable<Project['production_previews']>[number];
const imageUrl = (frame?: Preview) => frame?.t2i_image_urls?.[frame.t2i_selected_index ?? 0] || frame?.rendered_image_url || frame?.image_url;

type PreviewPollOptions = {
    load: () => Promise<Pick<Project, 'production_previews'>>;
    previewId: string;
    onUpdate: (patch: Partial<Project>) => void;
    pollIntervalMs?: number;
    timeoutMs?: number;
};

/**
 * A render request can outlive the browser's HTTP timeout. In that case the
 * backend keeps working and the only safe recovery is to observe the saved
 * preview state until it reaches a terminal state. Keeping this helper
 * outside the component also makes the timeout path independently testable.
 */
export async function waitForPreviewCompletion({
    load,
    previewId,
    onUpdate,
    pollIntervalMs = 2500,
    timeoutMs = 15 * 60 * 1000,
}: PreviewPollOptions): Promise<Preview | undefined> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() <= deadline) {
        const updated = await load();
        onUpdate({ production_previews: updated.production_previews });
        const preview = updated.production_previews?.find(item => item.id === previewId);
        if (!preview) return undefined;
        const status = preview.image_generation_status;
        if (imageUrl(preview) || status === 'failed') return preview;
        if (Date.now() >= deadline) break;
        await new Promise(resolve => window.setTimeout(resolve, Math.min(pollIntervalMs, Math.max(0, deadline - Date.now()))));
    }
    return undefined;
}

function isRequestTimeout(error: any) {
    return error?.code === 'ECONNABORTED' || error?.code === 'ETIMEDOUT' || /timeout/i.test(String(error?.message || ''));
}

function errorMessage(error: any) {
    const detail = error?.response?.data?.detail;
    if (typeof detail === 'string') return detail;
    if (detail?.message) return detail.message;
    // Transport failures need the localized action/retry explanation below;
    // Axios' generic English status text does not tell creators what to do.
    return error?.isAxiosError ? undefined : error?.message;
}
interface Props {
    project: Project;
    isOpen: boolean;
    onClose: () => void;
    beforeChange: () => Promise<boolean>;
    onUpdate: (patch: Partial<Project>) => void;
    readOnly?: boolean;
}
export default function ProductionPrevisDialog({ project, isOpen, onClose, beforeChange, onUpdate, readOnly = false }: Props) {
    const t = useTranslations('productionPlan');
    const tOmni = useTranslations('omniReference');
    const [reviews, setReviews] = useState<ProductionReview[]>([]);
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState('');
    const [refreshError, setRefreshError] = useState('');
    const [confirmClose, setConfirmClose] = useState(false);
    const [prompts, setPrompts] = useState<Record<string, string>>({});
    const [playing, setPlaying] = useState(false);
    const [playIndex, setPlayIndex] = useState(0);
    const [clearTarget, setClearTarget] = useState<Preview | null>(null);
    const running = useRef(false);
    const mutationVersion = useRef(0);
    const stopBulk = useRef(false);
    const mounted = useRef(true);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; stopBulk.current = true; }; }, []);
    useEffect(() => { if (readOnly) stopBulk.current = true; }, [readOnly]);
    const plan = project.production_plan;
    const previews = project.production_previews ?? [];
    const allShots = plan?.segments.flatMap(segment => segment.shots) ?? [];
    const missing = previews.filter(preview => !imageUrl(preview));
    const imageRunning = previews.some(preview => preview.image_generation_status === 'processing' || preview.image_generation_status === 'pending');
    const refresh = useCallback(async () => {
        const version = mutationVersion.current;
        const [updated, review] = await Promise.all([api.getProject(project.id), api.reviewProductionPlan(project.id)]);
        if (!mounted.current || version !== mutationVersion.current) return;
        onUpdate({ production_previews: updated.production_previews, _revision: updated._revision });
        setReviews(review.segments);
        setRefreshError('');
    }, [project.id, onUpdate]);
    useEffect(() => {
        if (isOpen) void refresh().catch(e => { if (mounted.current) setRefreshError(errorMessage(e) || t('refreshFailed')); });
        else { setPlaying(false); stopBulk.current = true; }
    }, [isOpen, refresh, t]);
    useEffect(() => {
        if (!isOpen || (!busy && !imageRunning)) return;
        const timer = window.setInterval(() => { void refresh().catch(e => { if (mounted.current) setRefreshError(errorMessage(e) || t('refreshFailed')); }); }, 2500);
        return () => window.clearInterval(timer);
    }, [isOpen, busy, imageRunning, refresh, t]);
    useEffect(() => {
        if (!playing || !allShots[playIndex]) return;
        const timer = window.setTimeout(() => {
            if (playIndex + 1 < allShots.length) setPlayIndex(playIndex + 1);
            else setPlaying(false);
        }, allShots[playIndex].duration * 1000);
        return () => window.clearTimeout(timer);
    }, [playing, playIndex, allShots]);
    async function run(key: string, action: () => Promise<void>) {
        if (running.current || readOnly) return;
        running.current = true; mutationVersion.current += 1; setBusy(key); setError('');
        try { await action(); }
        catch (e) { if (mounted.current) setError(errorMessage(e) || t('imageFailed')); }
        finally { mutationVersion.current += 1; running.current = false; if (mounted.current) { setBusy(null); void refresh().catch(e => { if (mounted.current) setRefreshError(errorMessage(e) || t('refreshFailed')); }); } }
    }
    async function generate(preview: Preview) {
        if (!await beforeChange() || !mounted.current) return;
        let rendered: Preview | undefined;
        try {
            const result = await api.renderFrame(project.id, preview.id, null, prompts[preview.id] ?? preview.image_prompt ?? '', 1);
            if (!mounted.current) return;
            onUpdate({ production_previews: result.production_previews });
            rendered = result.production_previews?.find((frame: Preview) => frame.id === preview.id);
        } catch (error) {
            if (!isRequestTimeout(error) || !mounted.current) throw error;
            rendered = await waitForPreviewCompletion({
                load: async () => api.getProject(project.id),
                previewId: preview.id,
                onUpdate,
            });
            if (!mounted.current) return;
        }
        if (!rendered || !imageUrl(rendered) || rendered.image_generation_status === 'failed') throw new Error(rendered?.image_error || t('imageFailed'));
        setPrompts(current => { const next = { ...current }; delete next[preview.id]; return next; });
    }
    async function upload(preview: Preview, file?: File) {
        if (!file) return;
        if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 8 * 1024 * 1024) { setError(t('uploadInvalid')); return; }
        await run(preview.id, async () => {
            const uploaded = await api.uploadT2IFrame(project.id, preview.id, file);
            if (mounted.current) onUpdate({ production_previews: previews.map(p => p.id === preview.id ? uploaded : p) });
        });
    }
    const playingShot = allShots[playIndex];
    const playingPreview = previews.find(preview => preview.id === playingShot?.id);
    const hasDirtyPrompts = previews.some(preview => prompts[preview.id] !== undefined && prompts[preview.id] !== preview.image_prompt);
    const atomicBusy = !!busy && busy !== 'all' && !previews.some(preview => busy === preview.id && imageRunning);
    function close() {
        if (atomicBusy) return;
        if (hasDirtyPrompts) { setConfirmClose(true); return; }
        stopBulk.current = true; onClose();
    }
    return <>
    <Dialog isOpen={isOpen} onOpenChange={open => { if (!open) close(); }} title={t('previsTitle')} closeLabel={t('close')} className={styles.dialog} isDismissable={!atomicBusy}
        footer={<Button isDisabled={atomicBusy} onPress={close}>{t('goGenerate')}</Button>}>
        {refreshError && <p role="alert" className={styles.error}>{refreshError}</p>}
        <Button variant="quiet" onPress={() => void refresh().catch(e => { if (mounted.current) setRefreshError(errorMessage(e) || t('refreshFailed')); })}><RefreshCw size={14} />{t('checkAgain')}</Button>
        {!plan ? <p>{t('noActivePlan')}</p> : <fieldset disabled={readOnly} className={styles.stack}>
            <p className={styles.hint}>{t(readOnly ? 'readOnly' : 'previsIntro')}</p>
            {error && <p role="alert" className={styles.error}>{error}</p>}
            <div className={styles.tools}>
                {missing.length > 0 && <Button variant="secondary" isDisabled={!!busy || imageRunning} isPending={busy === 'all'} onPress={() => void run('all', async () => {
                    stopBulk.current = false;
                    for (const preview of previews) {
                        if (stopBulk.current || !mounted.current) break;
                        if (!imageUrl(preview)) await generate(preview);
                    }
                })}>{t('generateMissing', { count: missing.length })}</Button>}
                {busy === 'all' && <Button variant="quiet" onPress={() => { stopBulk.current = true; }}>{t('stopFollowing')}</Button>}
                <Button variant="quiet" isDisabled={missing.length > 0 || !allShots.length} onPress={() => { if (!playing) setPlayIndex(0); setPlaying(!playing); }}>{playing ? <Pause size={14} /> : <Play size={14} />}{t(playing ? 'pausePreview' : 'playPreview')}</Button>
            </div>
            {playing && playingShot && <section className={styles.animatic} aria-label={t('playPreview')}>
                {imageUrl(playingPreview) && <PreviewImage src={imageUrl(playingPreview)!} alt={playingShot.title} noLightbox />}
                <p>{playIndex + 1} / {allShots.length} · {playingShot.title} · {playingShot.duration}s</p>
                {playingShot.dialogue.map((line, i) => <p key={i}>{line.speaker}：{line.line}</p>)}
            </section>}
            <p className={styles.hint}>{plan.continuity_rules}</p>
            {plan.segments.map((segment, si) => {
                const report = reviews.find(review => review.segment_id === segment.id);
                const omni = project.frames.find(frame => frame.id === segment.frame_id)?.omni_reference_settings;
                return <section key={segment.id} className={styles.segment}>
                    <div className={styles.segmentHeader}><h3>{t('segmentNumber', { number: si + 1 })} · {segment.title}</h3><span className={styles.hint}>{t(report?.ready ? 'confirmed' : report?.changed_after_review ? 'needsReview' : 'awaitReview')}</span></div>
                    <div className={styles.pair}><p className={styles.hint}><strong>{t('startState')}：</strong>{segment.start_state}</p><p className={styles.hint}><strong>{t('endState')}：</strong>{segment.end_state}</p></div>
                    {segment.connection && <p className={styles.hint}>{segment.connection}</p>}
                    {report?.previous_video_url && <details><summary>{t('previousTake')}</summary><PreviewVideo src={report.previous_video_url} alt={t('previousTake')} className={styles.previousVideo} /></details>}
                    {omni && <details><summary>{tOmni('reviewTitle')} · {tOmni(omni.audio_mode)}</summary>
                        {omni.videos.map((item: { url: string; purpose: string }, index: number) => <div key={item.url}><p>{tOmni('videoNumber', { number: index + 1 })} · {item.purpose || tOmni('videoPurpose')}</p><PreviewVideo src={item.url} alt={tOmni('videoNumber', { number: index + 1 })} className={styles.previousVideo} /></div>)}
                        {omni.audio_mode === 'driven' && omni.audios.map((item: { url: string; purpose: string }, index: number) => <div key={item.url}><p>{tOmni('audioNumber', { number: index + 1 })} · {item.purpose || tOmni('audioPurpose')}</p><audio src={getAssetUrl(item.url)} controls preload="none" /></div>)}
                    </details>}
                    <div className={styles.previewGrid}>{segment.shots.map((shot, qi) => {
                        const preview = previews.find(p => p.id === shot.id);
                        if (!preview) return null;
                        const url = imageUrl(preview);
                        const pending = preview.image_generation_status === 'processing' || preview.image_generation_status === 'pending' || busy === preview.id;
                        return <article key={shot.id} className={styles.previewCard}>
                            <header><strong>{qi + 1}. {shot.title}</strong><span>{shot.duration}s</span></header>
                            {url ? <PreviewImage src={url} alt={shot.title} className={styles.previewImage} /> : <div className={styles.previewEmpty}>{t(pending ? 'busyImage' : 'previsEmpty')}</div>}
                            <p className={styles.hint}>{shot.camera} · {shot.description}</p>
                            {!!preview.image_error && <p className={styles.error}>{preview.image_error}</p>}
                            <div className={styles.tools}>
                                <Button variant="secondary" isDisabled={!!busy || imageRunning} isPending={pending} onPress={() => void run(preview.id, () => generate(preview))}>{t(url ? 'replaceImage' : 'generateImage')}</Button>
                                <label className={styles.upload}><Upload size={14} />{t('uploadImage')}<input type="file" accept="image/png,image/jpeg,image/webp" disabled={!!busy || imageRunning} onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; void upload(preview, file); }} /></label>
                            </div>
                            {(preview.t2i_image_urls?.length ?? 0) > 1 && <div className={styles.imageChoices}>{preview.t2i_image_urls?.map((image, index) => <button key={`${index}:${image}`} type="button" disabled={!!busy || imageRunning}
                                aria-label={t('imageChoice', { number: index + 1 })} aria-pressed={(preview.t2i_selected_index ?? 0) === index}
                                onClick={() => void run(preview.id, async () => { const result = await api.updateProductionPreview(project.id, preview.id, { selected_index: index }); if (mounted.current) onUpdate({ production_previews: result.production_previews }); })}>
                                <PreviewImage src={image} alt="" noLightbox />
                            </button>)}</div>}
                            {!!preview.t2i_image_urls?.length && <div className={styles.tools}>
                                <Button variant="quiet" isDisabled={!!busy || imageRunning} onPress={() => void run(`${preview.id}:remove`, async () => {
                                    const result = await api.removeProductionPreviewCandidate(project.id, preview.id, preview.t2i_selected_index ?? 0, project._revision ?? '');
                                    if (mounted.current) onUpdate({ production_previews: result.production_previews, _revision: result._revision });
                                })}>{t('imageRemove')}</Button>
                                <Button variant="quiet" isDisabled={!!busy || imageRunning} onPress={() => setClearTarget(preview)}>{t('imageClear')}</Button>
                            </div>}
                            <details><summary>{t('imagePrompt')}</summary><TextAreaField label={t('imagePrompt')} rows={3} value={prompts[preview.id] ?? preview.image_prompt ?? ''} onChange={value => setPrompts(current => ({ ...current, [preview.id]: value }))} />
                                <Button variant="quiet" isDisabled={!!busy || imageRunning || !prompts[preview.id]} onPress={() => void run(preview.id, async () => {
                                    const result = await api.updateProductionPreview(project.id, preview.id, { image_prompt: prompts[preview.id] });
                                    if (mounted.current) { onUpdate({ production_previews: result.production_previews }); setPrompts(current => { const next = { ...current }; delete next[preview.id]; return next; }); }
                                })}>{t('saveImagePrompt')}</Button>
                            </details>
                        </article>;
                    })}</div>
                    {report?.blockers.map((blocker, i) => <p key={i} className={styles.error}>{blocker}</p>)}
                    {report?.changed_after_review && report.can_confirm && <p className={styles.hint}>{t('reviewNotice')}</p>}
                    <Button variant={report?.ready ? 'quiet' : 'secondary'} isDisabled={!report?.can_confirm || report.ready || !!busy || hasDirtyPrompts}
                        onPress={() => void run(segment.id, async () => {
                            if (!report || !await beforeChange()) return;
                            const result = await api.confirmProductionSegment(project.id, report.frame_id, report.fingerprint);
                            if (mounted.current) onUpdate({ frames: result.frames });
                        })}><Check size={16} />{t(report?.ready ? 'confirmed' : 'confirmSegment')}</Button>
                </section>;
            })}
        </fieldset>}
    </Dialog>
    <ConfirmDialog open={confirmClose} title={t('unsaved')} message={t('previsUnsaved')}
        cancelLabel={t('keepEditing')} confirmLabel={t('discardChanges')}
        onCancel={() => setConfirmClose(false)} onConfirm={() => { setPrompts({}); setConfirmClose(false); stopBulk.current = true; onClose(); }} />
    <Dialog
        isOpen={!!clearTarget}
        onOpenChange={open => { if (!open) setClearTarget(null); }}
        title={t('imageClear')}
        closeLabel={t('close')}
        footer={<>
            <Button variant="quiet" onPress={() => setClearTarget(null)}>{t('imageClearCancel')}</Button>
            <Button variant="danger" onPress={() => {
                const target = clearTarget;
                if (!target) return;
                setClearTarget(null);
                void run(`${target.id}:clear`, async () => {
                    const result = await api.clearProductionPreviewCandidates(project.id, target.id, project._revision ?? '');
                    if (mounted.current) onUpdate({ production_previews: result.production_previews, _revision: result._revision });
                });
            }}>{t('imageClearConfirmAction')}</Button>
        </>}
    >
        <p>{t('imageClearConfirm')}</p>
    </Dialog>
    </>;
}
