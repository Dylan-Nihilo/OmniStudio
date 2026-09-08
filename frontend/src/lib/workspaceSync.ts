/** Hashes that render the workspace and must reflect the latest backend data. */
export function isWorkspaceRoute(hash: string): boolean {
  return hash === "" || hash === "#/" || hash === "#/workspace" || /^#\/workspace\/(projects|series|drafts)$/.test(hash) || hash === "#/new-project";
}
