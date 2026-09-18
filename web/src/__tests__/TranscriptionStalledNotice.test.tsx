import { render, screen } from '@testing-library/react'
import RecordControl from '../components/RecordControl'
import type { UseTranscriptionResult } from '../hooks/useTranscription'

// BUG-85 slice 1 — the live transcript can stop part-way through a meeting while the timer keeps
// running. It happened twice, costing 54 minutes of one meeting and 3.5 hours of another, and
// nothing on screen said so at the time. The recording control now says how long it has been since
// any words were transcribed, says which of three things it looks like, and says what to do.
//
// Review round 1: the message must not assert that transcription has STOPPED — a meeting can be
// quiet for two minutes — and the duration must stay out of the announced region, or a screen
// reader re-reads the whole notice every minute for the length of the stall.

function transcription(over: Partial<UseTranscriptionResult> = {}): UseTranscriptionResult {
  return {
    status: 'idle',
    transcript: '',
    elapsedSeconds: 0,
    error: undefined,
    recordingUpload: 'idle',
    diarization: 'idle',
    startRecording: () => {},
    stopRecording: () => {},
    awaitCommit: async () => {},
    reset: () => {},
    ...over,
  }
}

function region() {
  return screen.getByTestId('transcription-stall')
}

it('announces nothing during a healthy recording, but keeps the region there to announce into', () => {
  render(<RecordControl noteId="n1" transcription={transcription({ status: 'recording', elapsedSeconds: 900 })} />)

  expect(region()).toBeInTheDocument()
  expect(region()).toHaveTextContent('')
  expect(screen.queryByTestId('transcription-stall-duration')).not.toBeInTheDocument()
})

it('says the audio source ended, and what to do, when a captured track died', () => {
  render(
    <RecordControl
      noteId="n1"
      transcription={transcription({
        status: 'recording',
        stall: { kind: 'sourceEnded', stalledForSeconds: 140 },
      })}
    />,
  )

  expect(region()).toHaveTextContent(/audio source ended/i)
  expect(region()).toHaveTextContent(/stop and start recording again/i)
  expect(screen.getByTestId('transcription-stall-duration')).toHaveTextContent(
    /no words have been transcribed for 2 minutes/i,
  )
})

it('says no sound is being picked up when the captured audio went silent', () => {
  render(
    <RecordControl
      noteId="n1"
      transcription={transcription({ status: 'recording', stall: { kind: 'noSound', stalledForSeconds: 200 } })}
    />,
  )

  expect(region()).toHaveTextContent(/no sound is being picked up/i)
  expect(region()).toHaveTextContent(/stop and start recording again/i)
})

// The one case that may be nothing at all — a quiet patch in a healthy meeting. It states the fact
// and leaves the judgement to the person in the room; it must never assert that something broke.
it('states the fact without claiming transcription has stopped when only the words dried up', () => {
  render(
    <RecordControl
      noteId="n1"
      transcription={transcription({ status: 'recording', stall: { kind: 'noWords', stalledForSeconds: 130 } })}
    />,
  )

  expect(region()).toHaveTextContent(/nothing is coming back from transcription/i)
  expect(region()).toHaveTextContent(/if the meeting is not simply quiet/i)
  expect(screen.getByTestId('transcription-stall-duration')).toHaveTextContent(
    /no words have been transcribed for 2 minutes/i,
  )
  expect(region()).not.toHaveTextContent(/has stopped/i)
})

// A screen reader re-reads a live region whenever its text changes. The duration changes every
// minute, so a three-hour stall would re-read the whole notice 200 times if it were inside.
it('keeps the changing duration out of the announced region', () => {
  const view = render(
    <RecordControl
      noteId="n1"
      transcription={transcription({ status: 'recording', stall: { kind: 'noSound', stalledForSeconds: 130 } })}
    />,
  )
  const announced = region().textContent

  view.rerender(
    <RecordControl
      noteId="n1"
      transcription={transcription({ status: 'recording', stall: { kind: 'noSound', stalledForSeconds: 900 } })}
    />,
  )

  expect(region().textContent).toBe(announced)
  expect(region()).not.toHaveTextContent(/minute/i)
  expect(screen.getByTestId('transcription-stall-duration')).toHaveTextContent(/15 minutes/)
})

it('announces politely rather than as an alert', () => {
  render(
    <RecordControl
      noteId="n1"
      transcription={transcription({ status: 'recording', stall: { kind: 'noSound', stalledForSeconds: 200 } })}
    />,
  )

  expect(region()).toHaveAttribute('role', 'status')
  expect(region()).toHaveAttribute('aria-live', 'polite')
})

// Focus is the user's place in the meeting — mid-sentence in the note, most likely. The notice
// appearing must not move it, so the check has to start from focus being somewhere findable.
it('leaves focus exactly where it was when the notice appears', () => {
  const view = render(<RecordControl noteId="n1" transcription={transcription({ status: 'recording' })} />)
  const stop = screen.getByTestId('transcription-stop-button')
  stop.focus()
  expect(document.activeElement).toBe(stop)

  view.rerender(
    <RecordControl
      noteId="n1"
      transcription={transcription({ status: 'recording', stall: { kind: 'sourceEnded', stalledForSeconds: 140 } })}
    />,
  )

  expect(document.activeElement).toBe(stop)
})

it('clears the moment text starts arriving again', () => {
  const view = render(
    <RecordControl
      noteId="n1"
      transcription={transcription({ status: 'recording', stall: { kind: 'noWords', stalledForSeconds: 130 } })}
    />,
  )
  expect(region()).toHaveTextContent(/transcription/i)

  view.rerender(<RecordControl noteId="n1" transcription={transcription({ status: 'recording' })} />)

  expect(region()).toHaveTextContent('')
  expect(screen.queryByTestId('transcription-stall-duration')).not.toBeInTheDocument()
})

// Once the recording is over the notice is history — the user is looking at a finished transcript,
// not at something they can put right by restarting.
it('says nothing once the recording has stopped', () => {
  render(
    <RecordControl
      noteId="n1"
      transcription={transcription({ status: 'stopped', stall: { kind: 'noSound', stalledForSeconds: 400 } })}
    />,
  )

  expect(screen.queryByTestId('transcription-stall')).not.toBeInTheDocument()
  expect(screen.queryByTestId('transcription-stall-duration')).not.toBeInTheDocument()
})
