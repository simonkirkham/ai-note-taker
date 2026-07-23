import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import TranscriptionModeToggle from '../components/TranscriptionModeToggle'
import type { LocalTranscriptionStatus } from '../types/desktop'

// 48-A — the Local/Cloud toggle is desktop-only and shows a "Preparing…" hint while the
// on-device model downloads (recording falls back to cloud until then).

function fakeDesktop(status: LocalTranscriptionStatus) {
  ;(window as unknown as { desktop: unknown }).desktop = {
    isDesktop: true,
    platform: 'win32',
    local: {
      prepare: () => {},
      getStatus: () => Promise.resolve(status),
      onStatus: () => () => {},
      start: () => Promise.resolve(),
      pushPcm: () => {},
      finish: () => Promise.resolve(),
      onSegments: () => () => {},
      onError: () => () => {},
    },
  }
}

beforeEach(() => {
  localStorage.clear()
  delete (window as unknown as { desktop?: unknown }).desktop
})

it('renders nothing in the web app (not desktop)', () => {
  const { container } = render(<TranscriptionModeToggle />)
  expect(container).toBeEmptyDOMElement()
})

it('renders the Local/Cloud select in the desktop shell', () => {
  fakeDesktop({ modelReady: true, downloading: false, progress: 1 })
  render(<TranscriptionModeToggle />)
  expect(screen.getByTestId('transcription-mode-select')).toHaveValue('cloud')
  expect(screen.getByRole('option', { name: 'On device' })).toBeInTheDocument()
})

it('selecting On device persists the choice', () => {
  fakeDesktop({ modelReady: true, downloading: false, progress: 1 })
  render(<TranscriptionModeToggle />)
  fireEvent.change(screen.getByTestId('transcription-mode-select'), { target: { value: 'local' } })
  expect(localStorage.getItem('note-taker-transcription-mode')).toBe('local')
})

it('shows a Preparing hint when Local is chosen but the model is still downloading', async () => {
  fakeDesktop({ modelReady: false, downloading: true, progress: 0.5 })
  localStorage.setItem('note-taker-transcription-mode', 'local')
  render(<TranscriptionModeToggle />)
  await waitFor(() => expect(screen.getByTestId('transcription-mode-preparing')).toBeInTheDocument())
  expect(screen.getByTestId('transcription-mode-preparing').textContent).toContain('Preparing')
})
