import { screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { renderWithIntl } from '@/test/renderWithIntl';

// Mock framer-motion
vi.mock('framer-motion', () => ({
    motion: {
        div: ({ children, ...props }: any) => {
            const { whileHover, whileTap, initial, animate, exit, variants, transition, layoutId, ...rest } = props;
            return <div {...rest}>{children}</div>;
        },
        aside: ({ children, ...props }: any) => {
            const { initial, animate, transition, ...rest } = props;
            return <aside {...rest}>{children}</aside>;
        },
        button: ({ children, ...props }: any) => {
            const { whileHover, whileTap, initial, animate, exit, transition, ...rest } = props;
            return <button {...rest}>{children}</button>;
        },
    },
    AnimatePresence: ({ children }: any) => <>{children}</>,
}));

// Mock AssetCard
vi.mock('@/components/common/AssetCard', () => ({
    default: ({ asset, type }: any) => (
        <div data-testid={`asset-card-${asset.id}`}>{asset.name}</div>
    ),
}));

// Mock API
const mockGetSeries = vi.fn();
const mockGetSeriesEpisodes = vi.fn();
const mockUpdateSeries = vi.fn();
const mockCreateProject = vi.fn();
const mockAddEpisodeToSeries = vi.fn();
const mockCreateEpisodeForSeries = vi.fn();

vi.mock('@/lib/api', () => ({
    api: {
        getSeries: (...args: any[]) => mockGetSeries(...args),
        getSeriesEpisodes: (...args: any[]) => mockGetSeriesEpisodes(...args),
        updateSeries: (...args: any[]) => mockUpdateSeries(...args),
        createProject: (...args: any[]) => mockCreateProject(...args),
        addEpisodeToSeries: (...args: any[]) => mockAddEpisodeToSeries(...args),
        createEpisodeForSeries: (...args: any[]) => mockCreateEpisodeForSeries(...args),
    },
}));

import SeriesDetailPage from '../SeriesDetailPage';

// ── Test Data ──

const mockSeries = {
    id: 'series-1',
    title: '测试系列',
    description: '这是一个测试系列',
    characters: [
        { id: 'char-1', name: '角色A', description: '描述A' },
        { id: 'char-2', name: '角色B', description: '描述B' },
    ],
    scenes: [
        { id: 'scene-1', name: '场景A', description: '场景描述A' },
    ],
    props: [],
    episode_ids: ['ep-1', 'ep-2'],
    created_at: Date.now(),
    updated_at: Date.now(),
};

const mockEpisodes = [
    { id: 'ep-1', title: '第一集', episode_number: 1, frames: [{ id: 'f1' }] },
    { id: 'ep-2', title: '第二集', episode_number: 2, frames: [] },
];

// ── Helpers ──

function renderPage(seriesId = 'series-1') {
    return renderWithIntl(<SeriesDetailPage seriesId={seriesId} />);
}

// ── Tests ──

describe('SeriesDetailPage', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetSeries.mockResolvedValue(mockSeries);
        mockGetSeriesEpisodes.mockResolvedValue(mockEpisodes);
    });

    // ── Rendering ──

    describe('Rendering', () => {
        it('shows loading state initially', () => {
            mockGetSeries.mockReturnValue(new Promise(() => {}));
            mockGetSeriesEpisodes.mockReturnValue(new Promise(() => {}));
            renderPage();
            expect(screen.getByText('加载中...')).toBeInTheDocument();
        });

        it('shows series title after loading', async () => {
            renderPage();
            await waitFor(() => {
                expect(screen.getAllByText('测试系列').length).toBeGreaterThanOrEqual(1);
            });
        });

        it('shows series description', async () => {
            renderPage();
            await waitFor(() => {
                expect(screen.getByText('这是一个测试系列')).toBeInTheDocument();
            });
        });
    });

    // ── Error state ──

    describe('Error state', () => {
        it('shows error view when API fails', async () => {
            mockGetSeries.mockRejectedValue(new Error('Network error'));
            mockGetSeriesEpisodes.mockRejectedValue(new Error('Network error'));
            renderPage();
            await waitFor(() => {
                expect(screen.getByText('系列未找到')).toBeInTheDocument();
            });
        });

        it('shows link to go back to home on error', async () => {
            mockGetSeries.mockRejectedValue(new Error('fail'));
            mockGetSeriesEpisodes.mockRejectedValue(new Error('fail'));
            renderPage();
            await waitFor(() => {
                expect(screen.getByText('返回首页')).toBeInTheDocument();
            });
        });
    });

    // ── Assets display / Sidebar navigation ──

    describe('Assets display', () => {
        it('shows characters as default content with asset cards', async () => {
            renderPage();
            await waitFor(() => {
                expect(screen.getAllByText('测试系列').length).toBeGreaterThanOrEqual(1);
            });
            // Sidebar shows asset tabs
            expect(screen.getAllByText('角色').length).toBeGreaterThanOrEqual(1);
            // Content area shows character assets
            expect(screen.getByText('角色A')).toBeInTheDocument();
            expect(screen.getByText('角色B')).toBeInTheDocument();
        });

        it('switches to scenes when clicked in sidebar', async () => {
            renderPage();
            await waitFor(() => {
                expect(screen.getAllByText('测试系列').length).toBeGreaterThanOrEqual(1);
            });
            fireEvent.click(screen.getByText('场景'));
            await waitFor(() => {
                expect(screen.getByText('场景A')).toBeInTheDocument();
            });
        });

        it('shows empty state when props tab has no assets', async () => {
            renderPage();
            await waitFor(() => {
                expect(screen.getAllByText('测试系列').length).toBeGreaterThanOrEqual(1);
            });
            fireEvent.click(screen.getByText('道具'));
            await waitFor(() => {
                expect(screen.getByText('暂无道具资产')).toBeInTheDocument();
            });
        });

        it('displays asset counts in sidebar', async () => {
            renderPage();
            await waitFor(() => {
                expect(screen.getAllByText('测试系列').length).toBeGreaterThanOrEqual(1);
            });
            // Characters: 2, Scenes: 1, Props: 0
            expect(screen.getByText('2')).toBeInTheDocument();
            expect(screen.getAllByText('1').length).toBeGreaterThanOrEqual(1);
            expect(screen.getAllByText('0').length).toBeGreaterThanOrEqual(1);
        });
    });

    // ── Episode list in sidebar ──

    describe('Episode list', () => {
        it('shows episode list with titles in sidebar', async () => {
            renderPage();
            await waitFor(() => {
                expect(screen.getByText('第一集')).toBeInTheDocument();
            });
            expect(screen.getByText('第二集')).toBeInTheDocument();
        });

        it('shows episode numbers', async () => {
            renderPage();
            await waitFor(() => {
                expect(screen.getByText('EP1')).toBeInTheDocument();
            });
            expect(screen.getByText('EP2')).toBeInTheDocument();
        });

        it('shows episode content panel when clicked, then navigates via button', async () => {
            renderPage();
            await waitFor(() => {
                expect(screen.getByText('第一集')).toBeInTheDocument();
            });
            // Click episode in sidebar to show preview
            fireEvent.click(screen.getByText('第一集'));
            await waitFor(() => {
                expect(screen.getByText('进入编辑器')).toBeInTheDocument();
            });
            // Click "进入编辑器" to navigate
            fireEvent.click(screen.getByText('进入编辑器'));
            expect(window.location.hash).toBe('#/series/series-1/episode/ep-1');
        });

        it('shows episodes count in sidebar header', async () => {
            renderPage();
            await waitFor(() => {
                expect(screen.getByText('集数 (2)')).toBeInTheDocument();
            });
        });
    });

    // ── Empty episode state ──

    describe('Empty episode state', () => {
        it('shows empty state when no episodes', async () => {
            mockGetSeriesEpisodes.mockResolvedValue([]);
            renderPage();
            await waitFor(() => {
                expect(screen.getByText('暂无集数')).toBeInTheDocument();
            });
        });
    });

    // ── Edit title ──

    describe('Edit title', () => {
        it('enters edit mode on double click', async () => {
            renderPage();
            await waitFor(() => {
                expect(screen.getAllByText('测试系列').length).toBeGreaterThanOrEqual(1);
            });
            const titleEl = screen.getAllByText('测试系列').find(el => el.tagName === 'H1')!;
            fireEvent.doubleClick(titleEl);
            const input = screen.getByDisplayValue('测试系列');
            expect(input).toBeInTheDocument();
            expect(input.tagName).toBe('INPUT');
        });

        it('saves title on blur', async () => {
            mockUpdateSeries.mockResolvedValue({});
            renderPage();
            await waitFor(() => {
                expect(screen.getAllByText('测试系列').length).toBeGreaterThanOrEqual(1);
            });
            const titleEl = screen.getAllByText('测试系列').find(el => el.tagName === 'H1')!;
            fireEvent.doubleClick(titleEl);
            const input = screen.getByDisplayValue('测试系列');
            fireEvent.change(input, { target: { value: '新标题' } });
            fireEvent.blur(input);
            await waitFor(() => {
                expect(mockUpdateSeries).toHaveBeenCalledWith('series-1', { title: '新标题' });
            });
        });

        it('saves title on Enter key', async () => {
            mockUpdateSeries.mockResolvedValue({});
            renderPage();
            await waitFor(() => {
                expect(screen.getAllByText('测试系列').length).toBeGreaterThanOrEqual(1);
            });
            const titleEl = screen.getAllByText('测试系列').find(el => el.tagName === 'H1')!;
            fireEvent.doubleClick(titleEl);
            const input = screen.getByDisplayValue('测试系列');
            fireEvent.change(input, { target: { value: '回车标题' } });
            fireEvent.keyDown(input, { key: 'Enter' });
            await waitFor(() => {
                expect(mockUpdateSeries).toHaveBeenCalledWith('series-1', { title: '回车标题' });
            });
        });

        it('cancels edit on Escape key', async () => {
            renderPage();
            await waitFor(() => {
                expect(screen.getAllByText('测试系列').length).toBeGreaterThanOrEqual(1);
            });
            const titleEl = screen.getAllByText('测试系列').find(el => el.tagName === 'H1')!;
            fireEvent.doubleClick(titleEl);
            const input = screen.getByDisplayValue('测试系列');
            fireEvent.change(input, { target: { value: '取消的标题' } });
            fireEvent.keyDown(input, { key: 'Escape' });
            await waitFor(() => {
                expect(screen.getAllByText('测试系列').length).toBeGreaterThanOrEqual(1);
            });
            expect(mockUpdateSeries).not.toHaveBeenCalled();
        });

        it('reverts title if API fails', async () => {
            mockUpdateSeries.mockRejectedValue(new Error('API error'));
            renderPage();
            await waitFor(() => {
                expect(screen.getAllByText('测试系列').length).toBeGreaterThanOrEqual(1);
            });
            const titleEl = screen.getAllByText('测试系列').find(el => el.tagName === 'H1')!;
            fireEvent.doubleClick(titleEl);
            const input = screen.getByDisplayValue('测试系列');
            fireEvent.change(input, { target: { value: '失败标题' } });
            fireEvent.blur(input);
            await waitFor(() => {
                expect(screen.getAllByText('测试系列').length).toBeGreaterThanOrEqual(1);
            });
        });
    });

    // ── Add episode ──

    describe('Add episode', () => {
        it('shows add episode button', async () => {
            renderPage();
            await waitFor(() => {
                expect(screen.getByText('添加集数')).toBeInTheDocument();
            });
        });

        it('shows input form when add button is clicked', async () => {
            renderPage();
            await waitFor(() => {
                expect(screen.getByText('添加集数')).toBeInTheDocument();
            });
            fireEvent.click(screen.getByText('添加集数'));
            expect(screen.getByPlaceholderText('集数标题...')).toBeInTheDocument();
            expect(screen.getByText('确定')).toBeInTheDocument();
            expect(screen.getByText('取消')).toBeInTheDocument();
        });

        it('creates new episode when confirmed', async () => {
            const newProject = { id: 'new-proj', title: '新集数' };
            mockCreateEpisodeForSeries.mockResolvedValue(newProject);
            mockGetSeriesEpisodes.mockResolvedValueOnce(mockEpisodes).mockResolvedValueOnce([
                ...mockEpisodes,
                { id: 'new-proj', title: '新集数', episode_number: 3, frames: [] },
            ]);

            renderPage();
            await waitFor(() => {
                expect(screen.getByText('添加集数')).toBeInTheDocument();
            });
            fireEvent.click(screen.getByText('添加集数'));

            const input = screen.getByPlaceholderText('集数标题...');
            fireEvent.change(input, { target: { value: '新集数' } });
            fireEvent.click(screen.getByText('确定'));

            await waitFor(() => {
                expect(mockCreateEpisodeForSeries).toHaveBeenCalledWith('series-1', '新集数', 3, 'i2v_legacy');
            });
        });

        it('hides form when cancel is clicked', async () => {
            renderPage();
            await waitFor(() => {
                expect(screen.getByText('添加集数')).toBeInTheDocument();
            });
            fireEvent.click(screen.getByText('添加集数'));
            expect(screen.getByPlaceholderText('集数标题...')).toBeInTheDocument();
            fireEvent.click(screen.getByText('取消'));
            expect(screen.queryByPlaceholderText('集数标题...')).not.toBeInTheDocument();
        });

        it('disables confirm button when title is empty', async () => {
            renderPage();
            await waitFor(() => {
                expect(screen.getByText('添加集数')).toBeInTheDocument();
            });
            fireEvent.click(screen.getByText('添加集数'));
            const confirmBtn = screen.getByText('确定');
            expect(confirmBtn).toBeDisabled();
        });
    });
});
