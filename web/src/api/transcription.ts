import { request, requestVoid } from './client'

export interface TranscriptionCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  expiration: string;
  region: string;
}

export function getTranscriptionCredentials(): Promise<TranscriptionCredentials> {
  return request<TranscriptionCredentials>(`/transcription/credentials`);
}

// keepalive lets the request outlive the page on a true teardown (tab close /
// refresh / OS back gesture) — without it the browser aborts the in-flight POST and
// the captured transcript is lost (BUG-34). Set it for the commit fired on
// unmount/leave; omit it for normal Stop where the page is staying.
export function completeTranscription(
  noteId: string,
  transcriptText: string,
  durationSeconds: number,
  keepalive = false
): Promise<void> {
  return requestVoid(`/notes/${noteId}/transcription`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ transcriptText, durationSeconds }),
    keepalive,
  });
}

// Autosave an in-progress transcript to the draft store (no event). Overwrite-in-place
// checkpoint; the committed transcript is still produced by completeTranscription on stop.
export function saveTranscriptionDraft(
  noteId: string,
  transcriptText: string,
  durationSeconds: number,
  keepalive = false
): Promise<void> {
  return requestVoid(`/notes/${noteId}/transcription/draft`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ transcriptText, durationSeconds }),
    keepalive,
  });
}

export function discardTranscriptionDraft(noteId: string): Promise<void> {
  return requestVoid(`/notes/${noteId}/transcription/draft`, { method: 'DELETE' });
}
