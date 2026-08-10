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
// When set, `discard()` throws — the shape where the stop sequence never reaches its own commit.
let throwOnDiscard = false
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
      // `discard()` is called from the local branch's `finally`. A throw there REPLACES the
      // completion and rejects the whole stop sequence before it reaches commitTranscript() —
      // unlike a finish() rejection, which the inner try/catch swallows and then commits anyway.
      discard: () => {
        if (throwOnDiscard) throw new Error('the local engine blew up on discard')
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

// Mirrors leaving the note: the hook's owner unmounts while the finalise is still running.
function Harness({ mounted }: { mounted: boolean }) {
  return mounted ? <Recorder /> : <span data-testid="gone">left the note</span>
}

beforeEach(() => {
  resolveFinish = undefined
  emitLive = undefined
  throwOnDiscard = false
  committed.length = 0
  localStorage.setItem('note-taker-transcription-mode', 'local')
  stubBrowserApis()
  stubDesktopLocal()
  const record = async ({ request }: { request: Request }) => {
    const body = (await request.json()) as { transcriptText: string }
    committed.push(body.transcriptText)
    return new HttpResponse(null, { status: 204 })
  }
  // Un-prefixed only. This spec renders a bare subtree with no WorkspaceProvider, so
  // `getWorkspaceId()` is "" and `scopedPath` leaves the path alone — a `/w/:wsId` handler would be
  // dead here. Review disproved an earlier comment claiming otherwise. It does mean this spec never
  // exercises the prefixed shape production uses; the cross-workspace case is pinned server-side in
  // `TranscriptionCrossWorkspaceTests`.
  server.use(http.post('/api/notes/:noteId/transcription', record))
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

  // Review: the test above unmounts from 'recording', so the flag was never set and a STRANDED
  // flag would not fail it. This one completes a whole stop sequence first, so the unmount depends
  // on the flag having been cleared.
  it('commits on unmount after a completed finalise, so the flag does not strand', async () => {
    const { rerender } = render(<Harness mounted />)

    await userEvent.click(screen.getByTestId('start'))
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('recording'))
    await waitFor(() => expect(emitLive).toBeDefined())
    emitLive?.('first recording text')

    await userEvent.click(screen.getByTestId('stop'))
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('finalising'))
    resolveFinish?.('first finalised text')
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('stopped'))
    await waitFor(() => expect(committed).toHaveLength(1))

    // A second recording in the same mount, left without stopping.
    await userEvent.click(screen.getByTestId('start'))
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('recording'))
    await waitFor(() => expect(emitLive).toBeDefined())
    emitLive?.('second recording text')

    rerender(<Harness mounted={false} />)
    await screen.findByTestId('gone')

    await waitFor(() => expect(committed).toHaveLength(2))
    expect(committed[1]).toContain('second recording text')
  })

  // Review: skipping the commit made the stop sequence the SOLE owner of it, and the sequence has
  // ways to never reach one — a throw outside its inner try, or the BUG-56 hang. Losing the
  // transcript outright is worse than the bug being fixed, so the unmount CHAINS: it waits for the
  // sequence and then commits, which is a no-op on the happy path (commitTranscript is one-shot)
  // and the pre-BUG-72 fallback on the failing one.
  it('falls back to the live text when the finalise fails outright', async () => {
    throwOnDiscard = true
    const { rerender } = render(<Harness mounted />)

    await userEvent.click(screen.getByTestId('start'))
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('recording'))
    await waitFor(() => expect(emitLive).toBeDefined())
    emitLive?.('the only text there will ever be')

    await userEvent.click(screen.getByTestId('stop'))
    rerender(<Harness mounted={false} />)
    await screen.findByTestId('gone')
    resolveFinish?.(null)

    await waitFor(() => expect(committed).toHaveLength(1))
    expect(committed[0]).toContain('the only text there will ever be')
  })
})
