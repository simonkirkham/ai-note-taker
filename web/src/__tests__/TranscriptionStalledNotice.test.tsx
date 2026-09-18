import { render, screen } from '@testing-library/react'
import RecordControl from '../components/RecordControl'
import type { UseTranscriptionResult } from '../hooks/useTranscription'

// BUG-85 slice 1 — the live transcript can stop part-way through a meeting while the timer keeps
// running. It happened twice, costing 54 minutes of one meeting and 3.5 hours of another, and
// nothing on screen said so at the time. The recording control now says it has stopped, says which
// of the three things went wrong, and says what to do about it.

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

it('says nothing at all during a healthy recording', () => {
  render(<RecordControl noteId="n1" transcription={transcription({ status: 'recording', elapsedSeconds: 900 })} />)

  expect(screen.queryByTestId('transcription-stall')).not.toBeInTheDocument()
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

  const notice = screen.getByTestId('transcription-stall')
  expect(notice).toHaveTextContent(/transcription has stopped/i)
  expect(notice).toHaveTextContent(/audio source ended/i)
  expect(notice).toHaveTextContent(/2 minutes/)
  expect(notice).toHaveTextContent(/stop and start recording again/i)
})

it('says no sound is being picked up when the captured audio went silent', () => {
  render(
    <RecordControl
      noteId="n1"
      transcription={transcription({
        status: 'recording',
        stall: { kind: 'noSound', stalledForSeconds: 200 },
      })}
    />,
  )

  const notice = screen.getByTestId('transcription-stall')
  expect(notice).toHaveTextContent(/no sound is being picked up/i)
  expect(notice).toHaveTextContent(/stop and start recording again/i)
})

it('says sound is arriving but no words are coming back when only the words stopped', () => {
  render(
    <RecordControl
      noteId="n1"
      transcription={transcription({
        status: 'recording',
        stall: { kind: 'noWords', stalledForSeconds: 130 },
      })}
    />,
  )

  const notice = screen.getByTestId('transcription-stall')
  expect(notice).toHaveTextContent(/no words are coming back/i)
  expect(notice).toHaveTextContent(/stop and start recording again/i)
})

// It must not read as a crash and must not steal focus: a polite status region, never an alert,
// and never focused. The transcript is still being captured to the recording either way.
it('announces politely rather than as an alert, and never takes focus', () => {
  render(
    <RecordControl
      noteId="n1"
      transcription={transcription({ status: 'recording', stall: { kind: 'noSound', stalledForSeconds: 200 } })}
    />,
  )

  const notice = screen.getByTestId('transcription-stall')
  expect(notice).toHaveAttribute('role', 'status')
  expect(notice).toHaveAttribute('aria-live', 'polite')
  expect(notice).not.toHaveFocus()
  expect(document.activeElement).toBe(document.body)
})

it('clears the moment text starts arriving again', () => {
  const view = render(
    <RecordControl
      noteId="n1"
      transcription={transcription({ status: 'recording', stall: { kind: 'noWords', stalledForSeconds: 130 } })}
    />,
  )
  expect(screen.getByTestId('transcription-stall')).toBeInTheDocument()

  view.rerender(<RecordControl noteId="n1" transcription={transcription({ status: 'recording' })} />)

  expect(screen.queryByTestId('transcription-stall')).not.toBeInTheDocument()
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
})
