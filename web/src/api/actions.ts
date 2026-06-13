import { requestVoidWithResponse, requestWithResponse } from './client';
import { clearLatestToken, getLatestToken, setLatestToken } from './consistencyTokens';
import { gatedRead } from './gatedRead';

// Read-your-writes (RYW-3a): the action flows are async (the projector builds the action read
// models). An action write returns its write token in `X-Consistency-Token`; the next actions read
// echoes it in `If-Consistent-With` so the server waits until the projector applied the write. The
// actions read is a LIST built from many action streams, so it waits on the single stream the user
// most recently wrote (design decision #7) — scoped per note.
function actionsScope(noteId: string): string {
  return `actions:${noteId}`;
}

// Record an action write's token as the latest action write for its note, so the next actions read
// for that note waits on it. A missing header (e.g. a 404/409 no-op) is a no-op.
function captureActionToken(noteId: string, response: Response): void {
  const token = response.headers.get('X-Consistency-Token');
  if (!token) return;
  setLatestToken(actionsScope(noteId), token);
}

export interface ActionItem {
  actionId: string;
  description: string;
  completed: boolean;
  addedAt: string;
  completedAt: string | null;
}

export function getActions(noteId: string): Promise<ActionItem[]> {
  const scope = actionsScope(noteId);
  return gatedRead<{ actions: ActionItem[] }>(
    `/notes/${noteId}/actions`,
    getLatestToken(scope),
    () => clearLatestToken(scope),
  ).then((body) => body.actions);
}

export async function addAction(noteId: string, description: string): Promise<{ actionId: string }> {
  const { body, response } = await requestWithResponse<{ actionId: string }>(`/notes/${noteId}/actions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ description }),
  });
  captureActionToken(noteId, response);
  return body;
}

export async function completeAction(noteId: string, actionId: string): Promise<void> {
  const response = await requestVoidWithResponse(`/notes/${noteId}/actions/${actionId}/complete`, { method: 'POST' });
  captureActionToken(noteId, response);
}

export async function reopenAction(noteId: string, actionId: string): Promise<void> {
  const response = await requestVoidWithResponse(`/notes/${noteId}/actions/${actionId}/reopen`, { method: 'POST' });
  captureActionToken(noteId, response);
}

export async function deleteAction(noteId: string, actionId: string): Promise<void> {
  const response = await requestVoidWithResponse(`/notes/${noteId}/actions/${actionId}`, { method: 'DELETE' });
  captureActionToken(noteId, response);
}
