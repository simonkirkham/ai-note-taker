import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { recordRumEvent } from '../rum'
import { useTranscription, type UseTranscriptionResult } from './useTranscription'

// 51-C: the recording session hoisted ABOVE the note screen.
//
// It always was app-scoped state — a microphone, a socket and a transcript buffer are not
// view state — but it lived inside the mounted NoteView, so switching notes unmounted it and
// killed the capture. That is why 49-A had to wrap every tab switch in a leave-confirm.
//
// Keeping a second NoteView mounted instead (the rejected option 1) would put two popstate
// traps and two beforeunload handlers live at once, both racing for the same history entry —
// a fresh instance of the BUG-34 failure this slice exists to remove. Hoisting keeps exactly
// one NoteView mounted, leaves the navigation globals singleton, and makes "which note is
// recording?" answerable without that note being on screen, which the tab indicator needs.
//
// The session is mounted inside WorkspaceProvider, so switching workspace still tears it
// down — which is correct, and why that leave-prompt is one of the ones 51-C keeps.

type StartArgs = Parameters<UseTranscriptionResult['startRecording']>

interface RecordingSessionValue {
  /** The note that owns the live session, or null when nothing is recording. */
  recordingNoteId: string | null
  session: UseTranscriptionResult
  /** Claim the session for `noteId` and start it once the claim has landed. */
  startIn: (noteId: string, ...args: StartArgs) => void
}

const RecordingSessionContext = createContext<RecordingSessionValue | null>(null)

export function RecordingSessionProvider({ children }: { children: React.ReactNode }) {
  const [recordingNoteId, setRecordingNoteId] = useState<string | null>(null)
  const session = useTranscription(recordingNoteId ?? '')

  // `useTranscription` closes over noteId in every callback (deps `[noteId]`), so starting in
  // the same tick as the claim would bind the capture to the PREVIOUS id — committing the
  // transcript to the wrong note, or to ''. So the request is parked and fired from an effect,
  // once the hook has actually re-rendered with the new id.
  const pendingStartRef = useRef<{ noteId: string; args: StartArgs } | null>(null)

  const startIn = useCallback((noteId: string, ...args: StartArgs) => {
    // Single-recorder rule: a live session is never silently displaced.
    if (recordingNoteId !== null && recordingNoteId !== noteId) return
    pendingStartRef.current = { noteId, args }
    setRecordingNoteId(noteId)
  }, [recordingNoteId])

  useEffect(() => {
    const pending = pendingStartRef.current
    if (!pending || pending.noteId !== recordingNoteId) return
    pendingStartRef.current = null
    session.startRecording(...pending.args)
  }, [recordingNoteId, session])

  // Release the claim when the session falls back to idle (its own `reset`), so another note
  // can record. Deliberately NOT on 'stopped'/'finalising': the stop sequence, the commit and
  // the upload all still target this note, and in local mode 'finalising' runs for minutes.
  //
  // It must release only once the session has actually BEEN active. Releasing on "idle" alone
  // races the start: the claim and the start land in the same commit, where status is still
  // 'idle' for one render — so a plain idle check un-claims the note it has just claimed and
  // the recording never begins. Latching on a non-idle status first is what separates "not
  // started yet" from "finished and reset".
  const sawActiveRef = useRef(false)
  useEffect(() => {
    if (session.status !== 'idle') {
      sawActiveRef.current = true
      return
    }
    if (sawActiveRef.current && recordingNoteId !== null) {
      sawActiveRef.current = false
      setRecordingNoteId(null)
    }
  }, [session.status, recordingNoteId])

  // The slice's regression detector. If this provider ever unmounts while a capture is still
  // live, the recording has been destroyed under the user and the transcript is gone — the
  // exact failure 51-C exists to prevent, and one that is otherwise invisible until someone
  // opens the note and finds it empty. Refs, because a cleanup closure must not re-run when
  // the values change; the effect is mount-once by design.
  //
  // KNOWN INERT: recordRumEvent is a no-op in production today — custom events are DISABLED
  // on the RUM monitor (TI-67). This is wired to the spec, but it cannot fire until that
  // lands, so it is NOT yet evidence that the mechanism works.
  const statusRef = useRef(session.status)
  const noteIdRef = useRef(recordingNoteId)
  // Mirrored in an effect, not during render: writing a ref while rendering is what
  // react-hooks/refs forbids, and it is unsafe under a re-render React discards.
  useEffect(() => {
    statusRef.current = session.status
    noteIdRef.current = recordingNoteId
  }, [session.status, recordingNoteId])
  useEffect(
    () => () => {
      if (statusRef.current === 'recording' || statusRef.current === 'requestingCredentials') {
        recordRumEvent('recordingUnmountedWhileActive', { noteId: noteIdRef.current ?? '' })
      }
    },
    [],
  )

  const value = useMemo<RecordingSessionValue>(
    () => ({ recordingNoteId, session, startIn }),
    [recordingNoteId, session, startIn],
  )

  return <RecordingSessionContext value={value}>{children}</RecordingSessionContext>
}

/** Which note is currently recording, for the tab bar. Null when nothing is. */
export function useRecordingNoteId(): string | null {
  return useContext(RecordingSessionContext)?.recordingNoteId ?? null
}

// What a note that does NOT own the session sees. Every field is the idle value, so a note
// off the recording path renders exactly as it did before this slice.
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
 * The session as one note sees it. The owning note gets the live session; every other note
 * gets an idle view whose `startRecording` claims the session for itself — and is refused
 * while another note holds it, which is the single-recorder rule.
 */
export function useNoteRecording(noteId: string): UseTranscriptionResult & { otherNoteRecording: boolean } {
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
