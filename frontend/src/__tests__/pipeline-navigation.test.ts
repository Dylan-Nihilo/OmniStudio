import { describe, expect, it } from 'vitest';
import { buildProjectStepHash, readProjectStep } from '@/lib/pipelineNavigation';

describe('project pipeline navigation', () => {
  it('reads the step from the project hash and builds a stable step URL', () => {
    expect(readProjectStep('#/project/project-1#storyboard')).toEqual({ projectId: 'project-1', stepId: 'storyboard' });
    expect(buildProjectStepHash('project-1', 'storyboard')).toBe('#/project/project-1#storyboard');
  });

  it('uses script when a project has no valid step fragment', () => {
    expect(readProjectStep('#/project/project-1')).toEqual({ projectId: 'project-1', stepId: 'script' });
    expect(readProjectStep('#/project/project-1#')).toEqual({ projectId: 'project-1', stepId: 'script' });
    expect(readProjectStep('#/workspace')).toBeNull();
  });

  it('preserves the parent series when opening and switching an episode step', () => {
    expect(readProjectStep('#/series/series-1/episode/ep-2#cast')).toEqual({ projectId: 'ep-2', seriesId: 'series-1', stepId: 'cast' });
    expect(buildProjectStepHash('ep-2', 'script', '#/series/series-1/episode/ep-2#cast')).toBe('#/series/series-1/episode/ep-2#script');
    expect(buildProjectStepHash('other', 'script', '#/series/series-1/episode/ep-2#cast')).toBe('#/project/other#script');
  });

  it('decodes valid identifiers and safely rejects malformed deep links', () => {
    expect(readProjectStep('#/project/a%20b#art_direction')).toEqual({ projectId: 'a b', stepId: 'art_direction' });
    expect(readProjectStep('#/project/%ZZ#script')).toBeNull();
  });
});
