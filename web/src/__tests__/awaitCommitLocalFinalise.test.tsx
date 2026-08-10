import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { useRef, useState } from 'react'
import { useTranscription } from '../hooks/useTranscription'
import { server } from '../test/setup'

// BUG-55, the half that SignOutTranscriptCommit.test.tsx cannot reach. That spec mocks
// `useTranscription` wholesale, so it pins the wiring and nothing else — every one of the three
// lines that actually constitute the fix could be reverted with the suite green:
//
//   - `stopSequenceRef.current = (async () => …)` back to `void (async () => …)`
//   - `commitPostRef.current = completeTranscription(…)` back to `void completeTranscription(…)`
//   - hoisting `commitPostRef.current` above the first await (it must be read AFTER the stop
//     sequence resolves, because the POST is fired from inside it)
//
// So this drives the REAL hook through a real local-mode stop, with `finish()` deferred the way the
// on-device small.en pass is in production.

let resolveFinish: ((text: string | null) => void) | undefined
let completePosts = 0
// When set, the commit POST hangs until called — needed to pin the SECOND await separately from
// the first, since a fast POST resolves before anything can observe it.
let holdCompletePost: (() => void) | undefined

function stubBrowserApis() {
  const mockStream = { getTracks: () => [{ stop: vi.fn() }] } as unknown as MediaStream
  const mockWorkletNode = { connect: vi.fn(), port: { onmessage: null } }
  const mockAudioContext = {
    sampleRate: 16000,
    createMediaStreamSource: vi.fn().mockReturnValue({ connect: vi.fn() }),
    createGain: vi.fn().mockReturnValue({ connect: vi.fn() }),
    audioWorklet: { addModule: vi.fn().mockResolvedValue(undefined) },
    destination: {},
    close: vi.fn().mockResolvedValue(undefined),
  }
  Object.defineProperty(global.navigator, 'mediaDevices', {
    value: { getUserMedia: vi.fn().mockResolvedValue(mockStream), getDisplayMedia: vi.fn() },
    configurable: true,
  })
  vi.stubGlobal('AudioContext', vi.fn().mockImplementation(function () { return mockAudioContext }))
  vi.stubGlobal('AudioWorkletNode', vi.fn().mockImplementation(function () { return mockWorkletNode }))
}

// `onLive` is captured so the test can feed the hook some live text — without it
// `commitTranscript` early-returns on an empty transcript and never assigns commitPostRef, which
// is precisely the state BUG-56 reports on Windows.
let emitLive: ((text: string) => void) | undefined

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
      // Deferred exactly like the real small.en pass: minutes in production.
      finish: () => new Promise<string | null>((resolve) => { resolveFinish = resolve }),
      discard: () => {},
    },
  }
}

function Harness() {
  const transcription = useTranscription('note-1')
  const [awaited, setAwaited] = useState(false)
  const started = useRef(false)
  return (
    <>
      <button
        data-testid="start"
        onClick={() => {
          started.current = true
          transcription.startRecording(false, false)
        }}
      >
        start
      </button>
      <button data-testid="stop" onClick={() => transcription.stopRecording()}>
        stop
      </button>
      <button
        data-testid="await"
        onClick={() => void transcription.awaitCommit().then(() => setAwaited(true))}
      >
        await
      </button>
      <span data-testid="status">{transcription.status}</span>
      <span data-testid="awaited">{awaited ? 'resolved' : 'pending'}</span>
    </>
  )
}

beforeEach(() => {
  resolveFinish = undefined
  emitLive = undefined
  completePosts = 0
  holdCompletePost = undefined
  localStorage.setItem('note-taker-transcription-mode', 'local')
  stubBrowserApis()
  stubDesktopLocal()
  // Both shapes: `scoped()` in test/handlers.ts registers the un-prefixed and the `/w/:wsId`
  // prefixed path, and a request matching only the default handler would leave the counter at 0
  // while the POST quietly succeeded.
  const countComplete = async () => {
    completePosts += 1
    if (holdCompletePost === undefined) return new HttpResponse(null, { status: 204 })
    await new Promise<void>((resolve) => { holdCompletePost = resolve })
    return new HttpResponse(null, { status: 204 })
  }
  server.use(
    http.post('/api/notes/:noteId/transcription', countComplete),
    http.post('/api/w/:wsId/notes/:noteId/transcription', countComplete),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete (window as unknown as { desktop?: unknown }).desktop
})

describe('awaitCommit against a real local finalise (BUG-55)', () => {
  it('does not resolve until the on-device finalise AND the commit POST have landed', async () => {
    render(<Harness />)

    await userEvent.click(screen.getByTestId('start'))
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('recording'))
    // Live text, so commitTranscript has something to send.
    await waitFor(() => expect(emitLive).toBeDefined())
    emitLive?.('some words from the meeting')

    await userEvent.click(screen.getByTestId('stop'))
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('finalising'))

    await userEvent.click(screen.getByTestId('await'))

    // The finalise is still running: awaitCommit must be parked, and nothing committed yet.
    expect(screen.getByTestId('awaited')).toHaveTextContent('pending')
    expect(completePosts).toBe(0)

    resolveFinish?.('the higher quality small.en transcript')

    await waitFor(() => expect(screen.getByTestId('awaited')).toHaveTextContent('resolved'))
    expect(completePosts).toBe(1)
  })

  // The critical path review found: `handleConfirmedLeave` calls stopRecording() unconditionally
  // and `isRecording` includes 'finalising', so pressing Stop and THEN signing out called it twice.
  // The second call used to reassign stopSequenceRef to a fresh cloud-branch IIFE that resolved
  // immediately — so awaitCommit awaited the wrong promise and signed out mid-finalise.
  it('a second stopRecording does not replace the in-flight finalise', async () => {
    holdCompletePost = () => {}
    render(<Harness />)

    await userEvent.click(screen.getByTestId('start'))
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('recording'))
    await waitFor(() => expect(emitLive).toBeDefined())
    emitLive?.('some words from the meeting')

    await userEvent.click(screen.getByTestId('stop'))
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('finalising'))

    // The sign-out path stops again before awaiting.
    await userEvent.click(screen.getByTestId('stop'))
    await userEvent.click(screen.getByTestId('await'))

    // Assert the DIRECT observation, not a race: while the finalise is still parked nothing can
    // have committed. Without the idempotency guard the second stop takes the cloud branch and
    // fires one immediately. (Relying on `awaited` staying 'pending' would only be red because msw
    // happens to answer inside userEvent's macrotask yield — the fragility test 3 exists for.)
    expect(completePosts).toBe(0)
    expect(screen.getByTestId('awaited')).toHaveTextContent('pending')

    resolveFinish?.('the higher quality small.en transcript')
    await waitFor(() => expect(completePosts).toBe(1))
    holdCompletePost?.()

    await waitFor(() => expect(screen.getByTestId('awaited')).toHaveTextContent('resolved'))
  })

  // Probe of the fix's other half: with `commitPostRef` reverted to fire-and-forget, the two tests
  // above stay GREEN, because by the time the stop sequence resolves the POST has already been
  // issued and msw answers it before anything can observe the difference. Holding the POST open is
  // what separates the second await from the first.
  it('waits for the commit POST itself, not just the finalise', async () => {
    holdCompletePost = () => {}
    render(<Harness />)

    await userEvent.click(screen.getByTestId('start'))
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('recording'))
    await waitFor(() => expect(emitLive).toBeDefined())
    emitLive?.('some words from the meeting')

    await userEvent.click(screen.getByTestId('stop'))
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('finalising'))
    await userEvent.click(screen.getByTestId('await'))

    // The on-device pass is done, so the first await is satisfied...
    resolveFinish?.('the higher quality small.en transcript')
    await waitFor(() => expect(completePosts).toBe(1))

    // ...but the POST is still in flight, and signing out now would 401 it. Must still be parked.
    expect(screen.getByTestId('awaited')).toHaveTextContent('pending')

    holdCompletePost?.()

    await waitFor(() => expect(screen.getByTestId('awaited')).toHaveTextContent('resolved'))
  })
})
