import { getWorkspaceId } from "../workspace/workspaceStore";

// Workspace-scoped keys fold in the active workspace id (read from the module-global
// store) so each workspace gets its own cache bucket and a switch can't show stale
// cross-workspace data (23-D). Getters re-read the current workspace at access time,
// so both the useQuery and its invalidations resolve to the same key within a render.
// `meetings` is deliberately global (the calendar is per-user, not per-workspace).
export const keys = {
  get todos() { return ["todos", getWorkspaceId()] as const; },
  get folders() { return ["folders", getWorkspaceId()] as const; },
  get noteCards() { return ["noteCards", getWorkspaceId()] as const; },
  get tags() { return ["tags", getWorkspaceId()] as const; },
  note: (id: string) => ["note", getWorkspaceId(), id] as const,
  actions: (noteId: string) => ["actions", getWorkspaceId(), noteId] as const,
  meetings: (date: string) => ["meetings", date] as const,
  // Global — the workspace list is per-user, not per-workspace (23-E). A plain value
  // (not a getter), and preserved across a workspace switch (see WorkspaceProvider).
  workspaces: ["workspaces"] as const,
};
