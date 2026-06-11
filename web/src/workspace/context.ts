import { createContext, useContext } from "react";
import { DEFAULT_WORKSPACE_ID } from "./workspaceStore";

// Split from WorkspaceContext.tsx (which exports the provider component) so the
// hook + context live in a component-free module — mirrors auth/context.ts and
// keeps React Fast Refresh happy.
export const WorkspaceContext = createContext<string>(DEFAULT_WORKSPACE_ID);

export function useCurrentWorkspace(): string {
  return useContext(WorkspaceContext);
}
