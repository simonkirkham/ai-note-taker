import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import RecordControl from '../components/RecordControl'
import { server } from '../test/setup'

// ── Transcribe SDK mock ───────────────────────────────────────────
let emitTranscriptResult: (text: string) => void = () => {}

vi.mock('@aws-sdk/client-transcribe-streaming', () => {
  return {
    TranscribeStreamingClient: vi.fn().mockImplementation(() => ({
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
                    Results: [{ IsPartial: false, Alternatives: [{ Transcript: text }] }],
                  },
                },
              }
            }
          }
        }

        return { TranscriptResultStream: stream() }
      }),
    })),
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

  vi.stubGlobal('AudioContext', vi.fn().mockImplementation(() => mockAudioContext))
  vi.stubGlobal('AudioWorkletNode', vi.fn().mockImplementation(() => mockWorkletNode))

  return { mockAudioContext, getUserMedia, getDisplayMedia }
}

const noop = () => {}

function renderControl(
  props: Partial<React.ComponentProps<typeof RecordControl>> = {},
) {
  return render(
    <RecordControl
      noteId="note-1"
      onTranscriptChange={props.onTranscriptChange ?? noop}
      onStatusChange={props.onStatusChange ?? noop}
      {...props}
    />,
  )
}

beforeEach(() => {
  emitTranscriptResult = () => {}
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ── Tests ─────────────────────────────────────────────────────────

it('shows a Record button on mount and no Stop button', () => {
  renderControl()
  expect(screen.getByTestId('transcription-record-button')).toBeInTheDocument()
  expect(screen.queryByTestId('transcription-stop-button')).toBeNull()
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
  await userEvent.click(screen.getByTestId('transcription-record-button'))

  await waitFor(() => expect(credentialsCalled).toBe(true))
  await waitFor(() => expect(screen.getByTestId('transcription-stop-button')).toBeInTheDocument())
  expect(screen.getByTestId('transcription-timer')).toBeInTheDocument()
  expect(screen.queryByTestId('transcription-record-button')).toBeNull()
})

it('reports live transcript text upward as results arrive', async () => {
  stubBrowserApis()
  const onTranscriptChange = vi.fn()
  renderControl({ onTranscriptChange })

  await userEvent.click(screen.getByTestId('transcription-record-button'))
  await waitFor(() => expect(screen.getByTestId('transcription-stop-button')).toBeInTheDocument())

  emitTranscriptResult('Hello world')
  await waitFor(() => expect(onTranscriptChange).toHaveBeenCalledWith('Hello world'))
})

it('clicking Stop transitions back to idle (Record visible again)', async () => {
  stubBrowserApis()
  renderControl()
  await userEvent.click(screen.getByTestId('transcription-record-button'))
  await waitFor(() => expect(screen.getByTestId('transcription-stop-button')).toBeInTheDocument())

  await userEvent.click(screen.getByTestId('transcription-stop-button'))
  await waitFor(() => expect(screen.getByTestId('transcription-record-button')).toBeInTheDocument())
  expect(screen.queryByTestId('transcription-timer')).toBeNull()
})

it('shows error state when credentials fetch fails', async () => {
  stubBrowserApis()
  server.use(
    http.get('/api/transcription/credentials', () => new HttpResponse(null, { status: 401 })),
  )

  renderControl()
  await userEvent.click(screen.getByTestId('transcription-record-button'))

  await waitFor(() => expect(screen.getByTestId('transcription-error')).toBeInTheDocument())
  expect(screen.getByTestId('transcription-reset-button')).toBeInTheDocument()
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
  await userEvent.click(screen.getByTestId('transcription-record-button'))
  await waitFor(() => expect(screen.getByTestId('transcription-stop-button')).toBeInTheDocument())

  emitTranscriptResult('Test transcript')
  await userEvent.click(screen.getByTestId('transcription-stop-button'))

  await waitFor(() => expect(completionBody).toMatchObject({ transcriptText: 'Test transcript' }))
})

it('shows the Analyse note button enabled when the note has content and is idle', () => {
  renderControl({ noteHasContent: true })
  expect(screen.getByTestId('transcription-analyse-button')).toHaveTextContent('Analyse note')
  expect(screen.getByTestId('transcription-analyse-button')).toBeEnabled()
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
  const btn = screen.getByTestId('transcription-analyse-button')
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

  await userEvent.click(screen.getByTestId('transcription-analyse-button'))

  await waitFor(() => expect(analyseCalled).toBe(true))
  await waitFor(() => expect(onAnalysisComplete).toHaveBeenCalled())
})

it('captures system audio via getDisplayMedia when the call-audio toggle is on', async () => {
  const { getDisplayMedia, mockAudioContext } = stubBrowserApis()

  renderControl()
  expect(screen.getByTestId('transcription-call-audio-toggle')).toBeChecked()
  await userEvent.click(screen.getByTestId('transcription-record-button'))

  await waitFor(() => expect(screen.getByTestId('transcription-stop-button')).toBeInTheDocument())
  expect(getDisplayMedia).toHaveBeenCalledWith({ audio: true, video: true })
  await waitFor(() => expect(mockAudioContext.createMediaStreamSource).toHaveBeenCalledTimes(2))
  expect(mockAudioContext.createGain).toHaveBeenCalled()
})

it('does not call getDisplayMedia when the call-audio toggle is off', async () => {
  const { getDisplayMedia, mockAudioContext } = stubBrowserApis()

  renderControl()
  await userEvent.click(screen.getByTestId('transcription-call-audio-toggle'))
  await userEvent.click(screen.getByTestId('transcription-record-button'))

  await waitFor(() => expect(screen.getByTestId('transcription-stop-button')).toBeInTheDocument())
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
  expect(screen.getByTestId('transcription-auto-analyse-toggle')).toBeChecked()

  await userEvent.click(screen.getByTestId('transcription-record-button'))
  await waitFor(() => expect(screen.getByTestId('transcription-stop-button')).toBeInTheDocument())
  emitTranscriptResult('Meeting transcript')
  await userEvent.click(screen.getByTestId('transcription-stop-button'))

  await waitFor(() => expect(analyseCalled).toBe(true))
  await waitFor(() => expect(screen.getByTestId('transcription-analyse-button')).toHaveTextContent('Analysing…'))
  expect(screen.getByTestId('transcription-analyse-button')).toBeDisabled()

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
  await userEvent.click(screen.getByTestId('transcription-auto-analyse-toggle'))
  expect(screen.getByTestId('transcription-auto-analyse-toggle')).not.toBeChecked()

  await userEvent.click(screen.getByTestId('transcription-record-button'))
  await waitFor(() => expect(screen.getByTestId('transcription-stop-button')).toBeInTheDocument())
  emitTranscriptResult('Meeting transcript')
  await userEvent.click(screen.getByTestId('transcription-stop-button'))

  await waitFor(() => expect(completionCalled).toBe(true))
  expect(analyseCalled).toBe(false)
  expect(screen.getByTestId('transcription-analyse-button')).toBeInTheDocument()
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
  await userEvent.click(screen.getByTestId('transcription-record-button'))
  await waitFor(() => expect(screen.getByTestId('transcription-stop-button')).toBeInTheDocument())
  await userEvent.click(screen.getByTestId('transcription-stop-button'))

  await waitFor(() => expect(screen.getByTestId('transcription-record-button')).toBeInTheDocument())
  expect(analyseCalled).toBe(false)
})

it('auto-analyse switch defaults back to ON on a fresh mount', async () => {
  const first = renderControl()
  await userEvent.click(screen.getByTestId('transcription-auto-analyse-toggle'))
  expect(screen.getByTestId('transcription-auto-analyse-toggle')).not.toBeChecked()
  first.unmount()

  renderControl()
  expect(screen.getByTestId('transcription-auto-analyse-toggle')).toBeChecked()
})
