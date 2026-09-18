export interface ProjectStepLocation {
  projectId: string;
  stepId: string;
}

export function readProjectStep(hash: string): ProjectStepLocation | null {
  const match = hash.match(/^#\/project\/([^#/?]+)(?:#([^#/?]*))?$/);
  if (!match) return null;
  return { projectId: decodeURIComponent(match[1]), stepId: match[2] || 'script' };
}

export function buildProjectStepHash(projectId: string, stepId: string): string {
  return `#/project/${encodeURIComponent(projectId)}#${encodeURIComponent(stepId)}`;
}
