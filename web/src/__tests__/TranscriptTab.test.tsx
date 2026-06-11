import { render, screen } from '@testing-library/react'
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
