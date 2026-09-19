// @vitest-environment jsdom
import { beforeEach, expect, it } from 'vitest';
import { canGoBackProjectStep, initializeProjectHistory, navigateProjectStep, goBackProjectStep } from '@/lib/pipelineNavigation';

const scope = { userId: 'user-1', workspaceId: 'ws-1', projectId: 'ep-1' };
beforeEach(() => window.history.replaceState({ nextRouter: 'preserved' }, '', '#/project/ep-1#script'));
const traverse = (action: () => void) => new Promise<void>(resolve => {
  window.addEventListener('popstate', () => resolve(), { once: true });
  action();
});

it('returns through real browser history, supports forward and retains history after reinitialization', async () => {
  initializeProjectHistory(scope);
  expect(canGoBackProjectStep(scope)).toBe(false);
  const length = window.history.length;
  navigateProjectStep(scope, 'storyboard_r2v');
  expect(window.location.hash).toBe('#/project/ep-1#storyboard_r2v');
  expect(window.history.state.nextRouter).toBe('preserved');
  initializeProjectHistory(scope); // same initialization used after reload
  expect(canGoBackProjectStep(scope)).toBe(true);
  navigateProjectStep(scope, 'storyboard_r2v');
  expect(window.history.length).toBe(length + 1);
  await traverse(() => goBackProjectStep(scope, '#/workspace'));
  expect(window.location.hash).toBe('#/project/ep-1#script');
  expect(canGoBackProjectStep(scope)).toBe(false);
  await traverse(() => window.history.forward());
  expect(window.location.hash).toBe('#/project/ep-1#storyboard_r2v');
  expect(canGoBackProjectStep(scope)).toBe(true);
});

it('keeps series episode routes and falls back to the series on direct entry', () => {
  window.history.replaceState(null, '', '#/series/s-1/episode/ep-1#cast');
  initializeProjectHistory(scope);
  expect(canGoBackProjectStep(scope)).toBe(false);
  navigateProjectStep(scope, 'script');
  expect(window.location.hash).toBe('#/series/s-1/episode/ep-1#script');
  window.history.replaceState(null, '', '#/series/s-1/episode/ep-1#cast');
  goBackProjectStep(scope, '#/series/s-1');
  expect(window.location.hash).toBe('#/series/s-1');
});

it.each([
  { ...scope, userId: 'user-2' },
  { ...scope, workspaceId: 'ws-2' },
  { ...scope, projectId: 'ep-2' },
])('does not consume history belonging to a different context: %j', changedScope => {
  initializeProjectHistory(scope);
  navigateProjectStep(scope, 'cast');
  expect(canGoBackProjectStep(changedScope)).toBe(false);
  goBackProjectStep(changedScope, '#/workspace');
  expect(window.location.hash).toBe('#/workspace');
});

it('does not reuse copied state after an unmanaged hash change', () => {
  initializeProjectHistory(scope);
  navigateProjectStep(scope, 'cast');
  window.history.pushState(window.history.state, '', '#/project/ep-1#assembly');
  initializeProjectHistory(scope);
  expect(canGoBackProjectStep(scope)).toBe(false);
});
