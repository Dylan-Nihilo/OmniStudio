import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { renderWithIntl } from '@/test/renderWithIntl';
import { useProjectStore, type Project } from '@/store/projectStore';
import VideoAssembly from './VideoAssembly';

const mocks = vi.hoisted(() => ({ get: vi.fn(), merge: vi.fn() }));
vi.mock('@/lib/api', () => ({ API_URL: '', api: { getProject: mocks.get, mergeVideos: mocks.merge } }));
afterEach(() => { vi.useRealTimers(); useProjectStore.setState(useProjectStore.getInitialState(), true); vi.clearAllMocks(); });

it('resumes persisted merge progress and releases the action only after completion', async () => {
    const project = { id: 'recovery', title: 'Recovery', frames: [], video_tasks: [], merge_progress: { stage: 'transcoding', progress: 0.4, message: '转码合并' } } as unknown as Project;
    useProjectStore.setState({ currentProject: project, projects: [project] });
    mocks.get.mockResolvedValue({ ...project, merge_progress: { stage: 'done', progress: 1, message: '导出完成' }, merged_video_url: '/video/recovery.mp4' });
    renderWithIntl(<VideoAssembly />);
    fireEvent.click(screen.getByRole('button', { name: '导出' }));
    expect(screen.getByText(/导出进度/)).toBeVisible();
    await waitFor(() => expect(mocks.get).toHaveBeenCalledWith('recovery'), { timeout: 3500 });
    await waitFor(() => expect(useProjectStore.getState().currentProject?.merged_video_url).toBe('/video/recovery.mp4'));
    expect(mocks.merge).not.toHaveBeenCalled();
});

it('keeps watching a queued export instead of declaring it finished', async () => {
    // The merge call only queues the work now — an eight-shot episode takes about five
    // minutes, far longer than the client's own timeout, which is how a finished export
    // came to be reported as a failure. Treating the response as the result would make the
    // view announce success the moment the work started.
    const project = { id: 'queued', title: 'Queued',
        frames: [{ id: 'shot', selected_video_id: 'take' }],
        video_tasks: [{ id: 'take', status: 'completed', video_url: '/video/take.mp4' }] } as unknown as Project;
    useProjectStore.setState({ currentProject: project, projects: [project] });
    mocks.merge.mockResolvedValue({ ...project, merge_progress: { stage: 'preparing', progress: 0.01, message: '准备导出' } });
    mocks.get.mockResolvedValue({ ...project, merge_progress: { stage: 'done', progress: 1, message: '导出完成' }, merged_video_url: '/video/queued.mp4' });
    renderWithIntl(<VideoAssembly />);

    fireEvent.click(screen.getByRole('button', { name: '导出' }));
    await waitFor(() => expect(mocks.merge).toHaveBeenCalledWith('queued'));
    // Still running right after the receipt comes back.
    expect(screen.getByText(/导出进度/)).toBeVisible();

    // The poll is what ends it.
    await waitFor(() => expect(useProjectStore.getState().currentProject?.merged_video_url).toBe('/video/queued.mp4'), { timeout: 4000 });
});

it('does not call a long export failed when a gateway gives up on it', async () => {
    // The export that prompted this had already produced its file when the browser was
    // handed a 502; reporting that as a failure hides a finished result.
    const project = { id: 'gateway', title: 'Gateway',
        frames: [{ id: 'shot', selected_video_id: 'take' }],
        video_tasks: [{ id: 'take', status: 'completed', video_url: '/video/take.mp4' }] } as unknown as Project;
    useProjectStore.setState({ currentProject: project, projects: [project] });
    mocks.merge.mockRejectedValue(Object.assign(new Error('Request failed with status code 502'),
        { isAxiosError: true, response: { status: 502, data: {} } }));
    mocks.get.mockResolvedValue({ ...project, merge_progress: { stage: 'done', progress: 1, message: '导出完成' }, merged_video_url: '/video/gateway.mp4' });
    renderWithIntl(<VideoAssembly />);

    fireEvent.click(screen.getByRole('button', { name: '导出' }));
    await waitFor(() => expect(mocks.merge).toHaveBeenCalled());
    // Polling carries on and finds the finished file.
    await waitFor(() => expect(useProjectStore.getState().currentProject?.merged_video_url).toBe('/video/gateway.mp4'), { timeout: 4000 });
});
