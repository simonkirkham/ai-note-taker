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

export function completeTranscription(
  noteId: string,
  transcriptText: string,
  durationSeconds: number
): Promise<void> {
  return requestVoid(`/notes/${noteId}/transcription`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ transcriptText, durationSeconds }),
  });
}

// Autosave an in-progress transcript to the draft store (no event). Overwrite-in-place
// checkpoint; the committed transcript is still produced by completeTranscription on stop.
// keepalive lets the final pagehide flush outlive a page teardown (BUG-34): the request
// is allowed to complete after the document is being discarded.
export function saveTranscriptionDraft(
  noteId: string,
  transcriptText: string,
  durationSeconds: number,
  options?: { keepalive?: boolean }
): Promise<void> {
  return requestVoid(`/notes/${noteId}/transcription/draft`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ transcriptText, durationSeconds }),
    keepalive: options?.keepalive,
  });
}

export function discardTranscriptionDraft(noteId: string): Promise<void> {
  return requestVoid(`/notes/${noteId}/transcription/draft`, { method: 'DELETE' });
}

// Kick off a batch Amazon Transcribe diarization job over the uploaded recording (Phase 33-B1).
// Fire-and-forget: returns 202 and the job completes asynchronously (EventBridge → completion
// Lambda appends the diarized transcript). The frontend then polls the note's transcriptIsDiarized.
export function startDiarization(noteId: string, recordingKey: string): Promise<void> {
  return requestVoid(`/notes/${noteId}/transcription/diarize`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key: recordingKey }),
  });
}
