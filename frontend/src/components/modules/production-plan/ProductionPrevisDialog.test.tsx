import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { useCallback, useState } from 'react';
import { renderWithIntl } from '@/test/renderWithIntl';
import type { Project } from '@/store/projectStore';
import ProductionPrevisDialog, { waitForPreviewCompletion } from './ProductionPrevisDialog';

const mocks = vi.hoisted(() => ({ get: vi.fn(), review: vi.fn(), render: vi.fn(), confirm: vi.fn(), upload: vi.fn(), update: vi.fn(), remove: vi.fn(), clear: vi.fn() }));
vi.mock('@/lib/api', () => ({ api: { getProject: mocks.get, reviewProductionPlan: mocks.review, renderFrame: mocks.render, confirmProductionSegment: mocks.confirm, uploadT2IFrame: mocks.upload, updateProductionPreview: mocks.update, removeProductionPreviewCandidate: mocks.remove, clearProductionPreviewCandidates: mocks.clear } }));
vi.mock('@/components/shared/preview/PreviewImage', () => ({ default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} /> }));
vi.mock('@/components/shared/preview/PreviewVideo', () => ({ default: () => <video /> }));
let stored: Project;
let confirmed = false;
const close = vi.fn();
function Harness({ readOnly = false }: { readOnly?: boolean }) {
    const [project, setProject] = useState(stored);
    const update = useCallback((patch: Partial<Project>) => setProject(current => ({ ...current, ...patch })), []);
    return <ProductionPrevisDialog isOpen onClose={close} project={project} beforeChange={async () => true} onUpdate={update} readOnly={readOnly} />;
}
beforeEach(() => {
    vi.clearAllMocks(); confirmed = false; vi.stubGlobal('confirm', vi.fn(() => true));
    stored = { id: 'project', frames: [{ id: 'segment-frame' }], production_plan: { id: 'plan', continuity_rules: '两人站在亭檐下', segments: [
        { id: 'segment', frame_id: 'segment-frame', title: '对峙', start_state: '亭口相望', end_state: '沈砚垂眼', connection: '',
            shots: ['a', 'b'].map(id => ({ id, title: `镜头${id}`, description: '人物在檐下', duration: 4, camera: '中景', dialogue: [] })) },
    ] }, production_previews: ['a', 'b'].map(id => ({ id, scene_id: 'scene', image_prompt: `画面${id}`, t2i_image_urls: [], t2i_selected_index: 0 })) } as unknown as Project;
    mocks.get.mockImplementation(async () => stored);
    mocks.review.mockImplementation(async () => ({ segments: [{ segment_id: 'segment', frame_id: 'segment-frame', fingerprint: 'inputs-v1',
        ready: confirmed, can_confirm: stored.production_previews!.every(p => p.t2i_image_urls?.length), blockers: [], needs_review: !confirmed,
        reference_urls: [], preview_urls: [], previous_video_url: '/previous.mp4' }] }));
    mocks.render.mockImplementation(async (_project, id) => {
        stored = { ...stored, production_previews: stored.production_previews!.map(p => p.id === id ? { ...p, t2i_image_urls: [`/${id}.png`], image_generation_status: 'completed' } : p) };
        return stored;
    });
    mocks.confirm.mockImplementation(async () => { confirmed = true; return stored; });
});

it('generates missing keyframes in order, previews timing, and requires explicit confirmation', async () => {
    renderWithIntl(<Harness />);
    const confirm = screen.getByRole('button', { name: '确认画面与衔接' });
    expect(confirm).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '生成缺少的分镜图（2 张）' }));
    await waitFor(() => expect(mocks.render).toHaveBeenCalledTimes(2));
    expect(mocks.render.mock.calls.map(call => call[1])).toEqual(['a', 'b']);
    await waitFor(() => expect(confirm).toBeEnabled());
    expect(mocks.confirm).not.toHaveBeenCalled();
    vi.useFakeTimers();
    try {
        fireEvent.click(screen.getByRole('button', { name: '播放画面节奏预演（无音频）' }));
        const preview = screen.getByRole('region', { name: '播放画面节奏预演（无音频）' });
        expect(within(preview).getByText('1 / 2 · 镜头a · 4s')).toBeVisible();
        await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
        expect(within(preview).getByText('2 / 2 · 镜头b · 4s')).toBeVisible();
        fireEvent.click(screen.getByRole('button', { name: '暂停预演' }));
    } finally { vi.useRealTimers(); }
    fireEvent.click(confirm);
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledWith('project', 'segment-frame', 'inputs-v1'));
});

it('stops the rest of a segment after a failed image instead of submitting shots that depend on it', async () => {
    mocks.render.mockRejectedValueOnce(new Error('图像供应商繁忙'));
    renderWithIntl(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: '生成缺少的分镜图（2 张）' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('图像供应商繁忙');
    expect(mocks.render).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: '确认画面与衔接' })).toBeDisabled();
    expect(mocks.confirm).not.toHaveBeenCalled();
});

it('waits for a timed-out render to finish before the batch continues', async () => {
    let reads = 0;
    const loaded = vi.fn(async () => ({
        production_previews: [{ id: 'a', t2i_image_urls: reads++ > 0 ? ['/a.png'] : [], image_generation_status: reads > 1 ? 'completed' : 'processing' }],
    } as unknown as Project));
    const onUpdate = vi.fn();
    const wait = waitForPreviewCompletion({
        load: loaded,
        previewId: 'a',
        onUpdate,
        pollIntervalMs: 0,
        timeoutMs: 100,
    });

    const result = await wait;
    expect(result?.t2i_image_urls).toEqual(['/a.png']);
    expect(loaded).toHaveBeenCalledTimes(2);
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ production_previews: expect.any(Array) }));
});

it('removes the selected preview candidate and clears the preview through the server', async () => {
    stored = { ...stored, _revision: 'revision-1', production_previews: stored.production_previews!.map(p => ({ ...p, t2i_image_urls: ['/a.png', '/b.png'], t2i_selected_index: 1 })) } as Project;
    mocks.get.mockImplementation(async () => stored);
    mocks.remove.mockImplementation(async () => (stored = { ...stored, _revision: 'revision-2', production_previews: stored.production_previews!.map(p => ({ ...p, t2i_image_urls: ['/a.png'], t2i_selected_index: 0 })) }, stored));
    mocks.clear.mockImplementation(async () => (stored = { ...stored, _revision: 'revision-3', production_previews: stored.production_previews!.map(p => ({ ...p, t2i_image_urls: [], t2i_selected_index: 0 })) }, stored));
    renderWithIntl(<Harness />);
    await waitFor(() => expect(screen.getAllByRole('button', { name: '移除当前分镜候选图' })[0]).toBeVisible());
    fireEvent.click(screen.getAllByRole('button', { name: '移除当前分镜候选图' })[0]);
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith('project', 'a', 1, 'revision-1'));
    fireEvent.click(screen.getAllByRole('button', { name: '清空本镜头候选图' })[0]);
    expect(screen.getByRole('dialog', { name: '清空本镜头候选图' })).toBeVisible();
    fireEvent.click(within(screen.getByRole('dialog', { name: '清空本镜头候选图' })).getByRole('button', { name: '确认清空' }));
    await waitFor(() => expect(mocks.clear).toHaveBeenCalledWith('project', 'a', 'revision-2'));
});

it('keeps the preview unchanged when clearing candidates is cancelled', async () => {
    stored = { ...stored, _revision: 'revision-1', production_previews: stored.production_previews!.map(p => ({ ...p, t2i_image_urls: ['/a.png'], t2i_selected_index: 0 })) } as Project;
    mocks.get.mockImplementation(async () => stored);
    renderWithIntl(<Harness />);
    await waitFor(() => expect(screen.getAllByRole('button', { name: '清空本镜头候选图' })[0]).toBeVisible());
    fireEvent.click(screen.getAllByRole('button', { name: '清空本镜头候选图' })[0]);
    const dialog = screen.getByRole('dialog', { name: '清空本镜头候选图' });
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));
    expect(mocks.clear).not.toHaveBeenCalled();
});

it('lets a read-only viewer retry a failed refresh without enabling mutations', async () => {
    mocks.get.mockRejectedValueOnce(new Error('连接中断'));
    renderWithIntl(<Harness readOnly />);
    expect(await screen.findByRole('alert')).toHaveTextContent('连接中断');
    fireEvent.click(screen.getByRole('button', { name: '刷新状态' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: '生成缺少的分镜图（2 张）' })).toBeDisabled();
});

it.each(['Network Error', 'Request failed with status code 500'])(
    'explains a transport failure and preserves the preview for retry: %s', async message => {
        mocks.get.mockRejectedValueOnce(Object.assign(new Error(message), { isAxiosError: true }));
        renderWithIntl(<Harness />);
        expect(await screen.findByRole('alert')).toHaveTextContent('刷新失败，已保留当前内容，请重试。');
        expect(screen.getByRole('heading', { name: '片段 1 · 对峙' })).toBeVisible();
        fireEvent.click(screen.getByRole('button', { name: '刷新状态' }));
        await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    },
);

it('keeps an unsaved preview prompt when closing is cancelled', async () => {
    renderWithIntl(<Harness />);
    fireEvent.click(screen.getAllByText('分镜图描述', { selector: 'summary' })[0]);
    fireEvent.change(screen.getAllByRole('textbox', { name: '分镜图描述' })[0], { target: { value: '保留这段编辑' } });
    fireEvent.click(screen.getByRole('button', { name: '返回制作视频' }));
    expect(close).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '继续编辑' }));
    expect(screen.getAllByRole('textbox', { name: '分镜图描述' })[0]).toHaveValue('保留这段编辑');
});

/** Two segments in the same scene — the shape that used to serialize into one queue. */
function twoSegments(): Project {
    const shots = (ids: string[]) => ids.map(id => ({ id, title: `镜头${id}`, description: '人物在檐下', duration: 4, camera: '中景', dialogue: [] }));
    return { id: 'project', frames: [{ id: 'frame-one' }, { id: 'frame-two' }], production_plan: { id: 'plan', continuity_rules: '两人站在亭檐下', segments: [
        { id: 'one', frame_id: 'frame-one', title: '对峙', start_state: '亭口相望', end_state: '沈砚垂眼', connection: '', shots: shots(['a', 'b']) },
        { id: 'two', frame_id: 'frame-two', title: '回身', start_state: '沈砚垂眼', end_state: '转身离去', connection: '延续雨声', shots: shots(['c', 'd']) },
    ] }, production_previews: ['a', 'b', 'c', 'd'].map(id => ({ id, scene_id: 'scene', image_prompt: `画面${id}`, t2i_image_urls: [], t2i_selected_index: 0 })) } as unknown as Project;
}

/** Hold every render open so what is in flight at once is observable. */
function gatedRenders() {
    const open = new Map<string, (ok: boolean) => void>();
    mocks.render.mockImplementation((_project: string, id: string) => new Promise((resolve, reject) => {
        open.set(id, (ok: boolean) => {
            if (!ok) return reject(new Error(`${id} 生成失败`));
            stored = { ...stored, production_previews: stored.production_previews!.map(p =>
                p.id === id ? { ...p, t2i_image_urls: [`/${id}.png`], image_generation_status: 'completed' } : p) };
            resolve(stored);
        });
    }));
    return {
        inFlight: () => [...open.keys()].sort(),
        settle: async (id: string, ok = true) => { const finish = open.get(id); open.delete(id); await act(async () => { finish!(ok); }); },
    };
}

it('renders segments at the same time while keeping each segment in shot order', async () => {
    stored = twoSegments();
    const renders = gatedRenders();
    renderWithIntl(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: '生成缺少的分镜图（4 张）' }));

    // Both segments open their first shot before either has finished — the whole point.
    await waitFor(() => expect(mocks.render).toHaveBeenCalledTimes(2));
    expect(renders.inFlight()).toEqual(['a', 'c']);
    expect(screen.getByText('已完成 0 / 4')).toBeVisible();

    // The second shot of a segment waits for that segment's first, not for the other segment.
    await renders.settle('a');
    await waitFor(() => expect(mocks.render).toHaveBeenCalledTimes(3));
    expect(renders.inFlight()).toEqual(['b', 'c']);
    expect(screen.getByText('已完成 1 / 4')).toBeVisible();

    await renders.settle('c');
    await renders.settle('b');
    await renders.settle('d');
    await waitFor(() => expect(mocks.render).toHaveBeenCalledTimes(4));
    expect(mocks.render.mock.calls.map(call => call[1])).toEqual(['a', 'c', 'b', 'd']);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('keeps other segments going when one segment fails, and reports how many images failed', async () => {
    stored = twoSegments();
    const renders = gatedRenders();
    renderWithIntl(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: '生成缺少的分镜图（4 张）' }));
    await waitFor(() => expect(mocks.render).toHaveBeenCalledTimes(2));

    await renders.settle('a', false);          // segment one dies on its first shot
    await renders.settle('c');
    await waitFor(() => expect(mocks.render).toHaveBeenCalledTimes(3));
    expect(renders.inFlight()).toEqual(['d']); // segment two carried on
    await renders.settle('d');

    expect(await screen.findByRole('alert')).toHaveTextContent('1 张生成失败：a 生成失败');
    // 'b' needs a's image as a reference, so submitting it would only be refused.
    expect(mocks.render.mock.calls.map(call => call[1])).not.toContain('b');
    expect(stored.production_previews!.filter(p => p.t2i_image_urls?.length).map(p => p.id)).toEqual(['c', 'd']);
});

it('lets an unrelated image be regenerated while one is still rendering', async () => {
    // Regenerating a single image used to take a lock on the whole dialog, so the other
    // images could neither be regenerated nor even have their candidate switched — on a
    // segment of three shots that made fixing one frame a strictly serial chore.
    stored = twoSegments();
    const renders = gatedRenders();
    renderWithIntl(<Harness />);

    const cardFor = (title: string) => within(screen.getByText(title).closest('article')!);
    fireEvent.click(cardFor('1. 镜头a').getByRole('button', { name: '生成分镜图' }));
    await waitFor(() => expect(mocks.render).toHaveBeenCalledOnce());

    // The other image's own button is still live.
    const other = cardFor('2. 镜头b').getByRole('button', { name: '生成分镜图' });
    expect(other).toBeEnabled();
    fireEvent.click(other);
    await waitFor(() => expect(mocks.render).toHaveBeenCalledTimes(2));
    expect(renders.inFlight()).toEqual(['a', 'b']);

    // ...while the one that is rendering does not accept a second submission. Asserted on
    // the guard rather than the attribute: the button is `isPending` here, and React Aria
    // marks that with aria-disabled rather than the `disabled` property.
    fireEvent.click(cardFor('1. 镜头a').getByRole('button', { name: '生成分镜图' }));
    await Promise.resolve();
    expect(mocks.render).toHaveBeenCalledTimes(2);
    await renders.settle('a');
    await renders.settle('b');
    await waitFor(() => expect(mocks.render).toHaveBeenCalledTimes(2));
});

it('lets another image switch candidates while one is rendering', async () => {
    stored = twoSegments();
    stored = { ...stored, production_previews: stored.production_previews!.map(p =>
        p.id === 'c' ? { ...p, t2i_image_urls: ['/c1.png', '/c2.png'], t2i_selected_index: 0 } : p) };
    const renders = gatedRenders();
    mocks.update.mockImplementation(async () => stored);
    renderWithIntl(<Harness />);

    fireEvent.click(within(screen.getByText('1. 镜头a').closest('article')!).getByRole('button', { name: '生成分镜图' }));
    await waitFor(() => expect(mocks.render).toHaveBeenCalledOnce());

    const choice = screen.getByRole('button', { name: '选择分镜图 2' });
    expect(choice).toBeEnabled();
    fireEvent.click(choice);
    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith('project', 'c', { selected_index: 1 }));
    await renders.settle('a');
});

it('keeps candidate removal exclusive because it carries the project revision', async () => {
    // Remove and clear send `project._revision`; two of them in flight would make the
    // second lose the optimistic-concurrency check.
    stored = twoSegments();
    stored = { ...stored, _revision: 'rev-1', production_previews: stored.production_previews!.map(p =>
        ({ ...p, t2i_image_urls: [`/${p.id}.png`], t2i_selected_index: 0 })) } as Project;
    const renders = gatedRenders();
    renderWithIntl(<Harness />);

    fireEvent.click(within(screen.getByText('1. 镜头a').closest('article')!).getByRole('button', { name: '重新生成' }));
    await waitFor(() => expect(mocks.render).toHaveBeenCalledOnce());
    for (const button of screen.getAllByRole('button', { name: '移除当前分镜候选图' })) expect(button).toBeDisabled();
    await renders.settle('a');
    await waitFor(() => expect(screen.getAllByRole('button', { name: '移除当前分镜候选图' })[1]).toBeEnabled());
});
