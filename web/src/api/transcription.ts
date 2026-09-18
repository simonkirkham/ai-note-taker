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

// TI-99: how the live transcription was doing at the moment of a save. Observability only — the
// server logs it and derives the coverage/stall metrics; it never reaches the saved transcript.
export type TranscriptEngine = 'cloud' | 'local';

export type TranscriptEndReason = 'stopped' | 'error' | 'streamEnded' | 'inProgress' | 'stalled';

export interface TranscriptHealth {
  engine: TranscriptEngine;
  endReason: TranscriptEndReason;
  errorName?: string;
  errorMessage?: string;
  // Seconds of audio the transcript covers, by the transcription service's own clock.
  coveredSeconds: number | null;
  secondsSinceLastText: number | null;
  audioSecondsSent: number;
  secondsSinceLastAudio: number | null;
  streamCount: number;
  // BUG-85: `audioSecondsSent` counts buffers pushed, not sound — a dead or muted track yields
  // zero-filled buffers at exactly the same rate. These four say what was actually in them.
  /** A captured track fired `ended`: the microphone or shared audio is gone for this recording. */
  sourceEnded: boolean;
  /** A captured track is muted right now. Reversible, unlike `sourceEnded`. */
  sourceMuted: boolean;
  /** Every captured sample has been below the transmitted-audio floor for the whole silence window. */
  audioSilent: boolean;
  /** Seconds since the last sample above that floor, counted from the start if there never was one. */
  secondsSilent: number | null;
  // BUG-85: how loud the audio was since the transcript last grew — the same stretch the stall is
  // measured over — so a quiet room and a transcription failure no longer look the same.
  /** The loudest sample in that stretch, in dBFS; -100 for digital silence or no audio at all. */
  loudestDbfs: number | null;
  /** Seconds of that stretch at speech level (a frame peak of -40 dBFS or louder). */
  speechSeconds: number | null;
}

export function completeTranscription(
  noteId: string,
  transcriptText: string,
  durationSeconds: number,
  health?: TranscriptHealth,
): Promise<void> {
  return requestVoid(`/notes/${noteId}/transcription`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ transcriptText, durationSeconds, health }),
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
  options?: { keepalive?: boolean; health?: TranscriptHealth }
): Promise<void> {
  return requestVoid(`/notes/${noteId}/transcription/draft`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ transcriptText, durationSeconds, health: options?.health }),
    keepalive: options?.keepalive,
  });
}

export function discardTranscriptionDraft(noteId: string): Promise<void> {
  return requestVoid(`/notes/${noteId}/transcription/draft`, { method: 'DELETE' });
}

// Kick off a batch Amazon Transcribe diarization job over the uploaded recording (Phase 33-B1).
// Fire-and-forget: returns 202 and the job completes asynchronously (EventBridge → completion
// Lambda appends the diarized transcript). The frontend then polls the note's transcriptIsDiarized.
// analyseOnCompletion (33-B2) carries the auto-analyse toggle so the completion Lambda re-analyses
// the note on the winning transcript (diarized on success, streamed on failure).
export function startDiarization(
  noteId: string,
  recordingKey: string,
  analyseOnCompletion: boolean,
): Promise<void> {
  return requestVoid(`/notes/${noteId}/transcription/diarize`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key: recordingKey, analyseOnCompletion }),
  });
}
