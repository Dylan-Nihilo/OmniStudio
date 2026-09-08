// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({getProject:vi.fn(),getSeries:vi.fn(),listSeries:vi.fn()}));
vi.mock('@/lib/api', () => ({api:mocks}));
import { useProjectStore } from '@/store/projectStore';

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  localStorage.setItem('omni_studio.activeWorkspaceId','workspace-a');
  useProjectStore.setState({projects:[],currentProject:null,seriesList:[],currentSeries:null});
});

it.each(['selectProject','fetchSeries','fetchSeriesList'] as const)('discards %s responses after switching workspaces', async action => {
  let finish!: (value: unknown) => void;
  Object.values(mocks).forEach(mock => mock.mockImplementation(() => new Promise(resolve => {finish=resolve;})));
  const pending = useProjectStore.getState()[action]('old-object');
  localStorage.setItem('omni_studio.activeWorkspaceId','workspace-b');
  useProjectStore.setState({projects:[],currentProject:null,seriesList:[],currentSeries:null});
  finish(action === 'fetchSeriesList' ? [{id:'old-object'}] : {id:'old-object'});
  await pending;
  expect(useProjectStore.getState()).toMatchObject({projects:[],currentProject:null,seriesList:[],currentSeries:null});
  expect(localStorage.getItem('project-storage:anonymous:workspace-b')).not.toContain('old-object');
});

it('ignores a previous episode parent series when a standalone project is selected', async () => {
  let finish!: (value: unknown) => void;
  mocks.getProject.mockResolvedValueOnce({id:'episode',series_id:'series-old'}).mockResolvedValueOnce({id:'standalone'});
  mocks.getSeries.mockReturnValue(new Promise(resolve => {finish=resolve;}));
  await useProjectStore.getState().selectProject('episode');
  await useProjectStore.getState().selectProject('standalone');
  finish({id:'series-old'});
  await Promise.resolve();
  expect(useProjectStore.getState().currentSeries).toBeNull();
});
