import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router'
import SessionLeaveConfirm from '../components/SessionLeaveConfirm'
import { recordRumEvent } from '../rum'
import {
  RecordingControlContext,
  type RecordingControlValue,
  RecordingLiveContext,
  type RecordingLiveStore,
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

  // Owned here for the same reason the capture is: the record control unmounts when you look at
  // another note's tab, and both of these were `useState`/`useRef` inside it.
  //
  // The cost of that was silent and on the headline flow. Record in Standup, click another note's
  // tab to check something, come back, press Stop: the transcript saved, but the automatic
  // write-up never ran and nothing on screen said so — the control had remounted with
  // `hasRecordedThisSession` back to false, which is the gate the auto-analyse effect reads. The
  // one-shot latch remounted too, so the mirror-image bug was available as well: analyse twice.
  //
  // Before this slice the round trip was impossible (every exit was behind a confirm), which is
  // why the flags could live in the control until now.
  const [recording, setRecording] = useState<{ noteId: string; autoAnalyse: boolean } | null>(null)
  const analyseClaimedRef = useRef(false)

  const noteStarted = useCallback((noteId: string, args: StartArgs) => {
    setRecording({ noteId, autoAnalyse: args[1] })
    analyseClaimedRef.current = false
  }, [])

  const claimAutoAnalyse = useCallback(() => {
    if (analyseClaimedRef.current) return false
    analyseClaimedRef.current = true
    return true
  }, [])

  const releaseAutoAnalyse = useCallback(() => {
    analyseClaimedRef.current = false
  }, [])

  const isCapturing =
    session.status === 'requestingCredentials' ||
    session.status === 'recording' ||
    session.status === 'finalising'
  // 'finalising' is excluded on purpose. In on-device mode it lasts minutes after Stop, and
  // while it does, `isCapturing` had the tab pulsing and screen readers announcing ", recording"
  // about a meeting the user had already stopped — and told every other note "Another note is
  // recording — stop it first" about a recording that could not be stopped. The 'saving' wording
  // that already exists for the lockout is the truthful one for this window; the marker follows
  // the LIVE capture, the lockout follows the whole busy period below.
  const isLiveCapture =
    session.status === 'requestingCredentials' || session.status === 'recording'
  const recordingNoteId = isLiveCapture ? boundNoteId : null

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

  // Read through a ref so `startIn` does not take a dependency on the live session. Depending on
  // it directly gave `startIn` a new identity on every partial transcript result, which flowed
  // into the context value and re-rendered every consumer several times a second.
  //
  // The same ref is what the live STORE serves. Publishing a stable store rather than the session
  // itself is what lets a note that does not own the session sleep through the whole meeting —
  // see `RecordingLiveStore`. The listener set is a plain ref: it must survive re-renders without
  // causing one.
  const sessionRef = useRef(session)
  // The session and its binding, published as ONE value — see `RecordingLiveStore.getLive`.
  const liveRef = useRef({ noteId: boundNoteId, session })
  const liveListenersRef = useRef(new Set<() => void>())
  // `useMemo` with no dependencies rather than a ref: the store must be created once and never
  // change identity — a store that changed would re-subscribe every consumer on every render,
  // which is the cost this exists to remove — and a ref may not be read while rendering, which
  // handing it to the context below would be. The refs it closes over are only touched inside
  // these callbacks, which is not during render.
  const liveStore = useMemo<RecordingLiveStore>(
    () => ({
      subscribe: (listener) => {
        liveListenersRef.current.add(listener)
        return () => liveListenersRef.current.delete(listener)
      },
      getLive: () => liveRef.current,
    }),
    [],
  )
  useEffect(() => {
    sessionRef.current = session
    // Withheld while a start is still parked for this note. `useTranscription` is ONE instance
    // whose transcript survives a binding change until `startRecording` clears it, so handing
    // the session over the moment the binding moves showed the new note the PREVIOUS meeting's
    // words and its 'stopped' status — for the commit between the claim and the start actually
    // firing. Child effects run first, so the record control acted on that commit: it saw a
    // stopped meeting with a transcript and wrote up the wrong, empty note.
    //
    // This effect is declared ABOVE the one that fires the parked start, so it runs first and
    // publishes `null`; the start then clears the transcript and re-runs this with the binding
    // live. Keep them in that order.
    const parkedFor = pendingStartRef.current?.noteId
    liveRef.current = {
      noteId: parkedFor === boundNoteId ? null : boundNoteId,
      session,
    }
    // After commit, so a subscriber reading the snapshot mid-render can never see a session
    // newer than the one this render was built from.
    for (const listener of liveListenersRef.current) listener()
  }, [session, boundNoteId])
  const boundNoteIdRef = useRef(boundNoteId)
  useEffect(() => {
    boundNoteIdRef.current = boundNoteId
  }, [boundNoteId])
  const busyNoteIdRef = useRef(busyNoteId)
  useEffect(() => {
    busyNoteIdRef.current = busyNoteId
  }, [busyNoteId])

  const startIn = useCallback((noteId: string, ...args: StartArgs) => {
    // Single-recorder rule: a LIVE capture is never silently displaced. A merely-bound note
    // (stopped, committing) does not block another note from starting.
    //
    // Phrased against `busyNoteId`, not `isCapturing && boundNoteId !== noteId`: the
    // latter refuses EVERY claim whenever the status is non-idle while no note is bound —
    // a state production cannot reach, but one the refusal permanently locks up if it ever
    // does, because nothing can then acquire the binding. The question being asked is "is
    // another note still working?", so ask that. NOT `recordingNoteId`, which since the
    // marker fix covers only the live capture — a second note starting mid-save is exactly
    // the overlap the comment above says waiting exists to prevent.
    //
    // Read through refs. Safe because this only runs from a click handler, and React flushes
    // pending passive effects at the start of a discrete event, so both are current by then —
    // and the button is independently disabled from render-derived state. The refs exist so
    // `startIn` does not take a dependency on the live session and churn every consumer.
    if (busyNoteIdRef.current !== null && busyNoteIdRef.current !== noteId) return

    // Already bound to this note — start now rather than via the ref. Routing this through
    // the effect strands it: `setBoundNoteId` to the value it already holds takes React's
    // eager bailout, so the provider never re-renders and the effect never runs. That is the
    // Continue / Re-record path from 18-C, and the parked request would then fire much later
    // on an unrelated re-render (an upload or diarization transition) or never at all.
    // No stale-closure risk here — the hook's callbacks already close over this exact id.
    if (boundNoteIdRef.current === noteId) {
      noteStarted(noteId, args)
      sessionRef.current.startRecording(...args)
      return
    }

    pendingStartRef.current = { noteId, args }
    setBoundNoteId(noteId)
  }, [noteStarted])

  useEffect(() => {
    const pending = pendingStartRef.current
    if (!pending || pending.noteId !== boundNoteId) return
    pendingStartRef.current = null
    noteStarted(pending.noteId, pending.args)
    session.startRecording(...pending.args)
  }, [boundNoteId, session, noteStarted])

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
  // Kept apart from `leaveDestination`, which is cleared the instant the leave is confirmed —
  // so the "finishing the transcript" banner has nothing left to name without this.
  const [finishingDestination, setFinishingDestination] = useState<string | null>(null)
  const pendingLeaveRef = useRef<(() => void) | null>(null)
  const pendingAwaitTranscriptRef = useRef(false)
  // Latched once a leave is confirmed, so a second guarded click cannot re-arm a confirm whose
  // handler would return immediately — the dead-banner case BUG-55's review found.
  const leavingRef = useRef(false)

  const guardLeave = useCallback(
    (proceed: () => void, destination: string, awaitTranscript: boolean, noteId?: string) => {
      // Nothing in flight → nothing to protect.
      //
      // Gated on BUSY, not on capturing. An earlier version asked only "is it recording?",
      // reasoning that a stopped note's commit was already dispatched. That is true of the
      // transcript POST but not of the audio upload or the speaker-labelling, which are
      // dispatched after awaits — so signing out mid-upload lost the audio file and the
      // speaker labels with no warning at all.
      if (busyNoteId === null) return false
      // Scoped to the note being left, when the caller names one. Asking only "is anything
      // busy?" meant closing an UNRELATED tab while another note recorded raised "Still
      // recording — close this tab?", and confirming it called stopRecording on a session the
      // user had never referred to: the rest of the meeting lost, under a message saying it had
      // been saved. Callers that genuinely destroy any capture (sign out, switch workspace)
      // name no note and still guard.
      if (noteId !== undefined && noteId !== busyNoteId) return false
      if (leavingRef.current) return true
      pendingLeaveRef.current = proceed
      pendingAwaitTranscriptRef.current = awaitTranscript
      setLeaveDestination(destination)
      setFinishingDestination(destination)
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

  // C4 — a confirm must not follow you to another screen.
  //
  // Nothing used to clear this on navigation, and this slice is what made navigation possible
  // while it is up: tab switches, Home, folders and Unfiled are all unguarded now, so none of
  // them calls `clearSessionLeave`. Reachable in four clicks — record in Standup, open Client
  // call's tab, press Sign out (the session's confirm appears), click Standup's tab (unguarded,
  // so the confirm survives), then press Back. The mounted note raises its OWN confirm on
  // popstate and both are on screen at once, each rendering `confirm-leave-button` — two red
  // banners, a duplicate testid that throws in vitest and violates strict mode in Playwright,
  // and the stale one still holding an armed sign-out that the effect below would fire.
  //
  // Split in two because of the lint gates: the banner goes during render (React's documented
  // reset-state-on-input-change, same as the transition above, and it means the stale banner
  // never paints), while the armed continuation it was holding is dropped in the effect below,
  // because writing a ref during render is what react-hooks/refs forbids.
  const { pathname } = useLocation()
  const [prevPathname, setPrevPathname] = useState(pathname)
  if (prevPathname !== pathname) {
    setPrevPathname(pathname)
    if (leaveDestination !== null) setLeaveDestination(null)
  }
  useEffect(() => {
    pendingLeaveRef.current = null
    pendingAwaitTranscriptRef.current = false
  }, [pathname])
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
    // Cleared last, and only after the wait: the banner reads it for the whole time it is up,
    // so clearing it earlier would blank the sentence mid-save. Leaving it set instead would
    // have the next leave's banner briefly naming the previous destination.
    setFinishingDestination(null)
  }, [session])

  // C2: the session's confirm must stand down the moment the note's own guard takes over,
  // or both render at once — two red banners stacked, and the stale one still holding an
  // armed sign-out that the effect above would then fire.
  const cancelLeave = useCallback(() => {
    pendingLeaveRef.current = null
    pendingAwaitTranscriptRef.current = false
    setLeaveDestination(null)
    setFinishingDestination(null)
    // The banner too, not just the destination. `App` calls this immediately before handing the
    // leave to the mounted note's guard, so a session leave already parked on the commit would
    // otherwise leave "Finishing the transcript…" sitting underneath the note's own confirm —
    // the two-banners-at-once state the rest of this file exists to prevent.
    setFinishingTranscript(false)
    leavingRef.current = false
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

  // Every field here is a primitive or a callback with stable identity, so this value changes
  // only when something a consumer actually cares about changes — NOT on every partial
  // transcript result. That is the whole point of the split; see `RecordingControlValue`. If a
  // dependency that churns is ever added here, the app-wide re-render it removes comes straight
  // back, and nothing will fail to say so.
  const control = useMemo<RecordingControlValue>(
    () => ({
      boundNoteId,
      recordingNoteId,
      busyNoteId,
      recordedNoteId: recording?.noteId ?? null,
      autoAnalyseChoice: recording?.autoAnalyse ?? true,
      claimAutoAnalyse,
      releaseAutoAnalyse,
      startIn,
      guardLeave,
      clearSessionLeave: cancelLeave,
    }),
    [
      boundNoteId,
      recordingNoteId,
      busyNoteId,
      recording,
      claimAutoAnalyse,
      releaseAutoAnalyse,
      startIn,
      guardLeave,
      cancelLeave,
    ],
  )

  return (
    <RecordingControlContext value={control}>
      <RecordingLiveContext value={liveStore}>
        {children}
        <SessionLeaveConfirm
          destination={leaveDestination}
          finishing={finishingTranscript}
          finishingDestination={finishingDestination}
          onConfirm={() => void confirmLeave()}
          onCancel={cancelLeave}
        />
      </RecordingLiveContext>
    </RecordingControlContext>
  )
}
