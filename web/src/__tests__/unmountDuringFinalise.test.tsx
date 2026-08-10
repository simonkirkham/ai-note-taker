import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { useTranscription } from '../hooks/useTranscription'
import { server } from '../test/setup'

// BUG-72: the unmount effect called `commitTranscript()` unconditionally. In LOCAL mode the
// stop-time small.en pass (plus 1:1 diarization) runs for minutes after Stop, and it is that pass
// which produces the transcript worth keeping. Leaving the note during it committed the interim
// LIVE base.en text and latched `committedRef`, so when the better result landed its own
// commitTranscript() early-returned and it was discarded — silently, with no indication the better
// transcript had ever existed.
//
// This is the QUALITY half of the race BUG-55 fixed the AUTH half of. Sign-out is the only
// destination that clears the token; every other one just needed the interim commit to stop
// pre-empting the real one.

let resolveFinish: ((text: string | null) => void) | undefined
let emitLive: ((text: string) => void) | undefined
const committed: string[] = []

function stubBrowserApis() {
  const mockStream = { getTracks: () => [{ stop: vi.fn() }] } as unknown as MediaStream
  Object.defineProperty(global.navigator, 'mediaDevices', {
    value: { getUserMedia: vi.fn().mockResolvedValue(mockStream), getDisplayMedia: vi.fn() },
    configurable: true,
  })
  vi.stubGlobal('AudioContext', vi.fn().mockImplementation(function () {
    return {
      sampleRate: 16000,
      createMediaStreamSource: vi.fn().mockReturnValue({ connect: vi.fn() }),
      createGain: vi.fn().mockReturnValue({ connect: vi.fn() }),
      audioWorklet: { addModule: vi.fn().mockResolvedValue(undefined) },
      destination: {},
      close: vi.fn().mockResolvedValue(undefined),
    }
  }))
  vi.stubGlobal('AudioWorkletNode', vi.fn().mockImplementation(function () {
    return { connect: vi.fn(), port: { onmessage: null } }
  }))
}

function stubDesktopLocal() {
  ;(window as unknown as { desktop: unknown }).desktop = {
    isDesktop: true,
    platform: 'win32',
    local: {
      getStatus: async () => ({ modelReady: true }),
      start: async () => {},
      onLive: (cb: (text: string) => void) => {
        emitLive = cb
        return () => {}
      },
      onError: () => () => {},
      finish: () => new Promise<string | null>((resolve) => { resolveFinish = resolve }),
      discard: () => {},
    },
  }
}

function Recorder() {
  const transcription = useTranscription('note-1')
  return (
    <>
      <button data-testid="start" onClick={() => transcription.startRecording(false, false)}>start</button>
      <button data-testid="stop" onClick={() => transcription.stopRecording()}>stop</button>
      <span data-testid="status">{transcription.status}</span>
    </>
  )
}

// Mirrors leaving the note: the hook's owner unmounts while the finalise is still running.
function Harness({ mounted }: { mounted: boolean }) {
  return mounted ? <Recorder /> : <span data-testid="gone">left the note</span>
}

beforeEach(() => {
  resolveFinish = undefined
  emitLive = undefined
  committed.length = 0
  localStorage.setItem('note-taker-transcription-mode', 'local')
  stubBrowserApis()
  stubDesktopLocal()
  const record = async ({ request }: { request: Request }) => {
    const body = (await request.json()) as { transcriptText: string }
    committed.push(body.transcriptText)
    return new HttpResponse(null, { status: 204 })
  }
  // Both shapes: `scoped()` registers the un-prefixed and the `/w/:wsId` path, and matching only
  // one leaves the recorder empty while the request quietly succeeds.
  server.use(
    http.post('/api/notes/:noteId/transcription', record),
    http.post('/api/w/:wsId/notes/:noteId/transcription', record),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete (window as unknown as { desktop?: unknown }).desktop
})

describe('leaving the note during a local finalise (BUG-72)', () => {
  it('keeps the better on-device transcript instead of the interim live text', async () => {
    const { rerender } = render(<Harness mounted />)

    await userEvent.click(screen.getByTestId('start'))
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('recording'))
    await waitFor(() => expect(emitLive).toBeDefined())
    emitLive?.('rough live text from the base.en pass')

    await userEvent.click(screen.getByTestId('stop'))
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('finalising'))

    // The user navigates away while the small.en pass is still running.
    rerender(<Harness mounted={false} />)
    await screen.findByTestId('gone')

    // Nothing may have been committed yet — the good transcript does not exist.
    expect(committed).toEqual([])

    resolveFinish?.('the accurate small.en transcript')

    await waitFor(() => expect(committed).toHaveLength(1))
    expect(committed[0]).toContain('the accurate small.en transcript')
    expect(committed[0]).not.toContain('rough live text')
  })

  it('still commits on unmount when no finalise is running', async () => {
    // The guard must not swallow the ordinary case: leaving a note whose transcript is already
    // final still has to persist it, which is what the unmount commit is for.
    const { rerender } = render(<Harness mounted />)

    await userEvent.click(screen.getByTestId('start'))
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('recording'))
    await waitFor(() => expect(emitLive).toBeDefined())
    emitLive?.('text captured before leaving')

    rerender(<Harness mounted={false} />)
    await screen.findByTestId('gone')

    await waitFor(() => expect(committed).toHaveLength(1))
    expect(committed[0]).toContain('text captured before leaving')
  })
})
