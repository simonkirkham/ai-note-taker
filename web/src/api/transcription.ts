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
export function saveTranscriptionDraft(
  noteId: string,
  transcriptText: string,
  durationSeconds: number
): Promise<void> {
  return requestVoid(`/notes/${noteId}/transcription/draft`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ transcriptText, durationSeconds }),
  });
}

export function discardTranscriptionDraft(noteId: string): Promise<void> {
  return requestVoid(`/notes/${noteId}/transcription/draft`, { method: 'DELETE' });
}
