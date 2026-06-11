// Module-global active workspace id, mirroring auth/tokenStore so the non-React
// api client (api/client.ts) and the query keys can read the active workspace
// without prop-drilling. Set by WorkspaceProvider from the `/w/:wsId` route param.
export const DEFAULT_WORKSPACE_ID = "__default__";

// Empty until a WorkspaceProvider mounts and sets it from the route. While empty, the
// api client sends un-prefixed paths so component tests that render a subtree without
// the router need no changes (msw intercepts those; the rootless backend routes were
// removed in 23-G). In the real app every screen is under `/w/:wsId`, so it is always
// set and scoped calls are always prefixed.
let _workspaceId = "";

export const getWorkspaceId = (): string => _workspaceId;
export const setWorkspaceId = (id: string | undefined): void => {
  _workspaceId = id && id.length > 0 ? id : DEFAULT_WORKSPACE_ID;
};

// Test-only: clear the module-global back to "unset" so the active workspace never
// leaks across tests (it is process-wide state; see setup.ts afterEach).
export const resetWorkspaceForTests = (): void => {
  _workspaceId = "";
};
