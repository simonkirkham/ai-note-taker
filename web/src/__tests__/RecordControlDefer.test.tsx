import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { analyseNote } from '../api/notes'
import RecordControl from '../components/RecordControl'
import type { DiarizationStatus, UseTranscriptionResult } from '../hooks/useTranscription'

// 33-B2: the on-Stop auto-analyse must DEFER to the server while a diarization job is in flight
// ('refining') or started-but-slow ('timedOut') — the completion Lambda re-analyses on the winning
// transcript. It must still run a LOCAL fallback when the job never started ('failed'), and never
// run when auto-analyse is off. RecordControl is a controlled component (transcription is a prop),
// so we drive the diarization state directly. analyseNote is the local-analyse call. (vitest hoists
// vi.mock above the imports, so the mock applies to the analyseNote import above.)
vi.mock('../api/notes', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/notes')>()),
  analyseNote: vi.fn(() => Promise.resolve()),
}))

function txn(overrides: Partial<UseTranscriptionResult> = {}): UseTranscriptionResult {
  return {
    status: 'idle',
    transcript: '',
    elapsedSeconds: 0,
    error: undefined,
    recordingUpload: 'idle',
    diarization: 'idle',
    startRecording: vi.fn(),
    stopRecording: vi.fn(),
    reset: vi.fn(),
    ...overrides,
  }
}

// Render idle, click Record (sets the component's hasRecordedThisSession), then re-render with the
// recording stopped and the given diarization state — the shape the parent passes after a Stop.
async function recordThenStop(diarization: DiarizationStatus) {
  const view = render(<RecordControl noteId="n1" transcription={txn({ status: 'idle' })} />)
  await userEvent.click(screen.getByRole('button', { name: 'Record' }))
  view.rerender(
    <RecordControl noteId="n1" transcription={txn({ status: 'stopped', transcript: 'spoken words', diarization })} />,
  )
  return view
}

beforeEach(() => vi.mocked(analyseNote).mockClear())

it('defers the auto-analyse while a diarization job is refining', async () => {
  await recordThenStop('refining')
  // give the effect a tick
  await new Promise((r) => setTimeout(r, 0))
  expect(analyseNote).not.toHaveBeenCalled()
})

it('keeps deferring when the job started but timed out (server still owns the analyse)', async () => {
  await recordThenStop('timedOut')
  await new Promise((r) => setTimeout(r, 0))
  expect(analyseNote).not.toHaveBeenCalled()
})

it('runs a local fallback analyse when diarization never started (failed)', async () => {
  await recordThenStop('failed')
  await vi.waitFor(() => expect(analyseNote).toHaveBeenCalledWith('n1'))
})

it('never auto-analyses when auto-analyse is off, even on a failed trigger', async () => {
  const view = render(<RecordControl noteId="n1" transcription={txn({ status: 'idle' })} />)
  await userEvent.click(screen.getByTestId('transcription-auto-analyse-toggle')) // turn OFF
  await userEvent.click(screen.getByRole('button', { name: 'Record' }))
  view.rerender(
    <RecordControl noteId="n1" transcription={txn({ status: 'stopped', transcript: 'spoken words', diarization: 'failed' })} />,
  )
  await new Promise((r) => setTimeout(r, 0))
  expect(analyseNote).not.toHaveBeenCalled()
})

it('manual Analyse is honoured immediately even while a job is refining', async () => {
  await recordThenStop('refining')
  await userEvent.click(screen.getByTestId('transcription-analyse-button'))
  await vi.waitFor(() => expect(analyseNote).toHaveBeenCalledWith('n1'))
})
