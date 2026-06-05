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
  return requestVoid(`/notes/${noteId}/tags/${encodeURIComponent(tag)}`, { method: "DELETE" });
}

export async function getTags(): Promise<TagIndexEntry[]> {
  const body = await request<{ tags: TagIndexEntry[] }>(`/tags`);
  return body.tags;
}
