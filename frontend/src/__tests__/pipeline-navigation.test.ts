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
});
