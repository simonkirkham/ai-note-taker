import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import TranscriptTab from '../components/TranscriptTab'

it('renders the transcript text', () => {
  render(<TranscriptTab transcript="These are the spoken words." />)
  expect(screen.getByTestId('transcription-text')).toHaveTextContent('These are the spoken words.')
})

it('is read-only: contains no editable controls', () => {
  const { container } = render(<TranscriptTab transcript="Some words" />)
  expect(container.querySelector('textarea')).toBeNull()
  expect(container.querySelector('input')).toBeNull()
  expect(container.querySelector('[contenteditable="true"]')).toBeNull()
})

it('shows an empty placeholder when there is no transcript and not recording', () => {
  render(<TranscriptTab transcript={null} />)
  const empty = screen.getByTestId('transcript-empty')
  expect(empty).toBeInTheDocument()
  expect(empty).toHaveAttribute('role', 'status') // 19-F1
  expect(screen.queryByTestId('transcription-text')).toBeNull()
})

it('shows a listening placeholder when recording with no transcript yet', () => {
  render(<TranscriptTab transcript={null} isRecording />)
  const listening = screen.getByText('Listening…')
  expect(listening).toBeInTheDocument()
  expect(listening).toHaveAttribute('role', 'status') // 19-F1
})

// 33-A: the "Download recording" affordance.
it('shows no recording bar when there is no recording', () => {
  render(<TranscriptTab transcript="words" recordingStatus="none" />)
  expect(screen.queryByTestId('recording-bar')).toBeNull()
})

it('shows the download button and fires onDownloadRecording when available', async () => {
  const onDownload = vi.fn()
  render(<TranscriptTab transcript="words" recordingStatus="available" onDownloadRecording={onDownload} />)
  const button = screen.getByTestId('recording-download-button')
  await userEvent.click(button)
  expect(onDownload).toHaveBeenCalledOnce()
})

it('shows an optimistic saving hint while the recording uploads', () => {
  render(<TranscriptTab transcript="words" recordingStatus="uploading" />)
  expect(screen.getByTestId('recording-uploading')).toBeInTheDocument()
  expect(screen.queryByTestId('recording-download-button')).toBeNull()
})

it('shows an error when the recording upload failed', () => {
  render(<TranscriptTab transcript="words" recordingStatus="failed" />)
  expect(screen.getByTestId('recording-failed')).toHaveAttribute('role', 'alert')
})

// 33-B1: the speaker-labelling chip.
it('shows the refining chip while diarization is in progress', () => {
  render(<TranscriptTab transcript="words" diarizationStatus="refining" />)
  const chip = screen.getByTestId('diarization-refining')
  expect(chip).toHaveTextContent('Refining transcript with speaker labels…')
  expect(chip).toHaveAttribute('role', 'status')
})

it('shows a non-blocking notice (transcript intact) when diarization fails', () => {
  render(<TranscriptTab transcript="the live transcript" diarizationStatus="failed" />)
  expect(screen.getByTestId('diarization-failed')).toBeInTheDocument()
  // The streamed transcript still shows — diarization failure never blanks it.
  expect(screen.getByTestId('transcription-text')).toHaveTextContent('the live transcript')
})

it('shows no diarization chip when status is none', () => {
  render(<TranscriptTab transcript="words" diarizationStatus="none" />)
  expect(screen.queryByTestId('diarization-bar')).toBeNull()
})
