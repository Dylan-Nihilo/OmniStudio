import { expect, it, vi } from 'vitest';
const remove = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ api: { deleteProject: remove }, API_URL: 'http://localhost:17177' }));

it('preserves local projects when deletion fails and removes them only after server success', async () => {
  const { useProjectStore } = await import('@/store/projectStore');
  const project = { id: 'delete-target', title: 'Keep this project' } as never;
  useProjectStore.setState({ projects: [project], currentProject: project });
  remove.mockRejectedValueOnce(new Error('Server unavailable'));
  await expect(useProjectStore.getState().deleteProject('delete-target')).rejects.toThrow('Server unavailable');
  expect(useProjectStore.getState().projects).toEqual([project]);
  expect(useProjectStore.getState().currentProject).toEqual(project);
  remove.mockResolvedValueOnce(undefined);
  await useProjectStore.getState().deleteProject('delete-target');
  expect(useProjectStore.getState().projects).toEqual([]);
  expect(useProjectStore.getState().currentProject).toBeNull();
});
