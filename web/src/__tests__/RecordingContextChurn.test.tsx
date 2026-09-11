// The provider refreshes a note's cached detail after writing it up, so it needs the query
// client every real mount has above it (main.tsx).
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen } from '@testing-library/react'
import { useEffect, useState } from 'react'
import { MemoryRouter } from 'react-router'
import { RecordingSessionProvider } from '../hooks/recordingSession'
import { useNoteRecording, useRecordingNoteId } from '../hooks/recordingSessionContext'
import type { TranscriptionStatus, UseTranscriptionResult } from '../hooks/useTranscription'

// 51-C review finding: while you are recording, everything outside the note screen was
// re-rendering several times a second, for the length of the meeting.
//
// The speech service delivers a partial result every few hundred milliseconds and each one sets
// state. Hoisting the session put that state in a context the whole app reads, so the sidebar,
// the notes list, the folder panel, the workspace switcher and the open-note tab bar all
// re-rendered at that rate — on the same main thread that feeds the on-device transcriber,
// where CPU load has already been measured dropping audio (BUG-65/67).
//
// The fix is two contexts: one for the live transcript, one for everything else. This spec
// pins that boundary, because nothing else can — the symptom is a slow phone, not a failure,
// and it would come straight back the first time a churning value is added to the control
// context without anyone noticing.

let emitPartial: (text: string) => void = () => {}

vi.mock('../hooks/useTranscription', () => ({
  useTranscription: (): UseTranscriptionResult => {
    const [status, setStatus] = useState<TranscriptionStatus>('idle')
    const [transcript, setTranscript] = useState('')
    emitPartial = setTranscript
    return {
      status,
      transcript,
      elapsedSeconds: 0,
      error: undefined,
      recordingUpload: 'idle',
      diarization: 'idle',
      // Clears the transcript, as the real hook does — a new meeting does not inherit the last
      // one's words. Load-bearing for the ownership test below: without it the previous note's
      // transcript lingers in the session and the stale-commit defect is invisible.
      startRecording: () => {
        setStatus('recording')
        setTranscript('')
      },
      stopRecording: () => setStatus('stopped'),
      awaitCommit: async () => {},
      reset: () => setStatus('idle'),
    }
  },
}))

// Counted from effects, not during render: touching a ref or a module global while rendering
// is a lint gate here, and an effect with no dependency array runs once per commit — which is
// what "how many times did this re-render?" actually means.
let outsideRenders = 0
let otherNoteRenders = 0
let otherNoteViews = 0
let recordingStarted = false
/** Every transcript each note was shown, in order, across every render. */
let shown: Record<string, string[]> = {}

/** Stands in for everything outside the note screen: reads the session, not the transcript. */
function OutsideTheNote() {
  const recordingNoteId = useRecordingNoteId()
  useEffect(() => {
    outsideRenders += 1
  })
  return <div data-testid="outside-recording-note">{recordingNoteId ?? 'none'}</div>
}

/** Stands in for the note screen: this one is SUPPOSED to follow the transcript. */
function TheRecordingNote({ noteId }: { noteId: string }) {
  const transcription = useNoteRecording(noteId)
  const start = transcription.startRecording
  // A module flag rather than component state: a setState in an effect body is a lint gate
  // here, and this only needs to happen once for the whole mount.
  useEffect(() => {
    if (recordingStarted) return
    recordingStarted = true
    start(true, true)
  }, [start])
  return <div data-testid="note-transcript">{transcription.transcript}</div>
}

/** Stands in for a note you are reading while another one records. */
function AnotherNote({ noteId }: { noteId: string }) {
  const transcription = useNoteRecording(noteId)
  // BOTH counts, because they fail separately and an earlier version of this spec had only the
  // second — which is why it reported the boundary as fixed while this note was still being
  // re-rendered 25 times for 25 partial results. Object identity was already stable; React was
  // waking the component anyway, because a hook cannot subscribe to a context conditionally.
  useEffect(() => {
    otherNoteRenders += 1
  })
  useEffect(() => {
    otherNoteViews += 1
  }, [transcription])
  return null
}

/**
 * Records every transcript this note is handed, and exposes a button to claim the session.
 * Nothing is asserted from the final state — the defect being pinned is visible only in the
 * intermediate commits, so the whole sequence is kept.
 */
function WatchedNote({ noteId }: { noteId: string }) {
  const transcription = useNoteRecording(noteId)
  const { transcript, startRecording, stopRecording } = transcription
  useEffect(() => {
    ;(shown[noteId] ??= []).push(transcript)
  })
  return (
    <>
      <button data-testid={`start-${noteId}`} onClick={() => startRecording(true, true)}>
        record
      </button>
      <button data-testid={`stop-${noteId}`} onClick={() => stopRecording()}>
        stop
      </button>
    </>
  )
}

function mountTwoNotes() {
  shown = {}
  return render(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient()}><RecordingSessionProvider>
        <WatchedNote noteId="note-1" />
        <WatchedNote noteId="note-2" />
      </RecordingSessionProvider></QueryClientProvider>
    </MemoryRouter>,
  )
}

function mount() {
  outsideRenders = 0
  otherNoteRenders = 0
  otherNoteViews = 0
  recordingStarted = false
  shown = {}
  return render(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient()}><RecordingSessionProvider>
        <OutsideTheNote />
        <TheRecordingNote noteId="note-1" />
        <AnotherNote noteId="note-2" />
      </RecordingSessionProvider></QueryClientProvider>
    </MemoryRouter>,
  )
}

describe('51-C — a live recording does not re-render the rest of the app', () => {
  it('leaves everything outside the note screen alone while partial results arrive', async () => {
    mount()
    await screen.findByTestId('outside-recording-note')
    expect(screen.getByTestId('outside-recording-note')).toHaveTextContent('note-1')

    const outsideBefore = outsideRenders
    const otherNoteRendersBefore = otherNoteRenders
    const otherNoteViewsBefore = otherNoteViews

    // A meeting's worth of partial results, in the shape the speech service delivers them —
    // one commit each, not one batched commit, which is what makes this a churn test.
    for (let i = 0; i < 25; i += 1) {
      const text = `partial result ${i}`
      act(() => emitPartial(text))
    }

    // The note being recorded DOES follow them — that is not churn, it is the feature.
    expect(screen.getByTestId('note-transcript')).toHaveTextContent('partial result 24')

    expect(outsideRenders).toBe(outsideBefore)
    // The note you are READING while another one records. This is the biggest consumer of the
    // two — it is a whole note screen, editor included — and the one the first attempt missed.
    expect(otherNoteRenders).toBe(otherNoteRendersBefore)
    expect(otherNoteViews).toBe(otherNoteViewsBefore)
  })

  // Ownership and the session it selects have to move together.
  //
  // They stopped being atomic when the transcript moved out of the context: ownership was read
  // from the context (updated while the provider renders) and the session from the store
  // (updated after commit). For one commit the note you had just pressed Record in was shown
  // the PREVIOUS note's transcript and status — and effects run child-first, so the record
  // control acted on that commit before the provider corrected it.
  //
  // Nothing about the final state shows this, which is why the assertion is over every value
  // each note was handed rather than the last one.
  it('never shows a note the previous note\'s transcript, not even for one render', async () => {
    mountTwoNotes()

    await act(async () => screen.getByTestId('start-note-1').click())
    act(() => emitPartial('what the first meeting said'))
    expect(shown['note-1']).toContain('what the first meeting said')

    // Stop first — one meeting at a time is the rule, and this is the realistic sequence: the
    // first note is stopped but still BOUND, still holding its transcript, when the second
    // note claims the session.
    await act(async () => screen.getByTestId('stop-note-1').click())
    await act(async () => screen.getByTestId('start-note-2').click())
    act(() => emitPartial('what the second meeting said'))

    expect(shown['note-2']).not.toContain('what the first meeting said')
    expect(shown['note-2']).toContain('what the second meeting said')
  })
})
