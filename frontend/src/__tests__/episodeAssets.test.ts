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

  it('shows extracted shared assets before storyboard frames exist', () => {
    const project = {
      characters: [
        { id: 'series-character', source: 'series' },
        { id: 'global-character', source: 'global' },
      ],
      scenes: [
        { id: 'series-scene', source: 'series' },
        { id: 'global-scene', source: 'global' },
      ],
      props: [
        { id: 'series-prop', source: 'series' },
        { id: 'global-prop', source: 'global' },
      ],
      frames: [],
    };

    expect(episodeAssets(project)).toEqual({
      characters: [project.characters[0]],
      scenes: [project.scenes[0]],
      props: [project.props[0]],
    });
  });

  it('handles a project that has not loaded', () => {
    expect(episodeAssets(null)).toEqual({ characters: [], scenes: [], props: [] });
  });
});
