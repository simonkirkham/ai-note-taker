import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { useTranscription } from '../hooks/useTranscription'
import { server } from '../test/setup'

// BUG-74: the local branch's tail — `discard()` inside a `finally`, then `localCleanupRef` — could
// throw, and a throw in a `finally` REPLACES the completion. That rejected the whole stop sequence
// before `commitTranscript()` and before `setStatus('stopped')`, so the user who STAYED on the note
// was wedged on 'Finalising…' permanently, with no transcript and an unhandled rejection.
//
// BUG-72 fixed the same engine fault for the user who LEAVES (the unmount chains and commits the
// live text as a fallback). Same fault, two endings, depending only on whether you navigated away.
// Found by review probing BUG-72 rather than by report.

let resolveFinish: ((text: string | null) => void) | undefined
let emitLive: ((text: string) => void) | undefined
let throwOnDiscard = false
let throwOnDetach = false
let throwOnStopTrack = false
const committed: string[] = []

function stubBrowserApis() {
  // `cleanup()` stops the captured tracks, AFTER commitTranscript(). A throw there cannot cost the
  // transcript, but without a terminal handler on the sequence it left the status stuck on
  // 'finalising' and surfaced only as an unhandled rejection — the same wedge, later in the tail.
  const mockStream = {
    getTracks: () => [{
      stop: () => {
        if (throwOnStopTrack) throw new Error('stopping the capture track blew up')
      },
    }],
  } as unknown as MediaStream
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
        // The unsubscribe the hook stores in localCleanupRef — the second throw site.
        return () => {
          if (throwOnDetach) throw new Error('detaching the on-device listeners blew up')
        }
      },
      onError: () => () => {},
      finish: () => new Promise<string | null>((resolve) => { resolveFinish = resolve }),
      discard: () => {
        if (throwOnDiscard) throw new Error('releasing the on-device session blew up')
      },
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

beforeEach(() => {
  resolveFinish = undefined
  emitLive = undefined
  throwOnDiscard = false
  throwOnDetach = false
  throwOnStopTrack = false
  committed.length = 0
  localStorage.setItem('note-taker-transcription-mode', 'local')
  stubBrowserApis()
  stubDesktopLocal()
  server.use(
    http.post('/api/notes/:noteId/transcription', async ({ request }) => {
      const body = (await request.json()) as { transcriptText: string }
      committed.push(body.transcriptText)
      return new HttpResponse(null, { status: 204 })
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete (window as unknown as { desktop?: unknown }).desktop
})

async function recordAndStop(text: string) {
  await userEvent.click(screen.getByTestId('start'))
  await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('recording'))
  await waitFor(() => expect(emitLive).toBeDefined())
  emitLive?.(text)
  await userEvent.click(screen.getByTestId('stop'))
  await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('finalising'))
}

describe('the on-device tail throwing on stop (BUG-74)', () => {
  it('still commits and leaves finalising when releasing the session throws', async () => {
    throwOnDiscard = true
    render(<Recorder />)
    await recordAndStop('the text the user actually recorded')

    resolveFinish?.('the finalised text')

    // Neither may be pre-empted by the throw: the transcript is kept, and the UI is not wedged.
    await waitFor(() => expect(committed).toHaveLength(1))
    expect(committed[0]).toContain('the finalised text')
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('stopped'))
  })

  it('still commits and leaves finalising when detaching the listeners throws', async () => {
    // The second throw site, one line further on and outside the try/finally entirely.
    throwOnDetach = true
    render(<Recorder />)
    await recordAndStop('the text the user actually recorded')

    resolveFinish?.('the finalised text')

    await waitFor(() => expect(committed).toHaveLength(1))
    expect(committed[0]).toContain('the finalised text')
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('stopped'))
  })

  it('commits the finalised text, not the live text, when the tail is healthy', async () => {
    // The guard must not change the happy path it is protecting.
    render(<Recorder />)
    await recordAndStop('rough live text')

    resolveFinish?.('the finalised text')

    await waitFor(() => expect(committed).toHaveLength(1))
    expect(committed[0]).toContain('the finalised text')
    expect(committed[0]).not.toContain('rough live text')
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('stopped'))
  })

  // A third site, found by this file's own test throwing out of `view.unmount()`: `cleanup()` runs
  // inside React's effect teardown, so a throwing `track.stop()` escapes the unmount itself and
  // takes the rest of the teardown with it. Without the guard this test fails on the UNMOUNT, not
  // on an assertion — which is what makes it worth having.
  it('survives a throwing capture teardown, and still commits and stops', async () => {
    throwOnStopTrack = true
    render(<Recorder />)
    await recordAndStop('the text the user actually recorded')

    resolveFinish?.('the finalised text')

    await waitFor(() => expect(committed).toHaveLength(1))
    expect(committed[0]).toContain('the finalised text')
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('stopped'))
  })
})
