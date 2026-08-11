import { createContext, useCallback, useContext, useMemo } from 'react'
import type { UseTranscriptionResult } from './useTranscription'

// 51-C: the context and its readers, split from the provider component.
//
// Same split as ToastProvider.tsx / toastContext.ts: a file that exports both a component and
// plain functions breaks React Fast Refresh, which can only hot-swap a module whose exports are
// all components. Keeping the hooks here leaves `recordingSession.tsx` exporting one component.

export type StartArgs = Parameters<UseTranscriptionResult['startRecording']>

/**
 * The session as a single note sees it: every field of the transcription session, plus whether
 * some OTHER note is holding it. Optional on the flag so a caller that predates the app-scoped
 * session (and every test that passes a bare `UseTranscriptionResult`) still satisfies it.
 */
export type NoteRecording = UseTranscriptionResult & { otherNoteRecording?: boolean }

export interface RecordingSessionValue {
  /** The note that owns the live session, or null when nothing is recording. */
  recordingNoteId: string | null
  session: UseTranscriptionResult
  /** Claim the session for `noteId` and start it once the claim has landed. */
  startIn: (noteId: string, ...args: StartArgs) => void
}

export const RecordingSessionContext = createContext<RecordingSessionValue | null>(null)

/** Which note is currently recording, for the tab bar. Null when nothing is. */
export function useRecordingNoteId(): string | null {
  return useContext(RecordingSessionContext)?.recordingNoteId ?? null
}

// What a note that does NOT own the session sees. Every field is the idle value, so a note off
// the recording path renders exactly as it did before this slice.
const IDLE: Omit<UseTranscriptionResult, 'startRecording'> = {
  status: 'idle',
  transcript: '',
  elapsedSeconds: 0,
  error: undefined,
  recordingUpload: 'idle',
  diarization: 'idle',
  stopRecording: () => {},
  awaitCommit: async () => {},
  reset: () => {},
}

/**
 * The session as one note sees it. The owning note gets the live session; every other note gets
 * an idle view whose `startRecording` claims the session for itself — and is refused while
 * another note holds it, which is the single-recorder rule.
 */
export function useNoteRecording(noteId: string): NoteRecording {
  const ctx = useContext(RecordingSessionContext)
  const owns = ctx?.recordingNoteId === noteId
  const otherNoteRecording = ctx != null && ctx.recordingNoteId !== null && !owns
  const startIn = ctx?.startIn
  const session = ctx?.session

  const startRecording = useCallback<UseTranscriptionResult['startRecording']>(
    (...args) => startIn?.(noteId, ...args),
    [startIn, noteId],
  )

  return useMemo(
    () => ({ ...(owns && session ? session : IDLE), startRecording, otherNoteRecording }),
    [owns, session, startRecording, otherNoteRecording],
  )
}
