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
