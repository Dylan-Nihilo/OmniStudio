import { act, fireEvent, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useProjectStore, type Project } from '@/store/projectStore';
import { renderWithIntl } from '@/test/renderWithIntl';
import ProductionGuide from './ProductionGuide';

it('guides the saved inventory through style, reference images and storyboard', () => {
    const project = {
        id: 'guide-project', workflow_mode: 'r2v',
        characters: [{ id: 'hero', name: '陆青' }], scenes: [], props: [],
    } as unknown as Project;
    useProjectStore.setState({ ...useProjectStore.getInitialState(), currentProject: project }, true);
    const navigate = vi.fn();
    document.addEventListener('omni_studio:navigateStep', navigate);
    const view = renderWithIntl(<ProductionGuide stage="script" />);
    try {
        expect(screen.getByText('素材清单已保存到「本集素材」')).toBeVisible();
        expect(screen.getByText(/1 个角色 · 0 个场景 · 0 个道具/)).not.toBeVisible();
        fireEvent.click(screen.getByText('素材清单已保存到「本集素材」'));
        expect(screen.getByText(/1 个角色 · 0 个场景 · 0 个道具/)).toBeVisible();
        fireEvent.click(screen.getByRole('button', { name: '去定画风' }));
        expect(navigate.mock.lastCall?.[0].detail).toBe('art_direction');
        fireEvent.click(screen.getByRole('button', { name: '查看素材清单' }));
        expect(navigate.mock.lastCall?.[0].detail).toBe('cast');

        view.unmount();
        const assets = renderWithIntl(<ProductionGuide stage="assets" ready={1} />);
        try {
            expect(screen.getByRole('button', { name: '去定画风' })).toBeVisible();
            expect(screen.queryByText('素材参考图已就绪')).not.toBeInTheDocument();
            act(() => useProjectStore.setState({ currentProject: {
                ...project, art_direction: { style_config: { id: 'anime', name: '动漫', positive_prompt: 'anime' } },
            } as Project }));
            expect(screen.getByText('素材参考图已就绪')).toBeVisible();
            fireEvent.click(screen.getByRole('button', { name: '前往分镜' }));
            expect(navigate.mock.lastCall?.[0].detail).toBe('storyboard_r2v');
        } finally { assets.unmount(); }
    } finally {
        view.unmount();
        document.removeEventListener('omni_studio:navigateStep', navigate);
        useProjectStore.setState(useProjectStore.getInitialState(), true);
    }
});
