import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { useCallback, useState } from 'react';
import { renderWithIntl } from '@/test/renderWithIntl';
import type { Project } from '@/store/projectStore';
import type { ProductionPlan } from '@/lib/productionPlan';
import ProductionPlanDialog from './ProductionPlanDialog';

const mocks = vi.hoisted(() => ({ get: vi.fn(), generate: vi.fn(), save: vi.fn(), apply: vi.fn(), restore: vi.fn() }));
vi.mock('@/lib/api', () => ({ api: { getProductionPlan: mocks.get, generateProductionPlanStream: mocks.generate, saveProductionPlan: mocks.save, applyProductionPlan: mocks.apply, restoreStoryboardVersion: mocks.restore } }));
const plan: ProductionPlan = { id: 'plan', revision: 'v1', created_at: 0, status: 'draft',
    settings: { model: 'seedance-2.5-r2v', target_duration: 16, pacing: 'brisk', instruction: '' },
    source_fingerprint: 'source', storyboard_fingerprint: 'frames', summary: '先拦路，再看剑', continuity_rules: '沈砚始终站在檐下', warnings: [], problems: [],
    segments: [0, 1].map(si => ({ id: `segment-${si}`, title: `对峙${si + 1}`, scene_id: 'scene', purpose: '推动冲突', start_state: '看向对方', end_state: '保持站位', connection: '雨声延续', reference_names: ['沈砚', '破亭'],
        shots: [0, 1].map(qi => ({ id: `shot-${si}-${qi}`, title: `画面${si}-${qi}`, description: '沈砚站在亭檐下', camera: '平视中景', duration: 4, source_quote: '沈砚停步。', dialogue: [] })),
    })),
};
const initial = { id: 'project', title: '归鞘', originalText: '沈砚停步。', frames: [{ id: 'old', video_url: '/old.mp4' }], characters: [], scenes: [], props: [] } as unknown as Project;
const close = vi.fn(), previs = vi.fn(), before = vi.fn();
let saved: ProductionPlan | null;
function Harness({ existing = false }: { existing?: boolean }) {
    const [project, setProject] = useState<Project>({ ...initial, production_plan_draft: existing ? plan : null });
    const update = useCallback((patch: Partial<Project>) => setProject(current => ({ ...current, ...patch })), []);
    return <><p data-testid="current-frame">{project.frames[0]?.id}</p><ProductionPlanDialog isOpen onClose={close} project={project} modelId="seedance-2.5-r2v"
        beforeChange={before} onUpdate={update} onPrevis={previs} /></>;
}
beforeEach(() => {
    vi.clearAllMocks(); saved = null; before.mockResolvedValue(true);
    mocks.get.mockImplementation(async () => ({ draft: saved, active: null, job: null, storyboard_fingerprint: 'frames', versions: [] }));
    // Generation now reports over a stream and saves server-side; the draft is read back.
    mocks.generate.mockImplementation(async (_id, _settings, onProgress) => {
        saved = structuredClone(plan);
        saved.segments.forEach((segment, i) => onProgress(i + 1, segment.title));
    });
    mocks.save.mockImplementation(async (_id, draft) => { saved = { ...structuredClone(draft), revision: 'v2' }; return { production_plan_draft: saved }; });
    mocks.apply.mockImplementation(async () => ({ ...initial, production_plan: { ...saved, status: 'approved' }, production_plan_draft: null, frames: [{ id: 'new-segment' }] }));
});

it('previews a plan without replacing the current storyboard, edits grouping, and applies only on confirmation', async () => {
    renderWithIntl(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: '生成制作计划' }));
    expect(await screen.findByText('2 个生成片段')).toBeVisible();
    expect(screen.getByText('4 个剪辑镜头')).toBeVisible();
    expect(screen.getByTestId('current-frame')).toHaveTextContent('old');
    expect(mocks.apply).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox', { name: '镜头名称' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '编辑方案' }));
    const first = screen.getByRole('region', { name: '片段 1' });
    fireEvent.click(within(first).getByRole('button', { name: '从这里另起一段' }));
    expect(screen.getByText('3 个生成片段')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '保存方案' }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith('project', expect.objectContaining({ segments: expect.any(Array) })));
    expect(mocks.save.mock.calls[0][1].segments).toHaveLength(3);
    await waitFor(() => expect(screen.getByRole('button', { name: '保存方案' })).toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: '确认方案，制作分镜图' }));
    await waitFor(() => expect(mocks.apply).toHaveBeenCalledWith('project', 'v2'));
    expect(screen.getByTestId('current-frame')).toHaveTextContent('new-segment');
    expect(previs).toHaveBeenCalledOnce();
});

it('blocks an overlong segment and can undo structural edits', async () => {
    saved = structuredClone(plan);
    renderWithIntl(<Harness existing />);
    fireEvent.click(screen.getByRole('button', { name: '编辑方案' }));
    fireEvent.click(within(screen.getByRole('region', { name: '片段 1' })).getByRole('button', { name: '与下一段合并' }));
    expect(screen.getByText('1 个生成片段')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '撤销结构调整' }));
    expect(screen.getByText('2 个生成片段')).toBeVisible();
    fireEvent.change(within(screen.getByRole('region', { name: '片段 1' })).getAllByRole('spinbutton')[0], { target: { value: '30' } });
    expect(screen.getByRole('alert')).toHaveTextContent('34 秒');
    expect(screen.getByRole('button', { name: '确认方案，制作分镜图' })).toBeDisabled();
    expect(mocks.apply).not.toHaveBeenCalled();
});

it('retains the existing plan and shots after planning or saving fails', async () => {
    saved = structuredClone(plan);
    mocks.generate.mockRejectedValueOnce(new Error('模型繁忙'));
    renderWithIntl(<Harness existing />);
    fireEvent.click(screen.getByText('调整成片目标与重新规划'));
    fireEvent.click(screen.getByRole('button', { name: '重新规划' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('模型繁忙');
    expect(screen.getByTestId('current-frame')).toHaveTextContent('old');
    expect(screen.getByText('2 个生成片段')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '编辑方案' }));
    fireEvent.change(screen.getByRole('textbox', { name: '安排说明' }), { target: { value: '保留我的新安排' } });
    mocks.save.mockRejectedValueOnce(new Error('保存失败'));
    fireEvent.click(screen.getByRole('button', { name: '保存并关闭' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('保存失败'));
    expect(screen.getByRole('textbox', { name: '安排说明' })).toHaveValue('保留我的新安排');
    expect(close).not.toHaveBeenCalled();
});

it('surfaces a failed planning job returned by polling instead of leaving the spinner active', async () => {
    mocks.get.mockResolvedValueOnce({
        draft: null,
        active: null,
        job: { status: 'failed', error: '制作计划未生成成功，请重试' },
        storyboard_fingerprint: 'frames',
        versions: [],
    });
    renderWithIntl(<Harness />);
    expect(await screen.findByRole('alert')).toHaveTextContent('制作计划未生成成功，请重试');
    expect(screen.getByRole('button', { name: '生成制作计划' })).toBeEnabled();
});

it('keeps planning and application disabled in a read-only edit session', async () => {
    renderWithIntl(<ProductionPlanDialog isOpen onClose={close} project={initial} modelId="seedance-2.5-r2v"
        beforeChange={before} onUpdate={vi.fn()} onPrevis={previs} readOnly />);
    const generate = screen.getByRole('button', { name: '生成制作计划' });
    expect(generate).toBeDisabled();
    fireEvent.click(generate);
    expect(mocks.generate).not.toHaveBeenCalled();
});

it('ignores a completed planning response after the project view is unmounted', async () => {
    let finish!: (result: unknown) => void;
    mocks.generate.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const update = vi.fn();
    const view = renderWithIntl(<ProductionPlanDialog isOpen onClose={close} project={initial} modelId="seedance-2.5-r2v"
        beforeChange={before} onUpdate={update} onPrevis={previs} />);
    fireEvent.click(screen.getByRole('button', { name: '生成制作计划' }));
    await waitFor(() => expect(mocks.generate).toHaveBeenCalledOnce());
    update.mockClear();
    view.unmount();
    await act(async () => { finish(undefined); });
    expect(update).not.toHaveBeenCalled();
});

it('recovers the persisted planning job without resubmitting', async () => {
    const state = { draft: null as ProductionPlan | null, active: null, job: { status: 'processing' }, storyboard_fingerprint: 'frames', versions: [] };
    mocks.get.mockImplementation(async () => ({ ...state }));
    renderWithIntl(<Harness />);
    await screen.findByRole('button', { name: '正在规划…' });
    state.job = { status: 'completed' };
    state.draft = plan;
    // The persisted job is polled; reopening must also retrieve its final state.
    await waitFor(() => expect(screen.getByText('2 个生成片段')).toBeVisible(), { timeout: 4000 });
    expect(screen.queryByText('正在规划…')).not.toBeInTheDocument();
    expect(mocks.generate).not.toHaveBeenCalled();
});

it('clears a request timeout once reopening finds the completed plan', async () => {
    mocks.generate.mockRejectedValueOnce(Object.assign(new Error('timeout of 180000ms exceeded'), { code: 'ECONNABORTED' }));
    const update = vi.fn();
    function ReopeningHarness() {
        const [open, setOpen] = useState(true);
        return <><button onClick={() => setOpen(true)}>重新打开</button><ProductionPlanDialog isOpen={open} onClose={() => setOpen(false)} project={initial} modelId="seedance-2.5-r2v" beforeChange={before} onUpdate={update} onPrevis={previs} /></>;
    }
    renderWithIntl(<ReopeningHarness />);
    fireEvent.click(screen.getByRole('button', { name: '生成制作计划' }));
    await waitFor(() => expect(mocks.generate).toHaveBeenCalledOnce());
    await screen.findByRole('alert');
    mocks.get.mockResolvedValue({ draft: plan, active: null, job: { status: 'completed' }, storyboard_fingerprint: 'frames', versions: [] });
    fireEvent.click(screen.getAllByRole('button', { name: '关闭' }).at(-1)!);
    fireEvent.click(screen.getByRole('button', { name: '重新打开' }));
    expect(await screen.findByText('2 个生成片段')).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});


it('blocks all exit paths while saving and saves a dirty draft before opening previs', async () => {
    saved = structuredClone(plan);
    const update = vi.fn();
    mocks.get.mockImplementation(async () => ({ draft: saved, active: plan, job: null, storyboard_fingerprint: 'frames', versions: [] }));
    let finish!: (result: unknown) => void;
    mocks.save.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    renderWithIntl(<ProductionPlanDialog isOpen onClose={close} project={{ ...initial, production_plan: plan, production_plan_draft: plan }} modelId="seedance-2.5-r2v" beforeChange={before} onUpdate={update} onPrevis={previs} />);
    fireEvent.click(screen.getByRole('button', { name: '编辑方案' }));
    fireEvent.change(screen.getByRole('textbox', { name: '安排说明' }), { target: { value: '跳转前保存的安排' } });
    fireEvent.click(screen.getByRole('button', { name: '分镜预演' }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
    expect(close).not.toHaveBeenCalled();
    expect(previs).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '保存并关闭' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '放弃未保存修改' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '分镜预演' })).toBeDisabled();
    await act(async () => { finish({ production_plan_draft: { ...plan, summary: '跳转前保存的安排', revision: 'v2' } }); });
    expect(close).toHaveBeenCalledOnce();
    expect(previs).toHaveBeenCalledOnce();
});

it('keeps a flawed plan on screen for editing and refuses to apply it until the problems are gone', async () => {
    const flawed = structuredClone(plan);
    flawed.problems = [{ segment_index: 1, segment_id: 'segment-0', shot_id: 'shot-0-1', field: 'source_quote',
        message: '片段 1 的镜头「画面0-1」引用的剧本原文不连续' }];
    saved = flawed;
    renderWithIntl(<Harness existing />);
    fireEvent.click(screen.getByRole('button', { name: '编辑方案' }));
    // The reason sits on the shot that has to change, not only in a banner.
    const shot = within(screen.getByRole('region', { name: '片段 1' })).getByRole('group', { name: '镜头 2' });
    expect(within(shot).getByRole('alert')).toHaveTextContent('引用的剧本原文不连续');
    expect(screen.getByText('还有 1 处需要修改，方案暂时不能应用')).toBeVisible();
    expect(screen.getByRole('button', { name: '确认方案，制作分镜图' })).toBeDisabled();

    // The offending text is editable in place — no trip back to the script.
    const quote = within(shot).getByRole('textbox', { name: '剧本原文' });
    expect(quote).toHaveValue('沈砚停步。');
    fireEvent.change(quote, { target: { value: '沈砚停步，雨声压下来。' } });
    mocks.save.mockImplementationOnce(async (_id, draft) => {
        saved = { ...structuredClone(draft), revision: 'v2', problems: [] };
        return { production_plan_draft: saved };
    });
    fireEvent.click(screen.getByRole('button', { name: '保存方案' }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
    expect(mocks.save.mock.calls[0][1].segments[0].shots[1].source_quote).toBe('沈砚停步，雨声压下来。');
    await waitFor(() => expect(screen.getByRole('button', { name: '确认方案，制作分镜图' })).toBeEnabled());
    expect(screen.queryByText('还有 1 处需要修改，方案暂时不能应用')).not.toBeInTheDocument();
});

it('counts segments off the generation stream instead of showing an unmoving spinner', async () => {
    let report!: (segments: number, title: string) => void;
    let finish!: () => void;
    mocks.generate.mockImplementationOnce((_id, _settings, onProgress) => new Promise<void>(resolve => {
        report = onProgress; finish = () => { saved = structuredClone(plan); resolve(); };
    }));
    renderWithIntl(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: '生成制作计划' }));
    await waitFor(() => expect(mocks.generate).toHaveBeenCalledOnce());
    await act(async () => { report(2, '对峙2'); });
    expect(screen.getByText('已拆出 2 段 · 对峙2')).toBeVisible();
    await act(async () => { finish(); });
    await waitFor(() => expect(screen.getByText('2 个生成片段')).toBeVisible());
    expect(screen.queryByText(/已拆出/)).not.toBeInTheDocument();
});
