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
