import { render, screen } from '@testing-library/react'
import RecordControl from '../components/RecordControl'
import type { UseTranscriptionResult } from '../hooks/useTranscription'

// BUG-56 — the on-device engine reports failure through `error` while the recording CONTINUES
// (audio is still captured for the stop-time pass), so `status` stays 'recording'. The banner was
// gated on `status === "error"`, so that message was stored in state and never rendered: the
// user saw an empty live transcript with no explanation for the whole meeting.

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

it('shows the on-device failure while the recording is still running', () => {
  render(
    <RecordControl
      noteId="n1"
      transcription={transcription({
        status: 'recording',
        error: 'On-device transcription failed: the local engine failed to start.',
      })}
    />,
  )

  expect(screen.getByTestId('transcription-error')).toHaveTextContent(/local engine failed to start/i)
})

it('still shows the failure once the recording is finalising', () => {
  render(
    <RecordControl
      noteId="n1"
      transcription={transcription({
        status: 'finalising',
        error: 'On-device transcription stopped responding.',
      })}
    />,
  )

  expect(screen.getByTestId('transcription-error')).toHaveTextContent(/stopped responding/i)
})

it('keeps the existing hard-failure banner when the whole session errors', () => {
  render(<RecordControl noteId="n1" transcription={transcription({ status: 'error' })} />)

  expect(screen.getByTestId('transcription-error')).toHaveTextContent(/cannot connect/i)
})

it('shows no banner while recording cleanly', () => {
  render(<RecordControl noteId="n1" transcription={transcription({ status: 'recording' })} />)

  expect(screen.queryByTestId('transcription-error')).toBeNull()
})
