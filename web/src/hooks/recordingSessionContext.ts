import { createContext, useCallback, useContext, useMemo, useSyncExternalStore } from 'react'
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
export type NoteRecording = UseTranscriptionResult & {
  /** Another note is capturing, or still finishing its save, so this note cannot start. */
  otherNoteRecording?: boolean
  /** Which of those it is, so the control can say so rather than just refusing. */
  otherNoteBusyReason?: 'recording' | 'saving'
  /**
   * A recording has been made in this note during this page session. Owned by the session, not
   * by the record control, because the control unmounts the moment you look at another note's
   * tab and a flag it held would be lost mid-meeting — taking the automatic write-up with it.
   */
  hasRecordedThisSession?: boolean
  /**
   * The automatic-write-up choice as it was when Record was pressed. Also session-owned, and
   * for the same reason: the toggle is hidden during a recording precisely so it cannot change,
   * which a remount back to its default would quietly undo.
   */
  autoAnalyseChoice?: boolean
  /**
   * Claim the one automatic write-up this capture is allowed. Returns true to the first caller
   * after each Record, false to every caller after that — so a control that remounts mid-meeting
   * cannot trigger a second analysis of the same recording.
   *
   * Optional throughout: a test driving the control with a bare session gets `undefined` and
   * falls back to the control's own local latch.
   */
  claimAutoAnalyse?: () => boolean
  /**
   * Hand the claim back after a failed write-up, so the next attempt is allowed. Without it a
   * write-up that errors can never retry — the claim is taken before the request goes out.
   */
  releaseAutoAnalyse?: () => void
}

/**
 * Everything about the session that is NOT the live transcript: which note holds it, what it
 * will and will not allow, and the leave guard.
 *
 * Separate from the live session on purpose. `useTranscription` calls `setTranscript` on every
 * partial result from the speech service — several times a second, for the length of a meeting —
 * so anything sharing a context with it re-renders at that rate. Before the split that was the
 * whole app: the sidebar, the notes list, the folder panel, the workspace switcher and the open-
 * note tab bar all re-rendered continuously while recording, on a main thread that is also
 * feeding the on-device transcriber (BUG-65/67). Everything outside the note screen reads only
 * this half, and this half changes only when one of its primitives does.
 */
export interface RecordingControlValue {
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
  /**
   * The note that is capturing OR still finishing its save — uploading the audio, running the
   * speaker-labelling. Wider than `recordingNoteId`, because Stop is not the end of the work.
   * This is what stops a second note starting; see the provider for why waiting is safer than
   * overlapping.
   */
  busyNoteId: string | null
  /**
   * The note a recording has actually been made in during this page session, or null. Survives
   * the record control unmounting; see `NoteRecording.hasRecordedThisSession`.
   */
  recordedNoteId: string | null
  /** The automatic-write-up choice captured at the last Record. */
  autoAnalyseChoice: boolean
  /** Claim this capture's one automatic write-up; see `NoteRecording.claimAutoAnalyse`. */
  claimAutoAnalyse: () => boolean
  /** Hand it back after a failure; see `NoteRecording.releaseAutoAnalyse`. */
  releaseAutoAnalyse: () => void
  /** Claim the session for `noteId` and start it. */
  startIn: (noteId: string, ...args: StartArgs) => void
  /**
   * Ask before a leave that would destroy the live capture. Returns true if it took ownership
   * of `proceed` (a confirm is now showing); false if there is nothing to protect, in which
   * case the caller runs `proceed` itself.
   *
   * Lives here rather than on the mounted note because the whole point of 51-C is that the
   * capture outlives the note screen — a note-owned guard is absent in exactly the positions
   * this slice creates.
   */
  guardLeave: (
    proceed: () => void,
    destination: string,
    awaitTranscript: boolean,
    /** Only guard if THIS note is the busy one; omit to guard against any capture at all. */
    noteId?: string,
  ) => boolean
  /**
   * Stand the session's confirm down. Called when the mounted note's own guard takes the
   * leave instead, so the two can never be on screen together.
   */
  clearSessionLeave: () => void
}

export const RecordingControlContext = createContext<RecordingControlValue | null>(null)

/**
 * The live transcription session — the half that changes on every partial result.
 *
 * Deliberately NOT the session itself. A context carrying the session re-renders every consumer
 * whenever it changes, and a hook cannot subscribe conditionally, so the note you are READING
 * re-rendered on every word of the other note's transcript — measured at 25 re-renders for 25
 * partial results. Publishing a stable store instead means the context value never changes, and
 * `useSyncExternalStore` re-renders only the reader whose own snapshot moved: the owning note
 * gets the session, everyone else gets `IDLE` and stays put.
 */
export interface RecordingLiveStore {
  /** Called after every commit in which the session or its binding changed. */
  subscribe: (listener: () => void) => () => void
  /**
   * The session AND the note it belongs to, together in one snapshot.
   *
   * Together is the whole point. Reading ownership from the control context (updated during
   * the provider's render) and the session from here (updated in a passive effect) made them
   * one commit out of step: pressing Record in a second note showed that note the FIRST note's
   * status and transcript for one commit, and child effects — which run before the provider's —
   * acted on it. One snapshot cannot be half-updated.
   *
   * The returned object is replaced only in the effect that notifies, so it is stable between
   * notifications as `useSyncExternalStore` requires.
   *
   * That is NOT the same as "the owner only wakes for real transcript changes". `useTranscription`
   * returns a fresh object every provider render, so the owning note is woken whenever the
   * provider renders at all — including for a leave confirm or a route change. Correct, and no
   * worse than the context this replaced, but do not read it as finer-grained than it is.
   */
  getLive: () => { noteId: string | null; session: UseTranscriptionResult }
}

export const RecordingLiveContext = createContext<RecordingLiveStore | null>(null)

/** Which note is currently recording, for the tab bar. Null when nothing is. */
export function useRecordingNoteId(): string | null {
  return useContext(RecordingControlContext)?.recordingNoteId ?? null
}

/**
 * The note that is recording OR still saving afterwards, for the tab bar and the close-tab
 * guard. Wider than `useRecordingNoteId` on purpose: the marker follows the live capture, but
 * everything that PROTECTS the note has to cover the whole busy period — Stop is not the end of
 * the work, and the audio upload and speaker-labelling run on for minutes after it.
 */
export function useBusyNoteId(): string | null {
  return useContext(RecordingControlContext)?.busyNoteId ?? null
}

/**
 * The session-owned leave guard, for `App`'s `requestLeave` to consult. Returns a stable-enough
 * function; callers must treat a `false` return as "nothing to protect, go ahead".
 */
export function useGuardLeave(): RecordingControlValue['guardLeave'] {
  const ctx = useContext(RecordingControlContext)
  return ctx?.guardLeave ?? (() => false)
}

/** Stand the session's confirm down — see `clearSessionLeave`. */
export function useClearSessionLeave(): () => void {
  const ctx = useContext(RecordingControlContext)
  return ctx?.clearSessionLeave ?? (() => {})
}

// What a note that does NOT own the session sees. Every field is the idle value, so a note off
// the recording path renders exactly as it did before this slice.
/** No provider above us, so there is nothing to be woken by. */
const subscribeToNothing = () => () => {}

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
  const ctx = useContext(RecordingControlContext)
  const store = useContext(RecordingLiveContext)
  // Ownership follows the BINDING, not the capture: a note that has just stopped still owns
  // the session while its transcript commits and its recording uploads, and must keep seeing
  // the real status ('stopped'/'finalising') rather than being handed the idle view.
  //
  // Read from the STORE below rather than from `ctx.boundNoteId` here, so ownership and the
  // session it selects can never be one commit apart — see `RecordingLiveStore.getLive`.
  //
  // The lockout follows the CAPTURE. Keying it off the binding instead is what left the app
  // recordable-once: the binding never clears, so every other note stayed disabled forever.
  const otherNoteRecording = ctx != null && ctx.busyNoteId !== null && ctx.busyNoteId !== noteId
  const otherNoteBusyReason: 'recording' | 'saving' | undefined = !otherNoteRecording
    ? undefined
    : ctx.recordingNoteId !== null
      ? 'recording'
      : 'saving'
  const startIn = ctx?.startIn
  // Only the owning note follows the live session, and — because this is a store subscription
  // rather than a context read — only the owning note RE-RENDERS for it. A note that does not
  // own the session has a snapshot of `IDLE`, which never changes, so it is not woken at all.
  //
  // `IDLE` being a module constant is load-bearing twice over: it is the unchanging snapshot
  // that keeps a non-owner asleep, and it keeps the object returned below stable so that note's
  // effects and memoised children stay put too.
  const view = useSyncExternalStore(store?.subscribe ?? subscribeToNothing, () => {
    const live = store?.getLive()
    return live && live.noteId === noteId ? live.session : IDLE
  })

  const startRecording = useCallback<UseTranscriptionResult['startRecording']>(
    (...args) => startIn?.(noteId, ...args),
    [startIn, noteId],
  )

  const hasRecordedThisSession = ctx?.recordedNoteId === noteId
  const autoAnalyseChoice = ctx?.autoAnalyseChoice ?? true
  const claimAutoAnalyse = ctx?.claimAutoAnalyse
  const releaseAutoAnalyse = ctx?.releaseAutoAnalyse

  return useMemo(
    () => ({
      ...view,
      startRecording,
      otherNoteRecording,
      otherNoteBusyReason,
      hasRecordedThisSession,
      autoAnalyseChoice,
      claimAutoAnalyse,
      releaseAutoAnalyse,
    }),
    [
      view,
      startRecording,
      otherNoteRecording,
      otherNoteBusyReason,
      hasRecordedThisSession,
      autoAnalyseChoice,
      claimAutoAnalyse,
      releaseAutoAnalyse,
    ],
  )
}
