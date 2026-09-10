import { beforeEach, expect, it, vi } from 'vitest';

const post = vi.hoisted(() => vi.fn());

vi.mock('@/lib/apiClient', () => ({
  API_URL: '/api-proxy',
  apiClient: { post },
}));

import { scriptEditorApi } from '@/lib/scriptEditorApi';

beforeEach(() => post.mockReset());

it('normalizes derive_gaps entities and scene indexes for the editor', async () => {
  post.mockResolvedValue({
    data: {
      entities: [
        {
          type: 'location',
          name: 'Platform',
          confidence: 0.88,
          scene_index: 2,
        },
      ],
      cached: true,
    },
  });

  const response = await scriptEditorApi.deriveGaps('project-1', {});

  expect(response.entities).toEqual([
    expect.objectContaining({ name: 'Platform', sceneIndex: 2 }),
  ]);
  expect(response.results).toEqual(response.entities);
});
