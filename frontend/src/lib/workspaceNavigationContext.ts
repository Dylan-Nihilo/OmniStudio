const WORKSPACE_CONTEXT_PREFIX = "omni_studio.workspaceContext:";

const storageKey = (userId: string, workspaceId: string): string =>
  `${WORKSPACE_CONTEXT_PREFIX}${encodeURIComponent(userId)}:${encodeURIComponent(workspaceId)}`;

const isPersistableRoute = (hash: string): boolean =>
  typeof hash === "string" && hash.startsWith("#/") && hash !== "#/login" && hash.length <= 512;

export const saveWorkspaceNavigationContext = (
  userId: string | null | undefined,
  workspaceId: string | null | undefined,
  hash: string,
): void => {
  if (typeof window === "undefined" || !userId || !workspaceId || !isPersistableRoute(hash)) return;
  try {
    window.localStorage.setItem(storageKey(userId, workspaceId), hash);
  } catch {
    // Browser storage may be unavailable in hardened webviews.
  }
};

export const loadWorkspaceNavigationContext = (
  userId: string | null | undefined,
  workspaceId: string | null | undefined,
): string | null => {
  if (typeof window === "undefined" || !userId || !workspaceId) return null;
  try {
    const hash = window.localStorage.getItem(storageKey(userId, workspaceId));
    return hash && isPersistableRoute(hash) ? hash : null;
  } catch {
    return null;
  }
};

export const clearWorkspaceNavigationContexts = (): void => {
  if (typeof window === "undefined") return;
  try {
    for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
      const key = window.localStorage.key(index);
      if (key?.startsWith(WORKSPACE_CONTEXT_PREFIX)) window.localStorage.removeItem(key);
    }
  } catch {
    // Ignore restricted localStorage during logout.
  }
};

export { WORKSPACE_CONTEXT_PREFIX };
