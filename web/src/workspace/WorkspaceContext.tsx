import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, type ReactNode } from "react";
import { useParams } from "react-router";
import { WorkspaceContext } from "./context";
import { DEFAULT_WORKSPACE_ID, getWorkspaceId, setWorkspaceId } from "./workspaceStore";

// Derives the active workspace from the `/w/:wsId` route param, keeps the
// module-global workspaceStore in sync (so the api client + query keys target the
// right workspace), and drops the previous workspace's cached queries on switch so
// no stale cross-workspace data flashes (23-D optimistic-UI AC).
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { wsId = DEFAULT_WORKSPACE_ID } = useParams();
  const qc = useQueryClient();

  // Sync synchronously (not in an effect) so a query firing on this render already
  // sees the active workspace — otherwise the first fetch after a switch targets the
  // previous workspace.
  if (getWorkspaceId() !== wsId) setWorkspaceId(wsId);

  const prev = useRef(wsId);
  useEffect(() => {
    if (prev.current !== wsId) {
      // Drop the previous workspace's scoped caches, but keep the global workspace
      // list (23-E) — the switcher reads it and it must survive a switch.
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== "workspaces" });
      prev.current = wsId;
    }
  }, [wsId, qc]);

  return <WorkspaceContext.Provider value={wsId}>{children}</WorkspaceContext.Provider>;
}
