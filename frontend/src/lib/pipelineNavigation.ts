export interface ProjectStepLocation {
  projectId: string;
  stepId: string;
  seriesId?: string;
}

export function readProjectStep(hash: string): ProjectStepLocation | null {
  try {
    const episode = hash.match(/^#\/series\/([^#/?]+)\/episode\/([^#/?]+)(?:#([^#/?]*))?$/);
    if (episode) return { seriesId: decodeURIComponent(episode[1]), projectId: decodeURIComponent(episode[2]), stepId: decodeURIComponent(episode[3] || 'script') };
    const match = hash.match(/^#\/project\/([^#/?]+)(?:#([^#/?]*))?$/);
    if (!match) return null;
    return { projectId: decodeURIComponent(match[1]), stepId: decodeURIComponent(match[2] || 'script') };
  } catch {
    return null;
  }
}

export function buildProjectStepHash(projectId: string, stepId: string, currentHash = ''): string {
  const current = readProjectStep(currentHash);
  if (current?.projectId === projectId && current.seriesId) {
    return `#/series/${encodeURIComponent(current.seriesId)}/episode/${encodeURIComponent(projectId)}#${encodeURIComponent(stepId)}`;
  }
  return `#/project/${encodeURIComponent(projectId)}#${encodeURIComponent(stepId)}`;
}

export interface ProjectHistoryScope {
  userId: string;
  workspaceId: string;
  projectId: string;
}

interface ProjectHistoryEntry extends ProjectHistoryScope {
  hash: string;
  previousHash?: string;
}

const HISTORY_KEY = 'omniStudioPipeline';

function currentEntry(scope: ProjectHistoryScope): ProjectHistoryEntry | null {
  const entry = window.history.state?.[HISTORY_KEY] as ProjectHistoryEntry | undefined;
  return entry && entry.userId === scope.userId && entry.workspaceId === scope.workspaceId
    && entry.projectId === scope.projectId && entry.hash === window.location.hash ? entry : null;
}

export function initializeProjectHistory(scope: ProjectHistoryScope): void {
  if (readProjectStep(window.location.hash)?.projectId !== scope.projectId || currentEntry(scope)) return;
  // Keep Next.js and other consumers' history fields. A direct entry has no safe predecessor.
  window.history.replaceState({ ...window.history.state, [HISTORY_KEY]: { ...scope, hash: window.location.hash } }, '');
}

export function canGoBackProjectStep(scope: ProjectHistoryScope): boolean {
  const entry = currentEntry(scope);
  const previous = entry?.previousHash && readProjectStep(entry.previousHash);
  const current = readProjectStep(window.location.hash);
  return !!previous && previous.projectId === scope.projectId && current?.projectId === scope.projectId
    && previous.seriesId === current.seriesId;
}

export function navigateProjectStep(scope: ProjectHistoryScope, stepId: string, replace = false): void {
  initializeProjectHistory(scope);
  const oldURL = window.location.href;
  const hash = buildProjectStepHash(scope.projectId, stepId, window.location.hash);
  if (hash === window.location.hash) return;
  const entry = currentEntry(scope);
  const previousHash = replace ? entry?.previousHash : entry?.hash;
  const state = { ...window.history.state, [HISTORY_KEY]: { ...scope, hash, previousHash } };
  if (replace) window.history.replaceState(state, '', hash);
  else window.history.pushState(state, '', hash);
  // pushState/replaceState do not emit hashchange; the existing app router listens for it.
  window.dispatchEvent(new HashChangeEvent('hashchange', { oldURL, newURL: window.location.href }));
}

export function goBackProjectStep(scope: ProjectHistoryScope, parentHash: string): void {
  if (canGoBackProjectStep(scope)) window.history.back();
  else window.location.hash = parentHash;
}
