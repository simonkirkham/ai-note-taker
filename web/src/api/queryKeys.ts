import { getWorkspaceId } from "../workspace/workspaceStore";

// Workspace-scoped keys fold in the active workspace id (read from the module-global
// store) so each workspace gets its own cache bucket and a switch can't show stale
// cross-workspace data (23-D). Getters re-read the current workspace at access time,
// so both the useQuery and its invalidations resolve to the same key within a render.
export const keys = {
  get todos() { return ["todos", getWorkspaceId()] as const; },
  get folders() { return ["folders", getWorkspaceId()] as const; },
  get noteCards() { return ["noteCards", getWorkspaceId()] as const; },
  get tags() { return ["tags", getWorkspaceId()] as const; },
  note: (id: string) => ["note", getWorkspaceId(), id] as const,
  actions: (noteId: string) => ["actions", getWorkspaceId(), noteId] as const,
  // Workspace-scoped since 34-B: each workspace backs its meetings list with its own
  // connected calendar, so a switch must refetch rather than show the other's meetings.
  meetings: (date: string) => ["meetings", getWorkspaceId(), date] as const,
  // Workspace-scoped since 34-B: the calendar connection is keyed by workspace, so the
  // "Connect calendar" / "Connected as …" state follows the active workspace.
  get calendarConnection() { return ["calendarConnection", getWorkspaceId()] as const; },
  // Global — the workspace list is per-user, not per-workspace (23-E). A plain value
  // (not a getter), and preserved across a workspace switch (see WorkspaceProvider).
  workspaces: ["workspaces"] as const,
};
