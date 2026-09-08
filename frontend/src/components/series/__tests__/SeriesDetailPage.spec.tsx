import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { vi, it, expect, beforeEach } from 'vitest';
import { renderWithIntl } from '@/test/renderWithIntl';
import SeriesDetailPage from '../SeriesDetailPage';

const mocks = vi.hoisted(() => ({ getSeries: vi.fn(), getSeriesEpisodes: vi.fn(), listSeries: vi.fn(), updateSeries: vi.fn(), createEpisodeForSeries: vi.fn(), reorderSeriesEpisodes:vi.fn(), archiveSeriesEpisode:vi.fn(), restoreSeriesEpisode:vi.fn(), previewEpisodeDefaultPromotion:vi.fn(), promoteEpisodeDefaults:vi.fn() }));
vi.mock('@/lib/api', () => ({ api: mocks }));
vi.mock('@/components/layout/AppShell', () => ({ default: ({ children, context }: any) => <>{context}{children}</> }));
vi.mock('@/components/common/AssetCard', () => ({ default: ({ asset }: any) => <div>{asset.name}</div> }));
vi.mock('next/dynamic', () => ({ default: () => () => null }));

const series = { id: 'series-1', title: '测试系列', description: '这是一个测试系列', workflow_mode: 'r2v', characters: [{ id: 'a', name: '角色A' }], scenes: [{ id: 's', name: '场景A' }], props: [], episode_ids: ['ep-1', 'ep-4'] };
const episodes = [{ id: 'ep-1', title: '第一集', episode_number: 1, frames: [{ id: 'f1' }] }, { id: 'ep-4', title: '第四集', episode_number: 4, frames: [] }];
beforeEach(() => {
  vi.resetAllMocks();
  mocks.getSeries.mockResolvedValue(series);
  mocks.getSeriesEpisodes.mockResolvedValue(episodes);
  mocks.listSeries.mockResolvedValue([series]);
});
const renderPage = () => renderWithIntl(<SeriesDetailPage seriesId="series-1" />);

it('reorders actual episode IDs and confirms archive and default promotion using the shared dialogs', async () => {
  mocks.previewEpisodeDefaultPromotion.mockResolvedValue({sections:['model_settings'], changes:{model_settings:{before:{},after:{}}}});
  renderPage();
  await screen.findByRole('heading', {name:'测试系列',level:1});
  const menu = async (name: string) => {
    fireEvent.click(screen.getAllByRole('button', {name:/第 .* 集操作/})[0]);
    fireEvent.click(await screen.findByRole('menuitem', {name}));
  };
  await menu('下移');
  await waitFor(() => expect(mocks.reorderSeriesEpisodes).toHaveBeenCalledWith('series-1',['ep-4','ep-1']));
  await menu('归档');
  expect(mocks.archiveSeriesEpisode).not.toHaveBeenCalled();
  fireEvent.click(await screen.findByRole('button', {name:'确定'}));
  await waitFor(() => expect(mocks.archiveSeriesEpisode).toHaveBeenCalledWith('series-1','ep-1'));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  await menu('设为系列默认');
  fireEvent.click(await screen.findByRole('button', {name:'确定'}));
  await waitFor(() => expect(mocks.promoteEpisodeDefaults).toHaveBeenCalledWith('series-1','ep-1',['model_settings']));
});

it('shows loading, then links actual episodes and retains shared asset navigation', async () => {
  renderPage();
  expect(screen.getByRole('status')).toHaveTextContent('加载中');
  expect(await screen.findByRole('heading', { name: '测试系列', level: 1 })).toBeVisible();
  expect(screen.getByRole('link', { name: /第一集/ })).toHaveAttribute('href', '#/series/series-1/episode/ep-1');
  fireEvent.click(screen.getByRole('button', { name: '角色' }));
  expect(await screen.findByText('角色A')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '场景' }));
  expect(await screen.findByText('场景A')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '道具' }));
  expect(await screen.findByText('暂无道具资产')).toBeVisible();
});

it('recovers from a failed load through the retry action', async () => {
  mocks.getSeries.mockRejectedValueOnce(new Error('offline'));
  renderPage();
  expect(await screen.findByText('系列加载失败，请重试。')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '重试' }));
  expect(await screen.findByRole('heading', { name: '测试系列', level: 1 })).toBeVisible();
});

it('retains edits on API failure, retries the original update contract, and closes on success', async () => {
  mocks.updateSeries.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({});
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: '编辑系列' }));
  const dialog = screen.getByRole('dialog', { name: '编辑系列' });
  const title = within(dialog).getByRole('textbox', { name: '标题' });
  fireEvent.change(title, { target: { value: ' 新标题 ' } });
  fireEvent.click(within(dialog).getByRole('button', { name: '保存' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('保存失败');
  expect(title).toHaveValue(' 新标题 ');
  fireEvent.click(within(dialog).getByRole('button', { name: '保存' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(mocks.updateSeries).toHaveBeenLastCalledWith('series-1', { title: '新标题', description: '这是一个测试系列' });
  expect(screen.getByRole('heading', { name: '新标题', level: 1 })).toBeVisible();
});

it('creates the next episode after the highest existing number using the original workflow', async () => {
  mocks.createEpisodeForSeries.mockResolvedValue({ id: 'ep-5', title: '新集', episode_number: 5, frames: [] });
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: '新建单集' }));
  const dialog = screen.getByRole('dialog', { name: '新建单集' });
  expect(within(dialog).getByRole('button', { name: '保存' })).toBeDisabled();
  fireEvent.change(within(dialog).getByRole('textbox', { name: '标题' }), { target: { value: '新集' } });
  fireEvent.click(within(dialog).getByRole('button', { name: '保存' }));
  await waitFor(() => expect(mocks.createEpisodeForSeries).toHaveBeenCalledWith('series-1', '新集', 5, 'r2v'));
  expect(await screen.findByRole('link', { name: /新集/ })).toHaveAttribute('href', '#/series/series-1/episode/ep-5');
});

it('supports Escape cancellation without saving and gives an empty series a creation action', async () => {
  mocks.getSeriesEpisodes.mockResolvedValue([]);
  renderPage();
  expect(await screen.findByText('暂无集数')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '新建单集' }));
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(mocks.createEpisodeForSeries).not.toHaveBeenCalled();
});
