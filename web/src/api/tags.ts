import { request, requestVoid } from './client'

export interface TagIndexEntry {
  tag: string;
  noteCount: number;
  noteIds: string[];
}

export function tagNote(noteId: string, tag: string): Promise<void> {
  return requestVoid(`/notes/${noteId}/tags`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tag }),
  }, [409]);
}

export function untagNote(noteId: string, tag: string): Promise<void> {
  // 404/409 are accepted: removing a tag the server doesn't have matches the user's
  // intent (the tag is already gone), and must not roll the optimistic removal back
  // into a phantom pill. Mirrors tagNote() accepting 409 on a duplicate add (BUG-17).
  return requestVoid(`/notes/${noteId}/tags/${encodeURIComponent(tag)}`, { method: "DELETE" }, [404, 409]);
}

export async function getTags(): Promise<TagIndexEntry[]> {
  const body = await request<{ tags: TagIndexEntry[] }>(`/tags`);
  return body.tags;
}
