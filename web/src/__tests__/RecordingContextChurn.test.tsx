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
      startRecording: () => setStatus('recording'),
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
let otherNoteViews = 0
let recordingStarted = false

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
  // Counts how many DISTINCT objects this note was handed, not how many times React ran the
  // component. A new object on every partial is what re-runs a note's effects and re-renders
  // its memoised children, so identity is the cost that matters — and keying the effect on
  // `transcription` measures exactly that.
  useEffect(() => {
    otherNoteViews += 1
  }, [transcription])
  return null
}

function mount() {
  outsideRenders = 0
  otherNoteViews = 0
  recordingStarted = false
  return render(
    <MemoryRouter>
      <RecordingSessionProvider>
        <OutsideTheNote />
        <TheRecordingNote noteId="note-1" />
        <AnotherNote noteId="note-2" />
      </RecordingSessionProvider>
    </MemoryRouter>,
  )
}

describe('51-C — a live recording does not re-render the rest of the app', () => {
  it('leaves everything outside the note screen alone while partial results arrive', async () => {
    mount()
    await screen.findByTestId('outside-recording-note')
    expect(screen.getByTestId('outside-recording-note')).toHaveTextContent('note-1')

    const outsideBefore = outsideRenders
    const otherNoteBefore = otherNoteViews

    // A meeting's worth of partial results, in the shape the speech service delivers them —
    // one commit each, not one batched commit, which is what makes this a churn test.
    for (let i = 0; i < 25; i += 1) {
      const text = `partial result ${i}`
      act(() => emitPartial(text))
    }

    // The note being recorded DOES follow them — that is not churn, it is the feature.
    expect(screen.getByTestId('note-transcript')).toHaveTextContent('partial result 24')

    expect(outsideRenders).toBe(outsideBefore)
    expect(otherNoteViews).toBe(otherNoteBefore)
  })
})
