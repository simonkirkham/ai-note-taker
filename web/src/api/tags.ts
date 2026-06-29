import { backoffMs, requestVoidWithResponse, request, sleep } from './client'
import { captureNoteToken } from './notes'

export interface TagIndexEntry {
  tag: string;
  noteCount: number;
  noteIds: string[];
}

// A multi-tag add ("1:1s Bill") fans into concurrent POSTs on the SAME note stream; persistent
// optimistic-concurrency contention now surfaces as a RETRIABLE 503 (BUG-27), kept DISTINCT from
// the duplicate-tag 409 no-op. Retry the write a bounded number of times on 503 so it lands; on
// the final attempt 503 is no longer accepted, so it throws and the optimistic mutation rolls
// back rather than leaving a phantom pill over an unpersisted write. A 409 stays an accepted
// no-op (the tag is genuinely already there / already gone). apiFetch does NOT transport-retry
// POST/DELETE, so the retry lives here, at the contention-aware layer.
const MAX_CONTENTION_RETRIES = 4;

export async function tagNote(noteId: string, tag: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    const last = attempt >= MAX_CONTENTION_RETRIES;
    const response = await requestVoidWithResponse(`/notes/${noteId}/tags`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tag }),
    }, last ? [409] : [409, 503]);
    if (response.status === 503) { await sleep(backoffMs(attempt + 1)); continue; }
    captureNoteToken(noteId, response);
    return;
  }
}

export async function untagNote(noteId: string, tag: string): Promise<void> {
  // 404/409 are accepted: removing a tag the server doesn't have matches the user's intent (the
  // tag is already gone), and must not roll the optimistic removal back into a phantom pill.
  // A 503 is retried like tagNote (BUG-27 write contention), throwing on the final attempt.
  for (let attempt = 0; ; attempt++) {
    const last = attempt >= MAX_CONTENTION_RETRIES;
    const response = await requestVoidWithResponse(
      `/notes/${noteId}/tags/${encodeURIComponent(tag)}`,
      { method: "DELETE" },
      last ? [404, 409] : [404, 409, 503]);
    if (response.status === 503) { await sleep(backoffMs(attempt + 1)); continue; }
    captureNoteToken(noteId, response);
    return;
  }
}

export async function getTags(): Promise<TagIndexEntry[]> {
  const body = await request<{ tags: TagIndexEntry[] }>(`/tags`);
  return body.tags;
}
