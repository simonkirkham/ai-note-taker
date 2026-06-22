import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import RecordControl from '../components/RecordControl'
import { CHECKPOINT_INTERVAL_MS, useTranscription } from '../hooks/useTranscription'
import { server } from '../test/setup'

// ── Transcribe SDK mock ───────────────────────────────────────────
let emitTranscriptResult: (text: string) => void = () => {}

vi.mock('@aws-sdk/client-transcribe-streaming', () => {
  return {
    TranscribeStreamingClient: vi.fn().mockImplementation(function () { return ({
      send: vi.fn().mockImplementation(async () => {
        const resultQueue: string[] = []
        let wakeup: (() => void) | null = null

        const _emitResult = (text: string) => {
          resultQueue.push(text)
          wakeup?.()
          wakeup = null
        }

        emitTranscriptResult = _emitResult

        async function* stream() {
          for (;;) {
            if (resultQueue.length === 0) {
              await new Promise<void>((r) => { wakeup = r })
            }
            while (resultQueue.length > 0) {
              const text = resultQueue.shift()!
              yield {
                TranscriptEvent: {
                  Transcript: {
                    // ShowSpeakerLabel is on: finalised results carry per-item speakers,
                    // and the finalised transcript is assembled from Items (one speaker here).
                    Results: [
                      {
                        IsPartial: false,
                        Alternatives: [
                          {
                            Transcript: text,
                            Items: [{ Content: text, Speaker: '0', Type: 'pronunciation' }],
                          },
                        ],
                      },
                    ],
                  },
                },
              }
            }
          }
        }

        return { TranscriptResultStream: stream() }
      }),
    }) }),
    StartStreamTranscriptionCommand: vi.fn(),
  }
})

// ── Browser API stubs ─────────────────────────────────────────────
function stubBrowserApis() {
  const mockStream = { getTracks: () => [{ stop: vi.fn() }] } as unknown as MediaStream
  const mockDisplayStream = {
    getTracks: () => [{ stop: vi.fn() }],
    getAudioTracks: () => [{ stop: vi.fn() }],
  } as unknown as MediaStream

  const mockWorkletNode = {
    connect: vi.fn(),
    port: { onmessage: null as ((e: MessageEvent) => void) | null },
  }
  const mockSource = { connect: vi.fn() }
  const mockGain = { connect: vi.fn() }
  const mockAudioContext = {
    sampleRate: 16000,
    createMediaStreamSource: vi.fn().mockReturnValue(mockSource),
    createGain: vi.fn().mockReturnValue(mockGain),
    audioWorklet: { addModule: vi.fn().mockResolvedValue(undefined) },
    destination: {},
    close: vi.fn().mockResolvedValue(undefined),
  }

  const getUserMedia = vi.fn().mockResolvedValue(mockStream)
  const getDisplayMedia = vi.fn().mockResolvedValue(mockDisplayStream)

  Object.defineProperty(global.navigator, 'mediaDevices', {
    value: { getUserMedia, getDisplayMedia },
    configurable: true,
  })

  // Vitest 4 invokes mocks via `new` (the app does `new AudioContext()` /
  // `new AudioWorkletNode()`); arrow impls aren't constructable, so use `function`.
  vi.stubGlobal('AudioContext', vi.fn().mockImplementation(function () { return mockAudioContext }))
  vi.stubGlobal('AudioWorkletNode', vi.fn().mockImplementation(function () { return mockWorkletNode }))

  return { mockAudioContext, getUserMedia, getDisplayMedia }
}

// Capture the pristine native setInterval once, before any test installs a spy. Tests that
// mock setInterval delegate pass-through intervals to this ref; capturing it after a spy is
// installed (global.setInterval.bind inside an it-block) would bind the spy itself, so the
// mock's pass-through recurses infinitely under Vitest 4 (Maximum call stack size exceeded).
const nativeSetInterval = globalThis.setInterval

// RecordControl is now a CONTROLLED component (19-E2): the streaming hook lives in
// the parent and is passed in as the `transcription` prop. This harness owns the
// real `useTranscription` so the SDK-mock-driven behavioural tests still exercise
// the genuine streaming path, and mirrors the hook's live transcript into the DOM
// (gated exactly like the parent's status-gate) so a test can assert what the
// parent would surface — replacing the old upward-callback spy.
function Harness(props: Omit<React.ComponentProps<typeof RecordControl>, 'transcription'>) {
  const transcription = useTranscription(props.noteId)
  const gated =
    transcription.status === 'requestingCredentials' ||
    transcription.status === 'recording' ||
    transcription.status === 'stopped'
  return (
    <>
      <RecordControl {...props} transcription={transcription} />
      <div data-testid="harness-live-transcript">{gated ? transcription.transcript : ''}</div>
    </>
  )
}

function renderControl(
  props: Partial<Omit<React.ComponentProps<typeof RecordControl>, 'transcription'>> = {},
) {
  return render(<Harness noteId="note-1" {...props} />)
}

function liveTranscript() {
  return screen.getByTestId('harness-live-transcript').textContent
}

beforeEach(() => {
  emitTranscriptResult = () => {}
})

afterEach(() => {
  vi.unstubAllGlobals()
  // Restore any global spy (e.g. setInterval) left by a test that threw before its own
  // mockRestore(), else it leaks and recurses under Vitest 4.
  vi.restoreAllMocks()
})

// ── Tests ─────────────────────────────────────────────────────────

it('shows a Record button on mount and no Stop button', () => {
  renderControl()
  expect(screen.getByRole('button', { name: 'Record' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull()
})

it('clicking Record fetches credentials and shows recording state', async () => {
  stubBrowserApis()
  let credentialsCalled = false
  server.use(
    http.get('/api/transcription/credentials', () => {
      credentialsCalled = true
      return HttpResponse.json({
        accessKeyId: 'ASIATEST',
        secretAccessKey: 'fakesecret',
        sessionToken: 'faketoken',
        expiration: '2099-01-01T00:00:00Z',
        region: 'eu-west-1',
      })
    }),
  )

  renderControl()
  await userEvent.click(screen.getByRole('button', { name: 'Record' }))

  await waitFor(() => expect(credentialsCalled).toBe(true))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument())
  expect(screen.getByTestId('transcription-timer')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Record' })).toBeNull()
})

it('surfaces live transcript text as results arrive', async () => {
  stubBrowserApis()
  renderControl()

  await userEvent.click(screen.getByRole('button', { name: 'Record' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument())

  emitTranscriptResult('Hello world')
  await waitFor(() => expect(liveTranscript()).toBe('Speaker 1: Hello world'))
})

it('clicking Stop transitions back to idle (Record visible again)', async () => {
  stubBrowserApis()
  renderControl()
  await userEvent.click(screen.getByRole('button', { name: 'Record' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument())

  await userEvent.click(screen.getByRole('button', { name: 'Stop' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Record' })).toBeInTheDocument())
  expect(screen.queryByTestId('transcription-timer')).toBeNull()
})

it('shows error state when credentials fetch fails', async () => {
  stubBrowserApis()
  server.use(
    http.get('/api/transcription/credentials', () => new HttpResponse(null, { status: 401 })),
  )

  renderControl()
  await userEvent.click(screen.getByRole('button', { name: 'Record' }))

  await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
  expect(screen.getByRole('button', { name: 'Reset' })).toBeInTheDocument()
})

it('clicking Stop calls completeTranscription with transcript text', async () => {
  stubBrowserApis()
  let completionBody: unknown = null
  server.use(
    http.post('/api/notes/note-1/transcription', async ({ request }) => {
      completionBody = await request.json()
      return new HttpResponse(null, { status: 204 })
    }),
  )

  renderControl()
  await userEvent.click(screen.getByRole('button', { name: 'Record' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument())

  emitTranscriptResult('Test transcript')
  await userEvent.click(screen.getByRole('button', { name: 'Stop' }))

  await waitFor(() => expect(completionBody).toMatchObject({ transcriptText: 'Speaker 1: Test transcript' }))
})

it('persists the in-progress transcript when unmounted mid-recording (navigating back)', async () => {
  stubBrowserApis()
  let completionBody: unknown = null
  server.use(
    http.post('/api/notes/note-1/transcription', async ({ request }) => {
      completionBody = await request.json()
      return new HttpResponse(null, { status: 204 })
    }),
  )

  const view = renderControl()
  await userEvent.click(screen.getByRole('button', { name: 'Record' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument())

  emitTranscriptResult('Half a meeting')
  await waitFor(() => expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument())

  // Unmount while still recording — equivalent to pressing back mid-call.
  view.unmount()

  await waitFor(() =>
    expect(completionBody).toMatchObject({ transcriptText: 'Speaker 1: Half a meeting' }),
  )
})

it('uses keepalive for the commit fired on unmount so a true page teardown does not abort it (BUG-34)', async () => {
  stubBrowserApis()
  let keepaliveOnCommit: boolean | null = null
  server.use(
    http.post('/api/notes/note-1/transcription', ({ request }) => {
      keepaliveOnCommit = request.keepalive
      return new HttpResponse(null, { status: 204 })
    }),
  )

  const view = renderControl()
  await userEvent.click(screen.getByRole('button', { name: 'Record' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument())
  emitTranscriptResult('Half a meeting')
  await waitFor(() => expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument())

  view.unmount()

  await waitFor(() => expect(keepaliveOnCommit).toBe(true))
})

it('does NOT use keepalive for a normal Stop (the page is staying)', async () => {
  stubBrowserApis()
  let keepaliveOnCommit: boolean | null = null
  server.use(
    http.post('/api/notes/note-1/transcription', ({ request }) => {
      keepaliveOnCommit = request.keepalive
      return new HttpResponse(null, { status: 204 })
    }),
  )

  renderControl()
  await userEvent.click(screen.getByRole('button', { name: 'Record' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument())
  emitTranscriptResult('Whole meeting')
  await userEvent.click(screen.getByRole('button', { name: 'Stop' }))

  await waitFor(() => expect(keepaliveOnCommit).toBe(false))
})

it('autosaves the transcript to the draft on the periodic checkpoint while still recording', async () => {
  stubBrowserApis()
  // Capture the checkpoint interval's callback so we can fire it deterministically
  // without waiting wall-clock time; pass every other interval through unchanged.
  let checkpointCb: (() => void) | null = null
  const intervalSpy = vi.spyOn(global, 'setInterval').mockImplementation((function (cb: () => void, ms?: number, ...rest: unknown[]) {
    if (ms === CHECKPOINT_INTERVAL_MS) checkpointCb = cb
    return nativeSetInterval(cb, ms, ...rest)
  }) as unknown as typeof setInterval)

  let draftBody: unknown = null
  let committed = false
  server.use(
    http.put('/api/notes/note-1/transcription/draft', async ({ request }) => {
      draftBody = await request.json()
      return new HttpResponse(null, { status: 204 })
    }),
    http.post('/api/notes/note-1/transcription', () => { committed = true; return new HttpResponse(null, { status: 204 }) }),
  )

  renderControl()
  await userEvent.click(screen.getByRole('button', { name: 'Record' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument())
  await waitFor(() => expect(checkpointCb).not.toBeNull())

  emitTranscriptResult('Captured so far')
  await waitFor(() => expect(liveTranscript()).toBe('Speaker 1: Captured so far'))

  // Fire the checkpoint mid-recording — no Stop pressed.
  act(() => { checkpointCb!() })

  // It PUTs the draft (no event); the committing POST must NOT fire mid-recording.
  await waitFor(() => expect(draftBody).toMatchObject({ transcriptText: 'Speaker 1: Captured so far' }))
  expect(committed).toBe(false)
  expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument()
  intervalSpy.mockRestore()
})

it('checkpoint does not re-PUT the draft when the transcript has not changed', async () => {
  stubBrowserApis()
  let checkpointCb: (() => void) | null = null
  const intervalSpy = vi.spyOn(global, 'setInterval').mockImplementation((function (cb: () => void, ms?: number, ...rest: unknown[]) {
    if (ms === CHECKPOINT_INTERVAL_MS) checkpointCb = cb
    return nativeSetInterval(cb, ms, ...rest)
  }) as unknown as typeof setInterval)

  let completionCalls = 0
  server.use(
    http.put('/api/notes/note-1/transcription/draft', () => {
      completionCalls += 1
      return new HttpResponse(null, { status: 204 })
    }),
    // unmount on test teardown commits via POST — handle it so it isn't an unhandled request
    http.post('/api/notes/note-1/transcription', () => new HttpResponse(null, { status: 204 })),
  )

  renderControl()
  await userEvent.click(screen.getByRole('button', { name: 'Record' }))
  await waitFor(() => expect(checkpointCb).not.toBeNull())

  emitTranscriptResult('Same text')
  await waitFor(() => expect(liveTranscript()).toBe('Speaker 1: Same text'))

  act(() => { checkpointCb!() })
  await waitFor(() => expect(completionCalls).toBe(1))
  // No new finalised text — the next checkpoint must be a no-op.
  act(() => { checkpointCb!() })
  await new Promise((r) => setTimeout(r, 0))
  expect(completionCalls).toBe(1)
  intervalSpy.mockRestore()
})

it('registers a beforeunload warning while recording and removes it after stop', async () => {
  stubBrowserApis()
  const addSpy = vi.spyOn(window, 'addEventListener')
  const removeSpy = vi.spyOn(window, 'removeEventListener')

  renderControl()
  await userEvent.click(screen.getByRole('button', { name: 'Record' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument())
  expect(addSpy).toHaveBeenCalledWith('beforeunload', expect.any(Function))

  await userEvent.click(screen.getByRole('button', { name: 'Stop' }))
  await waitFor(() =>
    expect(removeSpy).toHaveBeenCalledWith('beforeunload', expect.any(Function)),
  )
  addSpy.mockRestore()
  removeSpy.mockRestore()
})

it('does not double-persist when Stop is pressed then the control unmounts', async () => {
  stubBrowserApis()
  let completionCalls = 0
  server.use(
    http.post('/api/notes/note-1/transcription', () => {
      completionCalls += 1
      return new HttpResponse(null, { status: 204 })
    }),
  )

  const view = renderControl()
  await userEvent.click(screen.getByRole('button', { name: 'Record' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument())

  emitTranscriptResult('Whole meeting')
  await userEvent.click(screen.getByRole('button', { name: 'Stop' }))
  await waitFor(() => expect(completionCalls).toBe(1))

  view.unmount()
  // Give any erroneous unmount-flush a chance to fire.
  await new Promise((r) => setTimeout(r, 0))
  expect(completionCalls).toBe(1)
})

it('shows the Analyse note button enabled when the note has content and is idle', () => {
  renderControl({ noteHasContent: true })
  expect(screen.getByRole('button', { name: 'Analyse note' })).toHaveTextContent('Analyse note')
  expect(screen.getByRole('button', { name: 'Analyse note' })).toBeEnabled()
})

it('does not render an Update note content toggle', () => {
  renderControl({ noteHasContent: true })
  expect(screen.queryByTestId('transcription-update-content-toggle')).toBeNull()
  expect(screen.queryByText(/update note content/i)).toBeNull()
})

it('does not render an Export control', () => {
  renderControl({ noteHasContent: true })
  expect(screen.queryByText(/export/i)).toBeNull()
})

it('shows the Analyse note button disabled when there is nothing to analyse', () => {
  renderControl()
  const btn = screen.getByRole('button', { name: 'Analyse note' })
  expect(btn).toBeInTheDocument()
  expect(btn).toBeDisabled()
  expect(btn).toHaveAttribute('title')
})

it('clicking Analyse note POSTs to /analyse and triggers a refresh', async () => {
  let analyseCalled = false
  server.use(
    http.post('/api/notes/note-1/analyse', () => {
      analyseCalled = true
      return new HttpResponse(null, { status: 204 })
    }),
  )
  const onAnalysisComplete = vi.fn()
  renderControl({ noteHasContent: true, onAnalysisComplete })

  await userEvent.click(screen.getByRole('button', { name: 'Analyse note' }))

  await waitFor(() => expect(analyseCalled).toBe(true))
  await waitFor(() => expect(onAnalysisComplete).toHaveBeenCalled())
})

it('captures system audio via getDisplayMedia when the call-audio toggle is on', async () => {
  const { getDisplayMedia, mockAudioContext } = stubBrowserApis()

  renderControl()
  expect(screen.getByRole('checkbox', { name: /record screen-share audio/i })).toBeChecked()
  await userEvent.click(screen.getByRole('button', { name: 'Record' }))

  await waitFor(() => expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument())
  expect(getDisplayMedia).toHaveBeenCalledWith({ audio: true, video: true })
  await waitFor(() => expect(mockAudioContext.createMediaStreamSource).toHaveBeenCalledTimes(2))
  expect(mockAudioContext.createGain).toHaveBeenCalled()
})

it('labels the audio-capture toggle "Record screen-share audio"', () => {
  stubBrowserApis()

  renderControl()

  expect(screen.getByText('Record screen-share audio')).toBeInTheDocument()
  expect(screen.queryByText('Call audio')).not.toBeInTheDocument()
})

it('does not call getDisplayMedia when the call-audio toggle is off', async () => {
  const { getDisplayMedia, mockAudioContext } = stubBrowserApis()

  renderControl()
  await userEvent.click(screen.getByRole('checkbox', { name: /record screen-share audio/i }))
  await userEvent.click(screen.getByRole('button', { name: 'Record' }))

  await waitFor(() => expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument())
  expect(getDisplayMedia).not.toHaveBeenCalled()
  expect(mockAudioContext.createMediaStreamSource).toHaveBeenCalledTimes(1)
})

it('auto-analyses on stop when the switch is on (default)', async () => {
  stubBrowserApis()
  let analyseCalled = false
  let resolveAnalyse: () => void = () => {}
  server.use(
    http.post('/api/notes/note-1/transcription', () => new HttpResponse(null, { status: 204 })),
    http.post('/api/notes/note-1/analyse', async () => {
      analyseCalled = true
      await new Promise<void>((r) => { resolveAnalyse = r })
      return new HttpResponse(null, { status: 204 })
    }),
  )

  renderControl()
  expect(screen.getByRole('checkbox', { name: /auto-analyse/i })).toBeChecked()

  await userEvent.click(screen.getByRole('button', { name: 'Record' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument())
  emitTranscriptResult('Meeting transcript')
  await userEvent.click(screen.getByRole('button', { name: 'Stop' }))

  await waitFor(() => expect(analyseCalled).toBe(true))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Analysing…' })).toHaveTextContent('Analysing…'))
  expect(screen.getByRole('button', { name: 'Analysing…' })).toBeDisabled()

  resolveAnalyse()
})

it('does not auto-analyse on stop when the switch is off', async () => {
  stubBrowserApis()
  let analyseCalled = false
  let completionCalled = false
  server.use(
    http.post('/api/notes/note-1/transcription', () => {
      completionCalled = true
      return new HttpResponse(null, { status: 204 })
    }),
    http.post('/api/notes/note-1/analyse', () => {
      analyseCalled = true
      return new HttpResponse(null, { status: 204 })
    }),
  )

  renderControl()
  await userEvent.click(screen.getByRole('checkbox', { name: /auto-analyse/i }))
  expect(screen.getByRole('checkbox', { name: /auto-analyse/i })).not.toBeChecked()

  await userEvent.click(screen.getByRole('button', { name: 'Record' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument())
  emitTranscriptResult('Meeting transcript')
  await userEvent.click(screen.getByRole('button', { name: 'Stop' }))

  await waitFor(() => expect(completionCalled).toBe(true))
  expect(analyseCalled).toBe(false)
  expect(screen.getByRole('button', { name: 'Analyse note' })).toBeInTheDocument()
})

it('does not auto-analyse on stop when the recording produced no transcript', async () => {
  stubBrowserApis()
  let analyseCalled = false
  server.use(
    http.post('/api/notes/note-1/analyse', () => {
      analyseCalled = true
      return new HttpResponse(null, { status: 204 })
    }),
  )

  renderControl()
  await userEvent.click(screen.getByRole('button', { name: 'Record' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument())
  await userEvent.click(screen.getByRole('button', { name: 'Stop' }))

  await waitFor(() => expect(screen.getByRole('button', { name: 'Record' })).toBeInTheDocument())
  expect(analyseCalled).toBe(false)
})

it('auto-analyse switch defaults back to ON on a fresh mount', async () => {
  const first = renderControl()
  await userEvent.click(screen.getByRole('checkbox', { name: /auto-analyse/i }))
  expect(screen.getByRole('checkbox', { name: /auto-analyse/i })).not.toBeChecked()
  first.unmount()

  renderControl()
  expect(screen.getByRole('checkbox', { name: /auto-analyse/i })).toBeChecked()
})

// ── 18-C: continue a transcript (record again & append) ───────────

it('Record on a note with no transcript starts immediately (no prompt)', async () => {
  stubBrowserApis()
  renderControl()
  await userEvent.click(screen.getByRole('button', { name: 'Record' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument())
  expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Re-record' })).toBeNull()
})

it('Record on a note with an existing transcript shows a Continue / Re-record prompt and does not start', async () => {
  stubBrowserApis()
  renderControl({ hasInitialTranscript: true, initialTranscript: 'Speaker 1: prior' })
  await userEvent.click(screen.getByRole('button', { name: 'Record' }))
  expect(screen.getByRole('button', { name: 'Continue' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Re-record' })).toBeInTheDocument()
  // Recording has NOT started — no stop button, and the Record button is hidden.
  expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Record' })).toBeNull()
})

it('Continue resumes seeded from the prior transcript (appends after the separator)', async () => {
  stubBrowserApis()
  server.use(
    http.put('/api/notes/note-1/transcription/draft', () => new HttpResponse(null, { status: 204 })),
    http.post('/api/notes/note-1/transcription', () => new HttpResponse(null, { status: 204 })),
  )
  renderControl({ hasInitialTranscript: true, initialTranscript: 'Speaker 1: prior' })

  await userEvent.click(screen.getByRole('button', { name: 'Record' }))
  await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument())

  emitTranscriptResult('new words')
  await waitFor(() =>
    expect(liveTranscript()).toBe('Speaker 1: prior\n— resumed —\nSpeaker 1: new words'),
  )
})

it('Re-record starts fresh and replaces (no prior text)', async () => {
  stubBrowserApis()
  server.use(
    http.post('/api/notes/note-1/transcription', () => new HttpResponse(null, { status: 204 })),
  )
  renderControl({ hasInitialTranscript: true, initialTranscript: 'Speaker 1: prior' })

  await userEvent.click(screen.getByRole('button', { name: 'Record' }))
  await userEvent.click(screen.getByRole('button', { name: 'Re-record' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument())

  emitTranscriptResult('new words')
  await waitFor(() => expect(liveTranscript()).toBe('Speaker 1: new words'))
  // The prior transcript and the resume separator must not appear — Re-record replaces.
  expect(liveTranscript()).not.toContain('prior')
  expect(liveTranscript()).not.toContain('— resumed —')
})
