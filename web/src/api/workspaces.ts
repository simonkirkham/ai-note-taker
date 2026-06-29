import { type Theme } from "../hooks/useTheme";
import { apiFetch, base, requestWithResponse } from "./client";
import { clearLatestToken, getLatestToken, setLatestToken } from "./consistencyTokens";
import { gatedRead } from "./gatedRead";

// Read-your-writes (RYW-3b): the workspace flows are async (the projector builds the workspace
// list). A workspace write returns its write token in `X-Consistency-Token`; the next
// `GET /workspaces` echoes it in `If-Consistent-With` so the server waits until the projector
// applied the write. The list read waits on the single stream the user most recently wrote.
const WORKSPACES_SCOPE = "workspaces";

function captureWorkspaceToken(response: Response): void {
  const token = response.headers.get("X-Consistency-Token");
  if (!token) return;
  setLatestToken(WORKSPACES_SCOPE, token);
}

export type Workspace = {
  workspaceId: string;
  name: string;
  isDefault: boolean;
  // 36-A — per-workspace theme. Absent/null when unset (the synthesised default workspace
  // has no server row and keeps the global localStorage theme).
  theme?: Theme;
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

export function getWorkspaces(): Promise<Workspace[]> {
  return gatedRead<{ workspaces: Workspace[] }>(
    "/workspaces",
    getLatestToken(WORKSPACES_SCOPE),
    () => clearLatestToken(WORKSPACES_SCOPE),
  ).then((body) => body.workspaces);
}

export async function createWorkspace(name: string): Promise<{ workspaceId: string }> {
  const { body, response } = await requestWithResponse<{ workspaceId: string }>("/workspaces", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  captureWorkspaceToken(response);
  return body;
}

export async function renameWorkspace(workspaceId: string, name: string): Promise<void> {
  const res = await apiFetch(`${base}/workspaces/${workspaceId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(`PATCH /workspaces/${workspaceId} failed: ${res.status}`);
  captureWorkspaceToken(res);
}

export async function setWorkspaceTheme(workspaceId: string, theme: string): Promise<void> {
  const res = await apiFetch(`${base}/workspaces/${workspaceId}/theme`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ theme }),
  });
  if (!res.ok) throw new Error(`PATCH /workspaces/${workspaceId}/theme failed: ${res.status}`);
  captureWorkspaceToken(res);
}

export async function deleteWorkspace(workspaceId: string): Promise<void> {
  const res = await apiFetch(`${base}/workspaces/${workspaceId}`, { method: "DELETE" });
  if (res.status === 409) throw new WorkspaceNotEmptyError();
  if (!res.ok) throw new Error(`DELETE /workspaces/${workspaceId} failed: ${res.status}`);
  captureWorkspaceToken(res);
}
