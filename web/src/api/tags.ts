import { request, requestVoidWithResponse } from './client'
import { captureNoteToken } from './notes'

export interface TagIndexEntry {
  tag: string;
  noteCount: number;
  noteIds: string[];
}

// Tagging is a note-aggregate flow: capture the write token (RYW-2) so the next note/cards read
// waits on the projector. On an accepted 409/404 no-op the server sends no token — captureNoteToken
// ignores the missing header.
export async function tagNote(noteId: string, tag: string): Promise<void> {
  const response = await requestVoidWithResponse(`/notes/${noteId}/tags`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tag }),
  }, [409]);
  captureNoteToken(noteId, response);
}

export async function untagNote(noteId: string, tag: string): Promise<void> {
  // 404/409 are accepted: removing a tag the server doesn't have matches the user's
  // intent (the tag is already gone), and must not roll the optimistic removal back
  // into a phantom pill. Mirrors tagNote() accepting 409 on a duplicate add (BUG-17).
  const response = await requestVoidWithResponse(`/notes/${noteId}/tags/${encodeURIComponent(tag)}`, { method: "DELETE" }, [404, 409]);
  captureNoteToken(noteId, response);
}

export async function getTags(): Promise<TagIndexEntry[]> {
  const body = await request<{ tags: TagIndexEntry[] }>(`/tags`);
  return body.tags;
}
