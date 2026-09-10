// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createProject: vi.fn(),
  getProject: vi.fn(),
  updateModelSettings: vi.fn(),
  updatePromptConfig: vi.fn(),
}));

vi.mock('@/lib/api', () => ({api: mocks}));

import { useProjectStore } from '@/store/projectStore';

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  localStorage.setItem('omni_studio.activeWorkspaceId', 'workspace-a');
  useProjectStore.setState({projects:[], currentProject:null, isLoading:false});
  mocks.createProject.mockResolvedValue({id:'episode-new', title:'New episode', frames:[]});
  mocks.getProject.mockResolvedValue({id:'episode-new', title:'New episode', frames:[]});
  mocks.updatePromptConfig.mockResolvedValue({});
});

it('inherits Workspace model defaults without copying the browser cache into Episode overrides', async () => {
  localStorage.setItem('omni_studio_default_model_settings', JSON.stringify({i2v_model:'workspace-i2v'}));
  localStorage.setItem('omni_studio_default_prompt_config', JSON.stringify({storyboard_polish:'Workspace prompt'}));

  await useProjectStore.getState().createProject('New episode', 'Scene text', true, 'r2v');

  expect(mocks.updateModelSettings).not.toHaveBeenCalled();
  expect(mocks.updatePromptConfig).toHaveBeenCalledWith('episode-new', {storyboard_polish:'Workspace prompt'});
});
