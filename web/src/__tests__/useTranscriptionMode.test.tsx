import { act, renderHook, waitFor } from '@testing-library/react'
import { useTranscriptionMode, readStoredMode, DEFAULT_MODE } from '../hooks/useTranscriptionMode'
import type { LocalTranscriptionStatus } from '../types/desktop'

// 48-A — the desktop transcription-mode preference. Mirrors useTheme's localStorage contract;
// default is cloud so the proven path stays default until the user opts in AND the model is ready.

function fakeDesktop(status: LocalTranscriptionStatus) {
  ;(window as unknown as { desktop: unknown }).desktop = {
    isDesktop: true,
    platform: 'win32',
    local: {
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

it('defaults to cloud when nothing is stored', () => {
  expect(readStoredMode()).toBe(DEFAULT_MODE)
  expect(DEFAULT_MODE).toBe('cloud')
  const { result } = renderHook(() => useTranscriptionMode())
  expect(result.current.mode).toBe('cloud')
})

it('setMode persists the choice to localStorage', () => {
  const { result } = renderHook(() => useTranscriptionMode())
  act(() => result.current.setMode('local'))
  expect(result.current.mode).toBe('local')
  expect(localStorage.getItem('note-taker-transcription-mode')).toBe('local')
  expect(readStoredMode()).toBe('local')
})

it('isDesktop is false in the web app (no window.desktop)', () => {
  const { result } = renderHook(() => useTranscriptionMode())
  expect(result.current.isDesktop).toBe(false)
})

it('effectiveMode stays cloud when local is selected but the model is not ready', async () => {
  fakeDesktop({ modelReady: false, downloading: true, progress: 0.4 })
  localStorage.setItem('note-taker-transcription-mode', 'local')
  const { result } = renderHook(() => useTranscriptionMode())
  await waitFor(() => expect(result.current.status.downloading).toBe(true))
  expect(result.current.mode).toBe('local')
  expect(result.current.effectiveMode).toBe('cloud') // falls back until ready
})

it('effectiveMode becomes local once desktop model is ready and local is selected', async () => {
  fakeDesktop({ modelReady: true, downloading: false, progress: 1 })
  localStorage.setItem('note-taker-transcription-mode', 'local')
  const { result } = renderHook(() => useTranscriptionMode())
  await waitFor(() => expect(result.current.status.modelReady).toBe(true))
  expect(result.current.effectiveMode).toBe('local')
})
