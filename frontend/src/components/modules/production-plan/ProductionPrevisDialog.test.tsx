import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { useCallback, useState } from 'react';
import { renderWithIntl } from '@/test/renderWithIntl';
import type { Project } from '@/store/projectStore';
import ProductionPrevisDialog from './ProductionPrevisDialog';

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

it('stops a batch after a failed image instead of submitting the rest', async () => {
    mocks.render.mockRejectedValueOnce(new Error('图像供应商繁忙'));
    renderWithIntl(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: '生成缺少的分镜图（2 张）' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('图像供应商繁忙');
    expect(mocks.render).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: '确认画面与衔接' })).toBeDisabled();
    expect(mocks.confirm).not.toHaveBeenCalled();
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

it('keeps an unsaved preview prompt when closing is cancelled', async () => {
    renderWithIntl(<Harness />);
    fireEvent.click(screen.getAllByText('分镜图描述', { selector: 'summary' })[0]);
    fireEvent.change(screen.getAllByRole('textbox', { name: '分镜图描述' })[0], { target: { value: '保留这段编辑' } });
    fireEvent.click(screen.getByRole('button', { name: '返回制作视频' }));
    expect(close).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '继续编辑' }));
    expect(screen.getAllByRole('textbox', { name: '分镜图描述' })[0]).toHaveValue('保留这段编辑');
});
