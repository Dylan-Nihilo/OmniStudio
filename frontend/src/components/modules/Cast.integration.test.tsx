import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { apiClient } from '@/lib/apiClient';
import { useProjectStore } from '@/store/projectStore';
import { renderWithIntl } from '@/test/renderWithIntl';
import { LightboxProvider } from '@/components/shared/preview/LightboxProvider';
import Cast from './Cast';

const adapter = apiClient.defaults.adapter;
afterEach(() => { apiClient.defaults.adapter = adapter; });

it.each([
  ['新角色', 'characters'], ['新场景', 'scenes'], ['新道具', 'props'],
])('creates %s in an empty standalone project and reloads it', async (label, kind) => {
  const project: any = { id: 'empty-project', title: '空项目', characters: [], scenes: [], props: [], frames: [] };
  useProjectStore.setState({ ...useProjectStore.getInitialState(), currentProject: project, projects: [project] }, true);
  const writes: any[] = [];
  apiClient.defaults.adapter = async config => {
    if (config.method === 'post') {
      expect(config.url).toMatch(new RegExp(`/projects/empty-project/${kind}$`));
      const body = JSON.parse(config.data);
      writes.push(body);
      project[kind] = [{ id: 'new-asset', ...body }];
    }
    return { config, status: 200, statusText: 'OK', headers: {}, data: structuredClone(project) };
  };
  const view = renderWithIntl(<LightboxProvider><Cast /></LightboxProvider>);
  try {
    fireEvent.click(screen.getByRole('button', { name: label }));
    fireEvent.change(screen.getByPlaceholderText('例如：张三'), { target: { value: ' 夜班素材 ' } });
    fireEvent.click(screen.getByRole('button', { name: /^创建/ }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].name).toBe('夜班素材');
    expect(await screen.findByText('夜班素材')).toBeInTheDocument();
  } finally { view.unmount(); }
});


it('keeps series generation behind preview and explicit confirmation', async () => {
  const project: any = { id: 'series-project', series_id: 'series-1', title: '系列项目', characters: [], scenes: [], props: [], frames: [] };
  useProjectStore.setState({ ...useProjectStore.getInitialState(), currentProject: project, projects: [project] }, true);
  const writes: string[] = [];
  apiClient.defaults.adapter = async config => {
    let data: any = structuredClone(project);
    if (config.method === 'post') {
      writes.push(config.url!);
      if (config.url!.endsWith('/preview')) {
        data = { preview_id: 'preview-1', estimated_calls: 1, estimated_cost: 1 };
      } else {
        expect(config.url).toMatch(/\/series\/series-1\/assets\/generate\/confirm$/);
        expect(JSON.parse(config.data)).toEqual({ preview_id: 'preview-1' });
        project.characters = [{ id: 'new-character', name: '夜班员' }];
      }
    }
    return { config, status: 200, statusText: 'OK', headers: {}, data };
  };
  const view = renderWithIntl(<LightboxProvider><Cast /></LightboxProvider>);
  try {
    fireEvent.click(screen.getByRole('button', { name: '新角色' }));
    fireEvent.change(screen.getByPlaceholderText('例如：张三'), { target: { value: '夜班员' } });
    fireEvent.click(screen.getByRole('button', { name: '预览生成计划' }));
    const confirm = await screen.findByRole('button', { name: '确认并开始' });
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatch(/\/series\/series-1\/assets\/generate\/preview$/);
    expect(project.characters).toEqual([]);
    fireEvent.click(confirm);
    await waitFor(() => expect(writes).toHaveLength(2));
    expect(await screen.findByText('夜班员')).toBeInTheDocument();
  } finally { view.unmount(); }
});
