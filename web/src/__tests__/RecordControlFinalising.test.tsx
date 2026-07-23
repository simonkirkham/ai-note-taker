import { render, screen } from '@testing-library/react'
import RecordControl from '../components/RecordControl'
import type { UseTranscriptionResult, TranscriptionStatus } from '../hooks/useTranscription'

// 48-B — while the on-device higher-quality (medium.en) final pass runs on stop, RecordControl
// shows a transient "Finalising transcript…" indicator. Rendered from a controlled prop, so no
// hook/engine harness needed.

function fakeTranscription(status: TranscriptionStatus): UseTranscriptionResult {
  return {
    status,
    transcript: 'hello world',
    elapsedSeconds: 0,
    error: undefined,
    recordingUpload: 'idle',
    diarization: 'idle',
    startRecording: () => {},
    stopRecording: () => {},
    reset: () => {},
  }
}

it('shows "Finalising transcript…" while the final pass runs', () => {
  render(<RecordControl noteId="n1" transcription={fakeTranscription('finalising')} />)
  expect(screen.getByTestId('transcription-finalising')).toBeInTheDocument()
  expect(screen.getByTestId('transcription-finalising').textContent).toContain('Finalising')
})

it('does not show the finalising indicator while recording', () => {
  render(<RecordControl noteId="n1" transcription={fakeTranscription('recording')} />)
  expect(screen.queryByTestId('transcription-finalising')).not.toBeInTheDocument()
})

it('does not show it once stopped', () => {
  render(<RecordControl noteId="n1" transcription={fakeTranscription('stopped')} />)
  expect(screen.queryByTestId('transcription-finalising')).not.toBeInTheDocument()
})
