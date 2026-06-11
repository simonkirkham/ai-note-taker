import { apiFetch, base, request } from "./client";

export type Workspace = {
  workspaceId: string;
  name: string;
  isDefault: boolean;
};

// Thrown when DELETE /workspaces/{id} returns 409 (the workspace still holds an
// active note). Lets the mutation surface the inline "not empty" error distinctly
// from a generic failure.
export class WorkspaceNotEmptyError extends Error {
  constructor() {
    super("Workspace is not empty");
    this.name = "WorkspaceNotEmptyError";
  }
}

export async function getWorkspaces(): Promise<Workspace[]> {
  const { workspaces } = await request<{ workspaces: Workspace[] }>("/workspaces");
  return workspaces;
}

export async function createWorkspace(name: string): Promise<{ workspaceId: string }> {
  return request<{ workspaceId: string }>("/workspaces", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
}

export async function renameWorkspace(workspaceId: string, name: string): Promise<void> {
  const res = await apiFetch(`${base}/workspaces/${workspaceId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(`PATCH /workspaces/${workspaceId} failed: ${res.status}`);
}

export async function deleteWorkspace(workspaceId: string): Promise<void> {
  const res = await apiFetch(`${base}/workspaces/${workspaceId}`, { method: "DELETE" });
  if (res.status === 409) throw new WorkspaceNotEmptyError();
  if (!res.ok) throw new Error(`DELETE /workspaces/${workspaceId} failed: ${res.status}`);
}
