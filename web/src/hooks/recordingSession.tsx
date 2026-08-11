import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import SessionLeaveConfirm from '../components/SessionLeaveConfirm'
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

  // Stop is not the end of the work. The audio upload and the speaker-labelling run on
  // afterwards — minutes, on a long meeting — and both read shared settings back out across
  // an await. A second note starting mid-chain overwrites those settings, and the FIRST
  // meeting then silently skips its automatic write-up, shows its progress on the second
  // note's screen, and polls the wrong note for its refined transcript.
  //
  // So a second note waits. Decided with the human 2026-08-11, over the alternative of
  // keeping each meeting's state apart: that means getting all 29 pieces of state in
  // `useTranscription` right and keeping them right, and being wrong about any one is silent.
  // Waiting makes the overlap impossible instead of handled. The cost is visible and small —
  // you cannot start a new meeting until the last one has finished saving.
  //
  // The SAME note is deliberately still allowed: 18-C's Continue / Re-record resumes into the
  // same note, nothing crosses between meetings, and blocking it would break that path.
  const isSaving = session.recordingUpload === 'uploading' || session.diarization === 'refining'
  const busyNoteId = isCapturing || isSaving ? boundNoteId : null

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
    if (busyNoteId !== null && busyNoteId !== noteId) return

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
  }, [busyNoteId, boundNoteId, session])

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


  // ---- The leave guard -------------------------------------------------------------------
  //
  // Owned here, not by the mounted note. BUG-54 wrapped every exit that destroys a capture,
  // but registered the guard from `NoteView`, gated on THAT note recording. Since the capture
  // now outlives the note screen, that guard is absent in exactly the positions this slice
  // creates — so signing out, closing the recording tab, or switching workspace from anywhere
  // else fell straight through and lost the transcript (BUG-55, reproduced).
  //
  // `NoteView` keeps its own in-header confirm for the case where the recording note IS on
  // screen: it additionally flushes that note's unsaved content draft before leaving, which is
  // note-scoped work this provider has no business doing. `App`'s `requestLeave` prefers the
  // note's guard and falls back to this one, so exactly one is ever live.
  const [leaveDestination, setLeaveDestination] = useState<string | null>(null)
  const [finishingTranscript, setFinishingTranscript] = useState(false)
  const pendingLeaveRef = useRef<(() => void) | null>(null)
  const pendingAwaitTranscriptRef = useRef(false)
  // Latched once a leave is confirmed, so a second guarded click cannot re-arm a confirm whose
  // handler would return immediately — the dead-banner case BUG-55's review found.
  const leavingRef = useRef(false)

  const guardLeave = useCallback(
    (proceed: () => void, destination: string, awaitTranscript: boolean) => {
      // Nothing in flight → nothing to protect.
      //
      // Gated on BUSY, not on capturing. An earlier version asked only "is it recording?",
      // reasoning that a stopped note's commit was already dispatched. That is true of the
      // transcript POST but not of the audio upload or the speaker-labelling, which are
      // dispatched after awaits — so signing out mid-upload lost the audio file and the
      // speaker labels with no warning at all.
      if (busyNoteId === null) return false
      if (leavingRef.current) return true
      pendingLeaveRef.current = proceed
      pendingAwaitTranscriptRef.current = awaitTranscript
      setLeaveDestination(destination)
      return true
    },
    [busyNoteId],
  )

  // A capture that ends on its own while the confirm is up must not strand the user: drop the
  // banner and run the destination they asked for.
  //
  // Adjusted during render — React's documented "reset state when an input changes" — rather
  // than in an effect, because a `setState` in an effect body trips react-hooks/set-state-in-
  // effect, which is a hard CI gate here and which tsc and vitest both miss. It also means the
  // stale banner never paints, not even for a frame. Same shape as NoteView's copy; keep them
  // in step.
  const [prevIsCapturing, setPrevIsCapturing] = useState(isCapturing)
  if (prevIsCapturing !== isCapturing) {
    setPrevIsCapturing(isCapturing)
    if (!isCapturing && leaveDestination !== null) setLeaveDestination(null)
  }
  // Second half of that same transition: the banner is dropped above, the pending navigation
  // runs here because it is a side effect and must wait for commit. Keep the two together —
  // splitting them strands one without the other.
  useEffect(() => {
    if (isCapturing) return
    const proceed = pendingLeaveRef.current
    if (!proceed) return
    pendingLeaveRef.current = null
    const awaitTranscript = pendingAwaitTranscriptRef.current
    pendingAwaitTranscriptRef.current = false
    // Pressing Stop while the confirm is up ends the capture, which lands here. It must still
    // honour the wait — dropping it signed the user out mid-save and lost the transcript, on
    // the one destination that exists to prevent exactly that. The earlier version ignored
    // `awaitTranscript` here entirely; it was copied from NoteView, where the pending leave
    // dies with the note and so was far harder to reach.
    if (!awaitTranscript) {
      proceed()
      return
    }
    void (async () => {
      // Yield first: this is an effect body, and a synchronous setState here is the
      // react-hooks/set-state-in-effect gate, which tsc and vitest both miss.
      await Promise.resolve()
      setFinishingTranscript(true)
      try {
        await session.awaitCommit()
      } finally {
        setFinishingTranscript(false)
      }
      proceed()
    })()
  }, [isCapturing, session])

  const confirmLeave = useCallback(async () => {
    if (leavingRef.current) return
    leavingRef.current = true
    setLeaveDestination(null)
    session.stopRecording()
    const proceed = pendingLeaveRef.current
    pendingLeaveRef.current = null
    const awaitTranscript = pendingAwaitTranscriptRef.current
    pendingAwaitTranscriptRef.current = false
    // BUG-55: only the destination that CLEARS AUTH waits for the commit. stopRecording fires
    // it asynchronously — in cloud mode it dispatches at once and outlives a route change, but
    // in local mode it first runs the stop-time pass plus diarization, minutes on a long
    // meeting, and only then POSTs. Sign-out clears the token long before that, so the POST
    // 401s and nothing retries. Awaiting on every destination would instead hang ordinary
    // navigations for those same minutes.
    if (awaitTranscript) {
      setFinishingTranscript(true)
      // `finally`, not a plain reset: this runs as `void confirmLeave()`, so a throw would be
      // an unhandled rejection leaving the banner stuck with no way out.
      try {
        await session.awaitCommit()
      } finally {
        setFinishingTranscript(false)
      }
    }
    leavingRef.current = false
    proceed?.()
  }, [session])

  // C2: the session's confirm must stand down the moment the note's own guard takes over,
  // or both render at once — two red banners stacked, and the stale one still holding an
  // armed sign-out that the effect above would then fire.
  const cancelLeave = useCallback(() => {
    pendingLeaveRef.current = null
    pendingAwaitTranscriptRef.current = false
    setLeaveDestination(null)
  }, [])

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
    () => ({
      boundNoteId,
      recordingNoteId,
      busyNoteId,
      session,
      startIn,
      guardLeave,
      clearSessionLeave: cancelLeave,
    }),
    [boundNoteId, recordingNoteId, busyNoteId, session, startIn, guardLeave, cancelLeave],
  )

  return (
    <RecordingSessionContext value={value}>
      {children}
      <SessionLeaveConfirm
        destination={leaveDestination}
        finishing={finishingTranscript}
        onConfirm={() => void confirmLeave()}
        onCancel={cancelLeave}
      />
    </RecordingSessionContext>
  )
}
