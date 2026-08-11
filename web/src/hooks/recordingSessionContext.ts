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
  /**
   * The note the session is BOUND to — the one that sees it. Outlives the capture on purpose:
   * after Stop, the transcript commit, the WAV upload and the diarization trigger all still
   * target this note, and the note still renders its own 'stopped'/'finalising' UI.
   */
  boundNoteId: string | null
  /**
   * The note actively CAPTURING, or null. Narrower than `boundNoteId` — it clears the moment
   * the capture ends, which is what frees every other note to record and what takes the
   * marker out of the tab bar.
   */
  recordingNoteId: string | null
  session: UseTranscriptionResult
  /** Claim the session for `noteId` and start it. */
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
  // Ownership follows the BINDING, not the capture: a note that has just stopped still owns
  // the session while its transcript commits and its recording uploads, and must keep seeing
  // the real status ('stopped'/'finalising') rather than being handed the idle view.
  const owns = ctx?.boundNoteId === noteId
  // The lockout follows the CAPTURE. Keying it off the binding instead is what left the app
  // recordable-once: the binding never clears, so every other note stayed disabled forever.
  const otherNoteRecording =
    ctx != null && ctx.recordingNoteId !== null && ctx.recordingNoteId !== noteId
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
