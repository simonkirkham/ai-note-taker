import { request, requestVoid } from './client'

export interface ActionItem {
  actionId: string;
  description: string;
  completed: boolean;
  addedAt: string;
  completedAt: string | null;
}

export async function getActions(noteId: string): Promise<ActionItem[]> {
  const body = await request<{ actions: ActionItem[] }>(`/notes/${noteId}/actions`);
  return body.actions;
}

export function addAction(noteId: string, description: string): Promise<{ actionId: string }> {
  return request<{ actionId: string }>(`/notes/${noteId}/actions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ description }),
  });
}

export function completeAction(noteId: string, actionId: string): Promise<void> {
  return requestVoid(`/notes/${noteId}/actions/${actionId}/complete`, { method: "POST" });
}

export function reopenAction(noteId: string, actionId: string): Promise<void> {
  return requestVoid(`/notes/${noteId}/actions/${actionId}/reopen`, { method: "POST" });
}

export function deleteAction(noteId: string, actionId: string): Promise<void> {
  return requestVoid(`/notes/${noteId}/actions/${actionId}`, { method: "DELETE" });
}
