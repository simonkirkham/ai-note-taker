import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '../test/setup'
import TranscriptionPanel from '../components/TranscriptionPanel'
import { TranscribeStreamingClient } from '@aws-sdk/client-transcribe-streaming'

// ── Transcribe SDK mock ───────────────────────────────────────────
// Each test gets a fresh deferred that controls when the transcript stream emits.
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
                    Results: [
                      { IsPartial: false, Alternatives: [{ Transcript: text }] },
                    ],
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
  const mockStream = {
    getTracks: () => [{ stop: vi.fn() }],
  } as unknown as MediaStream

  const mockWorkletNode = {
    connect: vi.fn(),
    port: { onmessage: null as ((e: MessageEvent) => void) | null },
  }

  const mockSource = { connect: vi.fn() }

  const mockAudioContext = {
    sampleRate: 16000,
    createMediaStreamSource: vi.fn().mockReturnValue(mockSource),
    audioWorklet: { addModule: vi.fn().mockResolvedValue(undefined) },
    destination: {},
    close: vi.fn().mockResolvedValue(undefined),
  }

  Object.defineProperty(global.navigator, 'mediaDevices', {
    value: { getUserMedia: vi.fn().mockResolvedValue(mockStream) },
    configurable: true,
  })

  vi.stubGlobal('AudioContext', vi.fn().mockImplementation(() => mockAudioContext))
  vi.stubGlobal('AudioWorkletNode', vi.fn().mockImplementation(() => mockWorkletNode))

  return { mockStream, mockWorkletNode, mockAudioContext }
}

beforeEach(() => {
  emitTranscriptResult = () => {}
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ── Tests ─────────────────────────────────────────────────────────

// Scenario: Idle state shows placeholder and Record button
it('shows idle placeholder and Record button on mount', () => {
  render(<TranscriptionPanel noteId="note-1" />)
  expect(screen.getByText('Press Record to start transcribing')).toBeInTheDocument()
  expect(screen.getByTestId('transcription-record-button')).toBeInTheDocument()
  expect(screen.queryByTestId('transcription-stop-button')).toBeNull()
})

// Scenario: Record button starts transcription
//   Given I am on the note screen
//   When I press the Record button
//   Then the GET /transcription/credentials endpoint is called
//   And the TranscriptionPanel shows a recording indicator and elapsed timer
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

  render(<TranscriptionPanel noteId="note-1" />)
  await userEvent.click(screen.getByTestId('transcription-record-button'))

  await waitFor(() => expect(credentialsCalled).toBe(true))
  await waitFor(() => expect(screen.getByTestId('transcription-stop-button')).toBeInTheDocument())
  expect(screen.getByTestId('transcription-timer')).toBeInTheDocument()
  expect(screen.queryByTestId('transcription-record-button')).toBeNull()
})

// Scenario: Spoken words appear in real time
//   Given I am recording
//   When Transcribe Streaming returns a transcript result
//   Then the text appears in the panel
//   And the panel scrolls to show the latest text
it('displays transcript text as results arrive', async () => {
  stubBrowserApis()

  render(<TranscriptionPanel noteId="note-1" />)
  await userEvent.click(screen.getByTestId('transcription-record-button'))
  await waitFor(() => expect(screen.getByTestId('transcription-stop-button')).toBeInTheDocument())

  emitTranscriptResult('Hello world')
  await waitFor(() => expect(screen.getByTestId('transcription-text')).toHaveTextContent('Hello world'))

  emitTranscriptResult('Second sentence')
  await waitFor(() =>
    expect(screen.getByTestId('transcription-text')).toHaveTextContent('Hello world Second sentence'),
  )
})

// Scenario: Stop button transitions to stopped state
it('clicking Stop transitions to stopped state', async () => {
  stubBrowserApis()

  render(<TranscriptionPanel noteId="note-1" />)
  await userEvent.click(screen.getByTestId('transcription-record-button'))
  await waitFor(() => expect(screen.getByTestId('transcription-stop-button')).toBeInTheDocument())

  await userEvent.click(screen.getByTestId('transcription-stop-button'))

  await waitFor(() => expect(screen.getByTestId('transcription-record-button')).toBeInTheDocument())
  expect(screen.queryByTestId('transcription-timer')).toBeNull()
})

// Scenario: Error state shown when credentials endpoint returns non-200
it('shows error state when credentials fetch fails', async () => {
  stubBrowserApis()
  server.use(
    http.get('/api/transcription/credentials', () => new HttpResponse(null, { status: 401 })),
  )

  render(<TranscriptionPanel noteId="note-1" />)
  await userEvent.click(screen.getByTestId('transcription-record-button'))

  await waitFor(() => expect(screen.getByTestId('transcription-error')).toBeInTheDocument())
  expect(screen.getByTestId('transcription-reset-button')).toBeInTheDocument()
})

// Scenario: Saved transcript shown on load
//   Given a note has a previously saved transcript
//   When the TranscriptionPanel mounts with initialTranscript
//   Then the saved transcript is displayed instead of the placeholder
it('shows saved transcript when initialTranscript is provided', () => {
  render(<TranscriptionPanel noteId="note-1" initialTranscript="Prior meeting notes here." />)
  expect(screen.getByTestId('transcription-text')).toHaveTextContent('Prior meeting notes here.')
  expect(screen.queryByText('Press Record to start transcribing')).toBeNull()
})

// Scenario: Stop button calls completeTranscription API
//   Given I am recording and have spoken some words
//   When I click Stop
//   Then POST /notes/{id}/transcription is called with the transcript text
it('clicking Stop calls completeTranscription with transcript text', async () => {
  stubBrowserApis()
  let completionBody: unknown = null
  server.use(
    http.post('/api/notes/note-1/transcription', async ({ request }) => {
      completionBody = await request.json()
      return new HttpResponse(null, { status: 204 })
    }),
  )

  render(<TranscriptionPanel noteId="note-1" />)
  await userEvent.click(screen.getByTestId('transcription-record-button'))
  await waitFor(() => expect(screen.getByTestId('transcription-stop-button')).toBeInTheDocument())

  emitTranscriptResult('Test transcript')
  await waitFor(() => expect(screen.getByTestId('transcription-text')).toHaveTextContent('Test transcript'))

  await userEvent.click(screen.getByTestId('transcription-stop-button'))

  await waitFor(() => expect(completionBody).toMatchObject({ transcriptText: 'Test transcript' }))
})

// Reset button returns to idle
it('Reset button returns to idle state', async () => {
  stubBrowserApis()
  server.use(
    http.get('/api/transcription/credentials', () => new HttpResponse(null, { status: 401 })),
  )

  render(<TranscriptionPanel noteId="note-1" />)
  await userEvent.click(screen.getByTestId('transcription-record-button'))
  await waitFor(() => expect(screen.getByTestId('transcription-reset-button')).toBeInTheDocument())

  await userEvent.click(screen.getByTestId('transcription-reset-button'))
  expect(screen.getByText('Press Record to start transcribing')).toBeInTheDocument()
})

// Scenario: Reset after recording with saved transcript shows placeholder, not stale text
it('shows placeholder after Reset even when initialTranscript is set', async () => {
  stubBrowserApis()
  server.use(
    http.get('/api/transcription/credentials', () => new HttpResponse(null, { status: 401 })),
  )

  render(<TranscriptionPanel noteId="note-1" initialTranscript="Old saved text" />)
  expect(screen.getByTestId('transcription-text')).toHaveTextContent('Old saved text')

  await userEvent.click(screen.getByTestId('transcription-record-button'))
  await waitFor(() => expect(screen.getByTestId('transcription-reset-button')).toBeInTheDocument())

  await userEvent.click(screen.getByTestId('transcription-reset-button'))
  expect(screen.getByText('Press Record to start transcribing')).toBeInTheDocument()
  expect(screen.queryByText('Old saved text')).toBeNull()
})

// Scenario: Natural end-of-stream also calls completeTranscription
it('calls completeTranscription when the stream ends naturally', async () => {
  stubBrowserApis()

  let completionBody: unknown = null
  server.use(
    http.post('/api/notes/note-1/transcription', async ({ request }) => {
      completionBody = await request.json()
      return new HttpResponse(null, { status: 204 })
    }),
  )

  vi.mocked(TranscribeStreamingClient).mockImplementationOnce(() => ({
    send: vi.fn().mockResolvedValue({
      TranscriptResultStream: (async function* () {
        yield {
          TranscriptEvent: {
            Transcript: {
              Results: [{ IsPartial: false, Alternatives: [{ Transcript: 'Natural end text' }] }],
            },
          },
        }
        // stream ends naturally here
      })(),
    }),
  }) as unknown as TranscribeStreamingClient)

  render(<TranscriptionPanel noteId="note-1" />)
  await userEvent.click(screen.getByTestId('transcription-record-button'))

  await waitFor(() => expect(completionBody).toMatchObject({ transcriptText: 'Natural end text' }), { timeout: 3000 })
})

// Scenario: Analyse note is enabled without a recording when the note has content (10-H)
it('shows the Analyse note button and switch enabled when the note has content and is idle', () => {
  render(<TranscriptionPanel noteId="note-1" noteHasContent />)
  expect(screen.getByTestId('transcription-analyse-button')).toHaveTextContent('Analyse note')
  expect(screen.getByTestId('transcription-analyse-button')).toBeEnabled()
  expect(screen.getByTestId('transcription-update-content-toggle')).toBeInTheDocument()
})

// Scenario: Analyse note is visible but disabled when there is nothing to analyse (10-H2)
it('shows the Analyse note button visible but disabled when there is nothing to analyse', () => {
  render(<TranscriptionPanel noteId="note-1" />)
  const btn = screen.getByTestId('transcription-analyse-button')
  expect(btn).toBeInTheDocument()
  expect(btn).toBeDisabled()
  expect(btn).toHaveAttribute('title')
})

// Scenario: analysing with the switch off posts updateContent=false and refreshes (10-H)
it('clicking Analyse note posts updateContent=false by default', async () => {
  let analyseBody: unknown = null
  server.use(
    http.post('/api/notes/note-1/analyse', async ({ request }) => {
      analyseBody = await request.json()
      return new HttpResponse(null, { status: 204 })
    }),
  )
  const onAnalysisComplete = vi.fn()
  render(<TranscriptionPanel noteId="note-1" noteHasContent onAnalysisComplete={onAnalysisComplete} />)

  await userEvent.click(screen.getByTestId('transcription-analyse-button'))

  await waitFor(() => expect(analyseBody).toEqual({ updateContent: false }))
  await waitFor(() => expect(onAnalysisComplete).toHaveBeenCalled())
})

// Scenario: enabling the switch posts updateContent=true (10-H)
it('enabling Update note content posts updateContent=true', async () => {
  let analyseBody: unknown = null
  server.use(
    http.post('/api/notes/note-1/analyse', async ({ request }) => {
      analyseBody = await request.json()
      return new HttpResponse(null, { status: 204 })
    }),
  )
  render(<TranscriptionPanel noteId="note-1" noteHasContent />)

  await userEvent.click(screen.getByTestId('transcription-update-content-toggle'))
  await userEvent.click(screen.getByTestId('transcription-analyse-button'))

  await waitFor(() => expect(analyseBody).toEqual({ updateContent: true }))
})
