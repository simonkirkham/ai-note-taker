import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { recordRumEvent } from '../rum'
import {
  RecordingSessionContext,
  type RecordingSessionValue,
  type StartArgs,
} from './recordingSessionContext'
import { useTranscription } from './useTranscription'

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
// WARNING — a workspace switch does NOT tear this down, despite where it is mounted. Every
// workspace matches the same `/w/:wsId/*` route and `WorkspaceProvider` carries no `key`, so
// React reconciles it in place and nothing unmounts. The capture therefore SURVIVES a switch,
// while `api/client.ts` rewrites every request path from the now-changed workspace global — so
// a surviving capture would send its checkpoint PUTs and its final commit to
// `/w/<new-ws>/notes/<old-note-id>`, which does not exist. The workspace-switch leave-prompt is
// what prevents that, and it is load-bearing for this reason, NOT for the "it unmounts anyway"
// reason an earlier version of this comment gave.
//
// The context and its reader hooks live in recordingSessionContext.ts, so this file exports
// only a component and Fast Refresh can hot-swap it.

export function RecordingSessionProvider({ children }: { children: React.ReactNode }) {
  // BINDING vs CLAIM — the distinction the first cut of this file did not make, and the reason
  // it let you record exactly once per page load.
  //
  // `boundNoteId` is the note the session belongs to. It deliberately OUTLIVES the capture:
  // after Stop, the transcript commit, the WAV upload and the diarization trigger all still
  // target that note, so clearing it here would send them to ''.
  //
  // The CLAIM — what locks other notes out and what puts the marker in the tab bar — is
  // `recordingNoteId` below, derived from the status. Conflating the two meant the lock was
  // never released: the release effect fired only on 'idle', but Stop leaves the status at
  // 'stopped' and nothing returns it to 'idle' (`reset` is reachable only from the Reset
  // button, which renders only on 'error'). So one recording disabled Record in every other
  // note, and left a pulsing dot on a tab that had finished, for the rest of the page's life.
  const [boundNoteId, setBoundNoteId] = useState<string | null>(null)
  const session = useTranscription(boundNoteId ?? '')

  const isCapturing =
    session.status === 'requestingCredentials' ||
    session.status === 'recording' ||
    session.status === 'finalising'
  const recordingNoteId = isCapturing ? boundNoteId : null

  // `useTranscription` closes over noteId in every callback (deps `[noteId]`), so starting in
  // the same tick as the claim would bind the capture to the PREVIOUS id — committing the
  // transcript to the wrong note, or to ''. So the request is parked and fired from an effect,
  // once the hook has actually re-rendered with the new id.
  const pendingStartRef = useRef<{ noteId: string; args: StartArgs } | null>(null)

  const startIn = useCallback((noteId: string, ...args: StartArgs) => {
    // Single-recorder rule: a LIVE capture is never silently displaced. A merely-bound note
    // (stopped, committing) does not block another note from starting.
    //
    // Phrased against `recordingNoteId`, not `isCapturing && boundNoteId !== noteId`: the
    // latter refuses EVERY claim whenever the status is non-idle while no note is bound —
    // a state production cannot reach, but one the refusal permanently locks up if it ever
    // does, because nothing can then acquire the binding. The question being asked is "is
    // another note holding a live capture?", so ask that.
    if (recordingNoteId !== null && recordingNoteId !== noteId) return

    // Already bound to this note — start now rather than via the ref. Routing this through
    // the effect strands it: `setBoundNoteId` to the value it already holds takes React's
    // eager bailout, so the provider never re-renders and the effect never runs. That is the
    // Continue / Re-record path from 18-C, and the parked request would then fire much later
    // on an unrelated re-render (an upload or diarization transition) or never at all.
    // No stale-closure risk here — the hook's callbacks already close over this exact id.
    if (boundNoteId === noteId) {
      session.startRecording(...args)
      return
    }

    pendingStartRef.current = { noteId, args }
    setBoundNoteId(noteId)
  }, [recordingNoteId, boundNoteId, session])

  useEffect(() => {
    const pending = pendingStartRef.current
    if (!pending || pending.noteId !== boundNoteId) return
    pendingStartRef.current = null
    session.startRecording(...pending.args)
  }, [boundNoteId, session])

  // No release effect, and no "have I seen it active yet?" latch. Deriving the claim from the
  // status instead of storing it removes the start/idle race those existed for: there is no
  // stored flag that can be cleared in the same commit that set it, because there is no
  // stored flag. The binding is the only state, and only a NEW note's claim changes it.

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
  const noteIdRef = useRef(boundNoteId)
  // Mirrored in an effect, not during render: writing a ref while rendering is what
  // react-hooks/refs forbids, and it is unsafe under a re-render React discards.
  useEffect(() => {
    statusRef.current = session.status
    noteIdRef.current = boundNoteId
  }, [session.status, boundNoteId])
  useEffect(
    () => () => {
      if (statusRef.current === 'recording' || statusRef.current === 'requestingCredentials') {
        recordRumEvent('recordingUnmountedWhileActive', { noteId: noteIdRef.current ?? '' })
      }
    },
    [],
  )

  // `session` is a fresh object every render, so this memo does not actually stabilise the
  // value — it is here for shape, not for identity. Consumers must not assume referential
  // stability from it.
  const value = useMemo<RecordingSessionValue>(
    () => ({ boundNoteId, recordingNoteId, session, startIn }),
    [boundNoteId, recordingNoteId, session, startIn],
  )

  return <RecordingSessionContext value={value}>{children}</RecordingSessionContext>
}
