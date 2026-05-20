import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '../test/setup'
import TranscriptionPanel from '../components/TranscriptionPanel'

// ── Transcribe SDK mock ───────────────────────────────────────────
// Each test gets a fresh deferred that controls when the transcript stream emits.
let emitTranscriptResult: (text: string) => void = () => {}

vi.mock('@aws-sdk/client-transcribe-streaming', () => {
  return {
    TranscribeStreamingClient: vi.fn().mockImplementation(() => ({
      send: vi.fn().mockImplementation(async () => {
        let _emitResult: (text: string) => void
        let _endStream: () => void
        const resultQueue: string[] = []
        let wakeup: (() => void) | null = null
        let done = false

        _emitResult = (text: string) => {
          resultQueue.push(text)
          wakeup?.()
          wakeup = null
        }
        _endStream = () => {
          done = true
          wakeup?.()
          wakeup = null
        }

        emitTranscriptResult = _emitResult
        void _endStream

        async function* stream() {
          while (!done) {
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

  const mockProcessor = {
    connect: vi.fn(),
    disconnect: vi.fn(),
    onaudioprocess: null as ((e: AudioProcessingEvent) => void) | null,
  }

  const mockSource = { connect: vi.fn() }

  const mockAudioContext = {
    sampleRate: 16000,
    createMediaStreamSource: vi.fn().mockReturnValue(mockSource),
    createScriptProcessor: vi.fn().mockReturnValue(mockProcessor),
    destination: {},
    close: vi.fn().mockResolvedValue(undefined),
  }

  Object.defineProperty(global.navigator, 'mediaDevices', {
    value: { getUserMedia: vi.fn().mockResolvedValue(mockStream) },
    configurable: true,
  })

  vi.stubGlobal('AudioContext', vi.fn().mockImplementation(() => mockAudioContext))

  return { mockStream, mockProcessor, mockAudioContext }
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
