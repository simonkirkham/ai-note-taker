import { act, fireEvent, render, renderHook, screen } from '@testing-library/react'
import KeepAudioLocalToggle from '../components/KeepAudioLocalToggle'
import {
  useKeepAudioLocal,
  readStoredKeepAudioLocal,
  DEFAULT_KEEP_LOCAL,
} from '../hooks/useKeepAudioLocal'

// 48-E — desktop-only "keep recordings on this device only" setting. Default ON (privacy-first).

function fakeDesktop() {
  ;(window as unknown as { desktop: unknown }).desktop = { isDesktop: true, platform: 'win32' }
}

beforeEach(() => {
  localStorage.clear()
  delete (window as unknown as { desktop?: unknown }).desktop
})

it('defaults to on (keep local) when nothing is stored', () => {
  expect(DEFAULT_KEEP_LOCAL).toBe(true)
  expect(readStoredKeepAudioLocal()).toBe(true)
  const { result } = renderHook(() => useKeepAudioLocal())
  expect(result.current.keepLocal).toBe(true)
})

it('persists the choice to localStorage', () => {
  const { result } = renderHook(() => useKeepAudioLocal())
  act(() => result.current.setKeepLocal(false))
  expect(result.current.keepLocal).toBe(false)
  expect(localStorage.getItem('note-taker-keep-audio-local')).toBe('false')
  expect(readStoredKeepAudioLocal()).toBe(false)
  act(() => result.current.setKeepLocal(true))
  expect(readStoredKeepAudioLocal()).toBe(true)
})

it('renders nothing in the web app (not desktop)', () => {
  const { container } = render(<KeepAudioLocalToggle />)
  expect(container).toBeEmptyDOMElement()
})

it('renders a checked toggle by default in the desktop shell', () => {
  fakeDesktop()
  render(<KeepAudioLocalToggle />)
  const toggle = screen.getByTestId('keep-audio-local-toggle') as HTMLInputElement
  expect(toggle.checked).toBe(true)
})

it('unchecking it opts back into upload', () => {
  fakeDesktop()
  render(<KeepAudioLocalToggle />)
  fireEvent.click(screen.getByTestId('keep-audio-local-toggle'))
  expect(localStorage.getItem('note-taker-keep-audio-local')).toBe('false')
})
