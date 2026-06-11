import { type ReactNode } from "react";
import { useParams } from "react-router";
import { WorkspaceContext } from "./context";
import { DEFAULT_WORKSPACE_ID, getWorkspaceId, setWorkspaceId } from "./workspaceStore";

// Derives the active workspace from the `/w/:wsId` route param and keeps the
// module-global workspaceStore in sync (so the api client + query keys target the
// right workspace).
//
// No cache eviction on switch: query keys fold in the active workspace id (see
// queryKeys.ts), so each workspace already has its own cache bucket and a switch can
// never show another workspace's data. A previous `removeQueries` on switch matched by
// query *name*, so it deleted the brand-new current-workspace queries mid-fetch — the
// observers were then stuck in `pending`/`idle` (loading forever) even though the
// requests returned 200. Relying on the wsId-scoped keys is both correct and simpler.
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { wsId = DEFAULT_WORKSPACE_ID } = useParams();

  // Sync synchronously (not in an effect) so a query firing on this render already
  // sees the active workspace — otherwise the first fetch after a switch targets the
  // previous workspace.
  if (getWorkspaceId() !== wsId) setWorkspaceId(wsId);

  return <WorkspaceContext.Provider value={wsId}>{children}</WorkspaceContext.Provider>;
}
