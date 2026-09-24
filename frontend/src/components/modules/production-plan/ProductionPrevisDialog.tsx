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
    /** Open the production plan — where segment timing and splitting are edited. */
    onEditPlan?: () => void;
    readOnly?: boolean;
}
export default function ProductionPrevisDialog({ project, isOpen, onClose, beforeChange, onUpdate, onEditPlan, readOnly = false }: Props) {
    const t = useTranslations('productionPlan');
    const tOmni = useTranslations('omniReference');
    const [reviews, setReviews] = useState<ProductionReview[]>([]);
    // Keys of everything in flight, not a single one. Regenerating one image used to lock
    // the whole dialog — including switching another image's candidate, which touches
    // nothing the render touches.
    const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
    const [error, setError] = useState('');
    const [refreshError, setRefreshError] = useState('');
    const [confirmClose, setConfirmClose] = useState(false);
    const [prompts, setPrompts] = useState<Record<string, string>>({});
    const [playing, setPlaying] = useState(false);
    const [playIndex, setPlayIndex] = useState(0);
    const [clearTarget, setClearTarget] = useState<Preview | null>(null);
    const [bulk, setBulk] = useState({ done: 0, total: 0 });
    // Mirrors `busy` for the synchronous guard in `run`: setState is async, so two quick
    // clicks would both pass a check made against the rendered value.
    const inFlight = useRef(new Set<string>());
    const exclusive = useRef<string | null>(null);
    const mutationVersion = useRef(0);
    const stopBulk = useRef(false);
    const mounted = useRef(true);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; stopBulk.current = true; }; }, []);
    useEffect(() => { if (readOnly) stopBulk.current = true; }, [readOnly]);
    const plan = project.production_plan;
    const previews = project.production_previews ?? [];
    // Operations run concurrently now, so a patch built from a render-time snapshot can drop
    // a sibling that finished in between. Anything merging client-side reads this instead.
    const latestPreviews = useRef(previews); latestPreviews.current = previews;
    const allShots = plan?.segments.flatMap(segment => segment.shots) ?? [];
    const missing = previews.filter(preview => !imageUrl(preview));
    // Previews grouped into the chains the backend actually enforces: shot order within a
    // segment, nothing across segments.
    const chains = (plan?.segments ?? []).map(segment =>
        segment.shots.map(shot => previews.find(preview => preview.id === shot.id)).filter((p): p is Preview => !!p));
    // Kept only for the batch button and the dialog-close guard: a *global* "something is
    // rendering" must not decide whether an unrelated image can be touched.
    const imageRunning = previews.some(preview => preview.image_generation_status === 'processing' || preview.image_generation_status === 'pending');
    const bulkRunning = busy.has('all');
    const rendering = (preview: Preview) => preview.image_generation_status === 'processing' || preview.image_generation_status === 'pending';
    /** This image is mid-operation; anything else on screen stays usable. */
    const previewBusy = (preview: Preview) => bulkRunning || busy.has(preview.id) || rendering(preview)
        || busy.has(`${preview.id}:remove`) || busy.has(`${preview.id}:clear`);
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
        if (!isOpen || (!busy.size && !imageRunning)) return;
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
    /**
     * Run one operation, keyed.
     *
     * Same key never runs twice at once (two renders of one image would be refused by the
     * server anyway). Different keys run together — that is the point. `isExclusive` is for
     * the operations that carry `project._revision`: two of those in flight would make the
     * second one lose the optimistic-concurrency check, so they take the whole dialog.
     */
    async function run(key: string, action: () => Promise<void>, isExclusive = false) {
        if (readOnly || inFlight.current.has(key)) return;
        if (exclusive.current || (isExclusive && inFlight.current.size)) return;
        inFlight.current.add(key);
        if (isExclusive) exclusive.current = key;
        mutationVersion.current += 1; setBusy(new Set(inFlight.current)); setError('');
        try { await action(); }
        catch (e) { if (mounted.current) setError(errorMessage(e) || t('imageFailed')); }
        finally {
            inFlight.current.delete(key);
            if (exclusive.current === key) exclusive.current = null;
            mutationVersion.current += 1;
            if (mounted.current) { setBusy(new Set(inFlight.current)); void refresh().catch(e => { if (mounted.current) setRefreshError(errorMessage(e) || t('refreshFailed')); }); }
        }
    }
    async function generate(preview: Preview) {
        if (!await beforeChange() || !mounted.current) return;
        await render(preview);
    }
    /**
     * One image. `apply` lets the bulk run merge its own result instead of taking the
     * whole snapshot: renders happen in parallel now, and a response serialized before a
     * sibling finished would otherwise overwrite that sibling's image on the way in.
     */
    async function render(preview: Preview, apply?: (rendered: Preview) => void) {
        let rendered: Preview | undefined;
        try {
            const result = await api.renderFrame(project.id, preview.id, null, prompts[preview.id] ?? preview.image_prompt ?? '', 1);
            if (!mounted.current) return;
            rendered = result.production_previews?.find((frame: Preview) => frame.id === preview.id);
            if (apply && rendered) apply(rendered);
            else onUpdate({ production_previews: result.production_previews });
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
            if (mounted.current) onUpdate({ production_previews: latestPreviews.current.map(p => p.id === preview.id ? uploaded : p) });
        });
    }
    const playingShot = allShots[playIndex];
    const playingPreview = previews.find(preview => preview.id === playingShot?.id);
    const hasDirtyPrompts = previews.some(preview => prompts[preview.id] !== undefined && prompts[preview.id] !== preview.image_prompt);
    const atomicBusy = [...busy].some(key => key !== 'all'
        && !previews.some(preview => preview.id === key && imageRunning));
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
                {missing.length > 0 && <Button variant="secondary" isDisabled={!!busy.size || imageRunning} isPending={bulkRunning} onPress={() => void run('all', async () => {
                    stopBulk.current = false;
                    if (!await beforeChange() || !mounted.current) return;
                    setBulk({ done: 0, total: missing.length });
                    // One chain per segment. Inside a segment each shot carries the previous
                    // shot's image, so it stays serial; segments are independent, so they
                    // run at once. `allSettled` — with `all`, the first failure would leave
                    // the other chains' rejections unhandled.
                    const fresh = new Map<string, Preview>();
                    const snapshot = previews;
                    const outcomes = await Promise.allSettled(chains.map(async chain => {
                        for (const preview of chain) {
                            if (stopBulk.current || !mounted.current) return;
                            if (imageUrl(preview)) continue;
                            // A failure stops the rest of *this* segment: the shots after it
                            // need its image as a reference and would only be refused.
                            await render(preview, rendered => {
                                fresh.set(rendered.id, rendered);
                                setBulk(current => ({ ...current, done: fresh.size }));
                                onUpdate({ production_previews: snapshot.map(p => fresh.get(p.id) ?? p) });
                            });
                        }
                    }));
                    const failures = outcomes.filter((outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected');
                    if (failures.length) throw new Error(t('bulkFailed', { count: failures.length, reason: errorMessage(failures[0].reason) || t('imageFailed') }));
                }, true)}>{t('generateMissing', { count: missing.length })}</Button>}
                {bulkRunning && <><span className={styles.hint}>{t('bulkProgress', { done: bulk.done, total: bulk.total })}</span>
                    <Button variant="quiet" onPress={() => { stopBulk.current = true; }}>{t('stopFollowing')}</Button></>}
                <Button variant="quiet" isDisabled={missing.length > 0 || !allShots.length} onPress={() => { if (!playing) setPlayIndex(0); setPlaying(!playing); }}>{playing ? <Pause size={14} /> : <Play size={14} />}{t(playing ? 'pausePreview' : 'playPreview')}</Button>
            </div>
            {playing && playingShot && <section className={styles.animatic} aria-label={t('playPreview')}>
                {imageUrl(playingPreview) && <PreviewImage src={imageUrl(playingPreview)!} alt={playingShot.title} className={styles.previewImage} noLightbox />}
                <p>{playIndex + 1} / {allShots.length} · {playingShot.title} · {playingShot.duration}s</p>
                {playingShot.dialogue.map((line, i) => <p key={i}>{line.speaker}：{line.line}</p>)}
            </section>}
            <p className={styles.hint}>{plan.continuity_rules}</p>
            {plan.segments.map((segment, si) => {
                const report = reviews.find(review => review.segment_id === segment.id);
                const segmentBusy = segment.shots.some(shot => {
                    const preview = previews.find(item => item.id === shot.id);
                    return !!preview && previewBusy(preview);
                });
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
                        const pending = rendering(preview) || busy.has(preview.id);
                        const locked = previewBusy(preview);
                        return <article key={shot.id} className={styles.previewCard}>
                            <header><strong>{qi + 1}. {shot.title}</strong><span>{shot.duration}s</span></header>
                            {url ? <PreviewImage src={url} alt={shot.title} alwaysShowMagnify className={styles.previewImage} /> : <div className={styles.previewEmpty}>{t(pending ? 'busyImage' : 'previsEmpty')}</div>}
                            <p className={styles.hint}>{shot.camera} · {shot.description}</p>
                            {!!preview.image_error && <p className={styles.error}>{preview.image_error}</p>}
                            <div className={styles.tools}>
                                <Button variant="secondary" isDisabled={locked} isPending={pending} onPress={() => void run(preview.id, () => generate(preview))}>{t(url ? 'replaceImage' : 'generateImage')}</Button>
                                <label className={styles.upload}><Upload size={14} />{t('uploadImage')}<input type="file" accept="image/png,image/jpeg,image/webp" disabled={locked} onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; void upload(preview, file); }} /></label>
                            </div>
                            {(preview.t2i_image_urls?.length ?? 0) > 1 && <div className={styles.imageChoices}>{preview.t2i_image_urls?.map((image, index) => <button key={`${index}:${image}`} type="button" disabled={locked}
                                aria-label={t('imageChoice', { number: index + 1 })} aria-pressed={(preview.t2i_selected_index ?? 0) === index}
                                onClick={() => void run(preview.id, async () => { const result = await api.updateProductionPreview(project.id, preview.id, { selected_index: index }); if (mounted.current) onUpdate({ production_previews: result.production_previews }); })}>
                                <PreviewImage src={image} alt="" noLightbox />
                            </button>)}</div>}
                            {!!preview.t2i_image_urls?.length && <div className={styles.tools}>
                                <Button variant="quiet" isDisabled={locked || !!busy.size} onPress={() => void run(`${preview.id}:remove`, async () => {
                                    const result = await api.removeProductionPreviewCandidate(project.id, preview.id, preview.t2i_selected_index ?? 0, project._revision ?? '');
                                    if (mounted.current) onUpdate({ production_previews: result.production_previews, _revision: result._revision });
                                }, true)}>{t('imageRemove')}</Button>
                                <Button variant="quiet" isDisabled={locked || !!busy.size} onPress={() => setClearTarget(preview)}>{t('imageClear')}</Button>
                            </div>}
                            <details><summary>{t('imagePrompt')}</summary><TextAreaField label={t('imagePrompt')} rows={3} value={prompts[preview.id] ?? preview.image_prompt ?? ''} onChange={value => setPrompts(current => ({ ...current, [preview.id]: value }))} />
                                <Button variant="quiet" isDisabled={locked || !prompts[preview.id]} onPress={() => void run(preview.id, async () => {
                                    const result = await api.updateProductionPreview(project.id, preview.id, { image_prompt: prompts[preview.id] });
                                    if (mounted.current) { onUpdate({ production_previews: result.production_previews }); setPrompts(current => { const next = { ...current }; delete next[preview.id]; return next; }); }
                                })}>{t('saveImagePrompt')}</Button>
                            </details>
                        </article>;
                    })}</div>
                    {report?.blockers.map((blocker, i) => <div key={i} className={styles.error}>
                        <p>{blocker.message}</p>
                        <div className={styles.tools}>
                            {blocker.fix === 'segment_model' && blocker.is_override && <Button variant="secondary"
                                isDisabled={segmentBusy || busy.has(`${report.frame_id}:model`)}
                                onPress={() => void run(`${report.frame_id}:model`, async () => {
                                    const result = await api.updateShotModelSettings(project.id, report.frame_id, { reset_fields: ['r2v_model'] });
                                    if (mounted.current) onUpdate({ frames: result.frames });
                                })}>{t('useplanModel')}</Button>}
                            {(blocker.fix === 'plan_timing' || blocker.fix === 'plan' || blocker.fix === 'segment_model') && onEditPlan
                                && <Button variant="quiet" onPress={onEditPlan}>{t('goEditPlan')}</Button>}
                        </div>
                    </div>)}
                    {report?.changed_after_review && report.can_confirm && <p className={styles.hint}>{t('reviewNotice')}</p>}
                    <Button variant={report?.ready ? 'quiet' : 'secondary'} isDisabled={!report?.can_confirm || report.ready || segmentBusy || busy.has(segment.id) || hasDirtyPrompts}
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
                }, true);
            }}>{t('imageClearConfirmAction')}</Button>
        </>}
    >
        <p>{t('imageClearConfirm')}</p>
    </Dialog>
    </>;
}
