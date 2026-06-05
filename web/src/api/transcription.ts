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
