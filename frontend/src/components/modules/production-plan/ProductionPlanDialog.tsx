"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Scissors, Trash2, Undo2 } from 'lucide-react';
import { Button, Dialog, SelectField, TextAreaField, TextField } from '@omnistudio/ui';
import { useTranslations } from 'next-intl';
import { api } from '@/lib/api';
import { VIDEO_R2V_MODELS, isR2vImageBased } from '@/lib/modelCatalog';
import CreditCost from '@/components/billing/CreditCost';
import { usePricingTable } from "@/store/billingStore";
import { creditLabel, unitLabels } from '@/lib/modelCost';
import { mergePlanSegment, planDuration, segmentDuration, splitPlanSegment, type PlanOverview, type PlanSettings, type PlannedSegment, type PlannedShot, type ProductionPlan } from '@/lib/productionPlan';
import type { Project } from '@/store/projectStore';
import styles from './ProductionPlanDialog.module.css';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    project: Project;
    modelId: string;
    beforeChange: () => Promise<boolean>;
    onUpdate: (patch: Partial<Project>, replaceFrames?: boolean) => void;
    onPrevis: () => void;
    readOnly?: boolean;
}

function message(error: any): string {
    const detail = error?.response?.data?.detail;
    return typeof detail === 'string' ? detail : detail?.message || error?.message || 'Request failed';
}

export default function ProductionPlanDialog({ isOpen, onClose, project, modelId, beforeChange, onUpdate, onPrevis, readOnly = false }: Props) {
    const t = useTranslations('productionPlan');
    const [overview, setOverview] = useState<PlanOverview | null>(null);
    const [draft, setDraft] = useState<ProductionPlan | null>(project.production_plan_draft ?? null);
    const [settings, setSettings] = useState<PlanSettings>({ model: modelId, target_duration: null, pacing: 'balanced', instruction: '' });
    const tBilling = useTranslations('billing');
    const pricing = usePricingTable();
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState('');
    const [planningError, setPlanningError] = useState('');
    const [uncertain, setUncertain] = useState(false);
    const [refreshError, setRefreshError] = useState('');
    const [dirty, setDirty] = useState(false);
    const [undo, setUndo] = useState<ProductionPlan | null>(null);
    const [historyOpen, setHistoryOpen] = useState(false);
    // Segments counted off the model's own stream — the one honest progress signal for a
    // single long call. Null while nothing is generating.
    const [progress, setProgress] = useState<{ segments: number; title: string } | null>(null);
    const [editing, setEditing] = useState(false);
    const active = useRef(true);
    const operation = useRef(false);
    const dirtyRef = useRef(dirty); dirtyRef.current = dirty;
    const savedRevision = useRef(draft?.revision);
    useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
    const refresh = useCallback(async () => {
        const state = await api.getProductionPlan(project.id);
        if (!active.current) return;
        setOverview(state);
        setRefreshError('');
        if (state.job?.status === 'failed') { setPlanningError(state.job.error || t('failed')); setUncertain(false); }
        if (state.job?.status === 'completed') { setPlanningError(''); setUncertain(false); }
        onUpdate({ production_plan_draft: state.draft, production_plan: state.active, production_planning_job: state.job });
        if (!dirtyRef.current && state.draft?.revision !== savedRevision.current) {
            savedRevision.current = state.draft?.revision;
            setDraft(state.draft);
        }
        return state;
    }, [project.id, onUpdate, t]);
    useEffect(() => {
        if (!isOpen) return;
        void refresh().catch(e => { if (active.current) setRefreshError(message(e)); });
    }, [isOpen, refresh]);
    const planning = busy === 'generate' || overview?.job?.status === 'processing';
    useEffect(() => {
        if (!isOpen || (!planning && !uncertain)) return;
        const timer = window.setInterval(() => { void refresh().catch(e => { if (active.current) setRefreshError(message(e)); }); }, 2500);
        return () => window.clearInterval(timer);
    }, [isOpen, planning, uncertain, refresh]);
    const currentModel = VIDEO_R2V_MODELS.find(model => model.id === (draft?.settings.model ?? settings.model));
    const durationConfig = currentModel?.duration;
    const durations = durationConfig?.type === 'slider'
        ? Array.from({ length: Math.floor((durationConfig.max - durationConfig.min) / durationConfig.step) + 1 }, (_, i) => durationConfig.min + i * durationConfig.step)
        : durationConfig?.type === 'buttons' ? durationConfig.options : durationConfig?.type === 'fixed' ? [durationConfig.value] : [];
    const invalid = draft?.segments.find(segment => !durations.includes(segmentDuration(segment)));
    const incomplete = draft && (!draft.summary.trim() || !draft.continuity_rules.trim()
        || draft.segments.some(segment => !segment.title.trim() || !segment.purpose.trim() || !segment.start_state.trim() || !segment.end_state.trim()
            || segment.shots.some(shot => !shot.title.trim() || !shot.description.trim() || !shot.camera.trim() || !Number.isInteger(shot.duration) || shot.duration < 1)));
    const invalidTarget = settings.target_duration !== null && (!Number.isInteger(settings.target_duration) || settings.target_duration < 1 || settings.target_duration > 600);
    // Problems the server found on the draft as last saved. They are what stops a plan from
    // being applied; saving stays open so a fix can be made one problem at a time.
    const problems = draft?.problems ?? [];
    const problemsFor = (segmentId: string, shotId?: string) =>
        problems.filter(problem => problem.segment_id === segmentId
            && (shotId ? problem.shot_id === shotId : !problem.shot_id));


    async function run(kind: string, work: () => Promise<void>) {
        if (operation.current || readOnly) return;
        operation.current = true; setBusy(kind); setError('');
        try { await work(); }
        catch (e: any) { if (active.current) {
            if (kind === 'generate') {
                const unknown = e?.code === 'ECONNABORTED' || !e?.response && /timeout|network/i.test(e?.message ?? '');
                setUncertain(unknown);
                setPlanningError(unknown ? t('planningUncertain') : message(e));
                void refresh().catch(err => { if (active.current) setRefreshError(message(err)); });
            } else setError(message(e));
        } }
        finally { operation.current = false; if (active.current) setBusy(null); }
    }
    function change(next: ProductionPlan, structural = false) {
        if (readOnly) return;
        if (structural) setUndo(draft);
        else setUndo(null);
        setDraft(next); setDirty(true); dirtyRef.current = true;
    }
    function editSegment(index: number, patch: Partial<PlannedSegment>) {
        if (draft) change({ ...draft, segments: draft.segments.map((s, i) => i === index ? { ...s, ...patch } : s) });
    }
    function editShot(segmentIndex: number, shotIndex: number, patch: Partial<PlannedShot>) {
        if (!draft) return;
        editSegment(segmentIndex, { shots: draft.segments[segmentIndex].shots.map((s, i) => i === shotIndex ? { ...s, ...patch } : s) });
    }
    async function save(): Promise<ProductionPlan> {
        if (!draft) throw new Error(t('noPlan'));
        if (!dirty) return draft;
        const result = await api.saveProductionPlan(project.id, draft);
        if (!active.current) throw new Error(t('contextChanged'));
        const saved = result.production_plan_draft as ProductionPlan;
        setDraft(saved); savedRevision.current = saved.revision;
        setDirty(false); dirtyRef.current = false; setUndo(null);
        onUpdate({ production_plan_draft: saved });
        return saved;
    }
    async function generate() {
        setPlanningError(''); setProgress({ segments: 0, title: '' });
        if (!await beforeChange() || !active.current) return;
        try {
            await api.generateProductionPlanStream(project.id, settings, (segments, title) => {
                if (active.current) setProgress({ segments, title });
            });
        } finally {
            if (active.current) setProgress(null);
        }
        if (!active.current) return;
        // The stream carries progress, not the plan: `refresh` is what reads the saved
        // draft back, and it is also the path a reconnecting client takes.
        savedRevision.current = undefined;
        setDirty(false); dirtyRef.current = false; setUndo(null);
        await refresh();
    }
    async function apply() {
        if (!await beforeChange() || !active.current) return;
        const saved = await save();
        const result = await api.applyProductionPlan(project.id, saved.revision);
        if (!active.current) return;
        onUpdate(result, true);
        setDraft(null); setDirty(false); dirtyRef.current = false;
        onClose(); onPrevis();
    }
    const shotCount = draft?.segments.reduce((sum, segment) => sum + segment.shots.length, 0) ?? 0;
    const atomicBusy = !!busy && busy !== 'generate';
    const leave = (afterClose?: () => void) => {
        if (atomicBusy || operation.current && busy !== 'generate') return;
        const finish = () => { onClose(); afterClose?.(); };
        if (dirty && !readOnly) void run('save', async () => { await save(); finish(); });
        else finish();
    };
    const close = () => leave();
    return <Dialog isOpen={isOpen} onOpenChange={open => { if (!open) close(); }} title={t('title')} closeLabel={t('close')}
        className={styles.dialog} isDismissable={!atomicBusy} footer={<>
            <span className={styles.footerSummary}>{dirty ? t('unsaved') : draft ? t('saved') : ''}</span>
            <Button variant="secondary" isDisabled={atomicBusy} onPress={close}>{t(dirty && !readOnly ? 'saveAndClose' : 'close')}</Button>
            {dirty && <Button variant="quiet" isDisabled={atomicBusy} onPress={() => { if (operation.current) return; setDraft(overview?.draft ?? project.production_plan_draft ?? null); setDirty(false); dirtyRef.current = false; onClose(); }}>{t('discardChanges')}</Button>}
            {progress && <span className={styles.progress}>{t('planProgress', { count: progress.segments })}{progress.title && ` · ${progress.title}`}</span>}
            {draft && !historyOpen && <><Button variant="secondary" isDisabled={readOnly || !dirty || !!busy || !!incomplete} onPress={() => void run('save', async () => { await save(); })}>{t('save')}</Button>
                <Button isDisabled={readOnly || !!busy || !!invalid || !!incomplete || planning || problems.length > 0} isPending={busy === 'apply'} onPress={() => void run('apply', apply)}>{t('apply')}</Button></>}
        </>}>
        <div className={styles.tabs}>
            <Button variant={!historyOpen ? 'secondary' : 'quiet'} aria-pressed={!historyOpen} onPress={() => setHistoryOpen(false)}>{t('planTab')}</Button>
            {project.production_plan && <Button variant="quiet" isDisabled={atomicBusy} onPress={() => leave(onPrevis)}>{t('previsTab')}</Button>}
            <Button variant={historyOpen ? 'secondary' : 'quiet'} aria-pressed={historyOpen} onPress={() => setHistoryOpen(true)}>{t('historyTab')}</Button>
        </div>
        {readOnly && <p className={styles.hint}>{t('readOnly')}</p>}
        {(error || planningError) && <p role="alert" className={styles.error}>{error || planningError}</p>}
        {(refreshError || uncertain) && <div><p role={refreshError ? 'alert' : 'status'} className={styles.error}>{refreshError || t('planningUncertain')}</p>
            <Button variant="secondary" onPress={() => void refresh().catch(e => { if (active.current) setRefreshError(message(e)); })}>{t('checkAgain')}</Button></div>}
        {historyOpen ? <div>
            {!overview?.versions.length && <p className={styles.hint}>{t('historyEmpty')}</p>}
            {overview?.versions.slice().reverse().map(version => <div key={version.id} className={styles.historyItem}>
                <div><p>{version.title}</p><p className={styles.hint}>{new Date(version.created_at * 1000).toLocaleString()} · {t('segmentCount', { count: version.frame_count })}</p></div>
                <Button variant="secondary" isDisabled={readOnly || !!busy} onPress={() => void run('restore', async () => {
                    if (!await beforeChange()) return;
                    const current = await refresh(); if (!current || !active.current) return;
                    const restored = await api.restoreStoryboardVersion(project.id, version.id, current.storyboard_fingerprint);
                    if (!active.current) return;
                    onUpdate(restored, true); onClose();
                })}>{t('restore')}</Button>
            </div>)}
        </div> : <fieldset disabled={readOnly || !!busy || planning} className={styles.stack}>
            <p className={styles.hint}>{t('intro')}</p>
            <details className={styles.brief} open={!draft} key={draft?.id ?? 'new'}><summary>{t('creativeBrief')}</summary><div className={styles.stack}>
            <div className={styles.settings}>
                <label className={styles.duration}>{t('targetDuration')}<input type="number" min={1} max={600} placeholder={t('automatic')}
                    value={settings.target_duration ?? ''} disabled={!!busy || planning} onChange={e => setSettings({ ...settings, target_duration: e.target.value ? Number(e.target.value) : null })} /></label>
                <SelectField label={t('pacing')} value={settings.pacing} onChange={key => setSettings({ ...settings, pacing: String(key) as PlanSettings['pacing'] })}
                    options={['balanced', 'brisk', 'measured'].map(id => ({ id, label: t(id) }))} />
                <SelectField label={t('model')} value={settings.model} onChange={key => setSettings({ ...settings, model: String(key) })}
                    options={VIDEO_R2V_MODELS.filter(m => isR2vImageBased(m.id)).map(m => ({
                        id: m.id, label: m.name,
                        description: creditLabel(pricing, m.id, unitLabels(tBilling)) ?? undefined }))} />
            </div>
            {invalidTarget && <p role="alert" className={styles.error}>{t('invalidTarget')}</p>}
            <TextAreaField label={t('instruction')} value={settings.instruction} onChange={value => setSettings({ ...settings, instruction: value })} rows={2} placeholder={t('instructionHint')} />
            <div className={styles.tools}><Button isPending={planning} isDisabled={!!busy || planning || uncertain || dirty || invalidTarget} onPress={() => void run('generate', generate)}>{t(planning ? 'planning' : draft ? 'regenerate' : 'generate')}</Button>
                {dirty && <span className={styles.hint}>{t('saveBeforeRegenerate')}</span>}
                {overview?.job?.status === 'failed' && <span className={styles.error}>{overview.job.error || t('failed')}</span>}
            </div>
            </div></details>
            {!draft && project.production_plan && <div className={styles.stack}>
                <p className={styles.hint}>{project.production_plan.summary}</p>
                <Button variant="secondary" onPress={() => void run('revise', async () => {
                    if (!await beforeChange() || !active.current) return;
                    const result = await api.reviseProductionPlan(project.id);
                    if (!active.current) return;
                    setDraft(result.production_plan_draft); savedRevision.current = result.production_plan_draft.revision;
                    onUpdate({ production_plan_draft: result.production_plan_draft }); setEditing(true);
                })}>{t('reviseActive')}</Button>
            </div>}
            {draft && <>
                {problems.length > 0 && <div role="alert" className={styles.problemSummary}>
                    <span>{t('problemsFound', { count: problems.length })}</span>
                    <span className={styles.hint}>{t('problemsHint')}</span>
                </div>}
                <div className={styles.stats}><strong>{t('totalDuration', { seconds: planDuration(draft) })}</strong><span>{t('shotCount', { count: shotCount })}</span><span>{t('generationCount', { count: draft.segments.length })}</span>
                    <CreditCost modelId={settings.model} quantity={planDuration(draft)} />
                    <Button variant="quiet" className={styles.statsEdit} onPress={() => setEditing(!editing)}>{t(editing ? 'reviewPlan' : 'editPlan')}</Button></div>
                {editing ? <><TextAreaField label={t('summary')} rows={2} value={draft.summary} onChange={value => change({ ...draft, summary: value })} />
                <TextAreaField label={t('continuity')} rows={2} value={draft.continuity_rules} onChange={value => change({ ...draft, continuity_rules: value })} /></> : <><p className={styles.hint}>{draft.summary}</p><details><summary>{t('continuity')}</summary><p className={styles.hint}>{draft.continuity_rules}</p></details></>}
                {draft.warnings.map((warning, i) => <p key={i} className={styles.hint}>{warning}</p>)}
                {incomplete && <p role="alert" className={styles.error}>{t('incompletePlan')}</p>}
                {invalid && <p role="alert" className={styles.error}>{t('invalidDuration', { name: invalid.title, seconds: segmentDuration(invalid), allowed: durations.join(' / ') })}</p>}
                {undo && <Button variant="quiet" onPress={() => { setDraft(undo); setUndo(null); setDirty(true); }}><Undo2 size={14} />{t('undoStructure')}</Button>}
                {draft.segments.map((segment, si) => !editing ? <section key={segment.id} className={styles.segment}>
                    <div className={styles.segmentHeader}><h3>{t('segmentNumber', { number: si + 1 })} · {segment.title}</h3><span>{segmentDuration(segment)}s</span></div>
                    <p className={styles.hint}>{segment.purpose}</p>
                    <div className={styles.pair}><p className={styles.hint}><strong>{t('startState')}：</strong>{segment.start_state}</p><p className={styles.hint}><strong>{t('endState')}：</strong>{segment.end_state}</p></div>
                    {segment.connection && <p className={styles.hint}>{t('connection')}：{segment.connection}</p>}
                    {problemsFor(segment.id).map((problem, pi) => <p key={pi} role="alert" className={styles.problem}>{problem.message}</p>)}
                    <ol className={styles.readShots}>{segment.shots.map((shot, i) => <li key={shot.id}>
                        <strong>{i + 1}. {shot.title} · {shot.duration}s</strong><p className={styles.hint}>{shot.camera} · {shot.description}</p>
                        {shot.dialogue.map((line, j) => <p key={j} className={styles.hint}>{line.speaker}：{line.line}</p>)}
                        {problemsFor(segment.id, shot.id).map((problem, pi) => <p key={pi} role="alert" className={styles.problem}>{problem.message}</p>)}
                    </li>)}</ol>
                </section> : <section key={segment.id} className={styles.segment} aria-label={t('segmentNumber', { number: si + 1 })}>
                    <div className={styles.segmentHeader}><h3>{t('segmentNumber', { number: si + 1 })} · {segmentDuration(segment)}s</h3>
                        <div className={styles.tools}>
                            <Button variant="quiet" isIconOnly aria-label={t('moveSegmentUp')} isDisabled={si === 0} onPress={() => {
                                const next = [...draft.segments]; [next[si - 1], next[si]] = [next[si], next[si - 1]]; change({ ...draft, segments: next }, true);
                            }}><ArrowUp size={14} /></Button>
                            <Button variant="quiet" isIconOnly aria-label={t('moveSegmentDown')} isDisabled={si === draft.segments.length - 1} onPress={() => {
                                const next = [...draft.segments]; [next[si + 1], next[si]] = [next[si], next[si + 1]]; change({ ...draft, segments: next }, true);
                            }}><ArrowDown size={14} /></Button>
                            <Button variant="quiet" isDisabled={draft.segments.length === 1} onPress={() => change({ ...draft, segments: draft.segments.filter((_, i) => i !== si) }, true)}><Trash2 size={14} />{t('removeSegment')}</Button>
                            {si < draft.segments.length - 1 && <Button variant="quiet" isDisabled={segment.scene_id !== draft.segments[si + 1].scene_id}
                                onPress={() => change(mergePlanSegment(draft, si), true)}>{t('mergeNext')}</Button>}
                        </div>
                    </div>
                    {problemsFor(segment.id).map((problem, pi) =>
                        <p key={pi} role="alert" className={styles.problem}>{problem.message}</p>)}
                    <SelectField label={t('scene')} value={segment.scene_id} options={project.scenes.map(scene => ({ id: scene.id, label: scene.name }))}
                        onChange={key => { const previous = project.scenes.find(scene => scene.id === segment.scene_id); const next = project.scenes.find(scene => scene.id === key);
                            editSegment(si, { scene_id: String(key), reference_names: [...segment.reference_names.filter(name => name !== previous?.name), ...(next ? [next.name] : [])] }); }} />
                    <div className={styles.pair}><TextField label={t('segmentTitle')} value={segment.title} onChange={value => editSegment(si, { title: value })} />
                        <TextField label={t('purpose')} value={segment.purpose} onChange={value => editSegment(si, { purpose: value })} /></div>
                    <div className={styles.pair}><TextAreaField label={t('startState')} rows={2} value={segment.start_state} onChange={value => editSegment(si, { start_state: value })} />
                        <TextAreaField label={t('endState')} rows={2} value={segment.end_state} onChange={value => editSegment(si, { end_state: value })} /></div>
                    {si > 0 && <TextField label={t('connection')} value={segment.connection} onChange={value => editSegment(si, { connection: value })} />}
                    <div className={styles.shots}>{segment.shots.map((shot, qi) => { const shotProblems = problemsFor(segment.id, shot.id); return <div key={shot.id} className={styles.shot} role="group" aria-label={t('shotNumber', { number: qi + 1 })}>
                        <span className={styles.shotIndex}>{String(qi + 1).padStart(2, '0')}</span>
                        <div className={styles.shotBody}>
                            {shotProblems.map((problem, pi) =>
                                <p key={pi} role="alert" className={styles.problem}>{problem.message}</p>)}
                            <TextField label={t('shotTitle')} value={shot.title} onChange={value => editShot(si, qi, { title: value })} />
                            <TextAreaField label={t('description')} rows={2} value={shot.description} onChange={value => editShot(si, qi, { description: value })} />
                            <details open={shotProblems.length > 0 || undefined}><summary>{t('shotDetails')}</summary><div>
                                <TextField label={t('camera')} value={shot.camera} onChange={value => editShot(si, qi, { camera: value })} />
                                {/* Editable, not read-only text. These are the two fields validation rejects
                                    most often, and while they were <p> the only way to fix a rejected plan was
                                    to go back and edit the script itself. */}
                                <TextAreaField label={t('sourceQuote')} rows={2} value={shot.source_quote}
                                    onChange={value => editShot(si, qi, { source_quote: value })} />
                                {shot.dialogue.map((dialogue, di) => <div key={di} className={styles.pair}>
                                    <TextField label={t('speaker')} value={dialogue.speaker}
                                        onChange={value => editShot(si, qi, { dialogue: shot.dialogue.map((d, i) => i === di ? { ...d, speaker: value } : d) })} />
                                    <TextAreaField label={t('dialogueLine')} rows={2} value={dialogue.line}
                                        onChange={value => editShot(si, qi, { dialogue: shot.dialogue.map((d, i) => i === di ? { ...d, line: value } : d) })} />
                                </div>)}
                            </div></details>
                            <div className={styles.tools}>
                                <Button variant="quiet" isIconOnly aria-label={t('moveUp')} isDisabled={qi === 0} onPress={() => {
                                    const next = [...segment.shots]; [next[qi - 1], next[qi]] = [next[qi], next[qi - 1]];
                                    change({ ...draft, segments: draft.segments.map((s, i) => i === si ? { ...s, shots: next } : s) }, true);
                                }}><ArrowUp size={14} /></Button>
                                <Button variant="quiet" isIconOnly aria-label={t('moveDown')} isDisabled={qi === segment.shots.length - 1} onPress={() => {
                                    const next = [...segment.shots]; [next[qi + 1], next[qi]] = [next[qi], next[qi + 1]];
                                    change({ ...draft, segments: draft.segments.map((s, i) => i === si ? { ...s, shots: next } : s) }, true);
                                }}><ArrowDown size={14} /></Button>
                                {qi > 0 && <Button variant="quiet" onPress={() => change(splitPlanSegment(draft, si, qi), true)}><Scissors size={14} />{t('splitHere')}</Button>}
                                <Button variant="quiet" isDisabled={segment.shots.length === 1} onPress={() => change({ ...draft,
                                    segments: draft.segments.map((s, i) => i === si ? { ...s, shots: s.shots.filter((_, j) => j !== qi) } : s),
                                }, true)}><Trash2 size={14} />{t('removeShot')}</Button>
                            </div>
                        </div>
                        <label className={styles.duration}>{t('seconds')}<input type="number" min={1} max={60} value={shot.duration} onChange={e => editShot(si, qi, { duration: Number(e.target.value) })} /></label>
                    </div>; })}</div>
                    <Button variant="quiet" onPress={() => change({ ...draft, segments: draft.segments.map((s, i) => i === si ? { ...s,
                        shots: [...s.shots, { ...s.shots[s.shots.length - 1], id: crypto.randomUUID(), title: t('newShot'), description: '', dialogue: [], duration: 4 }],
                    } : s) }, true)}><Plus size={14} />{t('addShot')}</Button>
                </section>)}
                {project.frames.length > 0 && <p className={styles.hint}>{t('archiveNotice', { count: project.frames.length })}</p>}
            </>}
        </fieldset>}
    </Dialog>;
}
