import { describe, expect, it } from 'vitest';
import { episodeAssets } from '@/lib/episodeAssets';

describe('episode asset presentation', () => {
  it('keeps local drafts and referenced shared assets without displaying the whole library', () => {
    const project = {
      characters: [
        { id: 'local', source: 'episode' }, { id: 'legacy' },
        { id: 'used', source: 'global' }, { id: 'test', source: 'global' },
        { id: 'series-unused', source: 'series' },
      ],
      scenes: [{ id: 'room', source: 'series' }, { id: 'elsewhere', source: 'global' }],
      props: [{ id: 'box', source: 'global' }],
      frames: [{ character_ids: ['used'], scene_id: 'room', prop_ids: ['box'] }],
    };
    const result = episodeAssets(project);
    expect(result.characters.map(x => x.id)).toEqual(['local', 'legacy', 'used']);
    expect(result.scenes.map(x => x.id)).toEqual(['room']);
    expect(result.props.map(x => x.id)).toEqual(['box']);
    expect(project.characters).toHaveLength(5);
  });
  it('handles a project that has not loaded', () => {
    expect(episodeAssets(null)).toEqual({ characters: [], scenes: [], props: [] });
  });
});
