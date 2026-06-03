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

  // Display (system/tab) audio stream — carries one audio track by default.
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

  return { mockStream, mockDisplayStream, mockWorkletNode, mockAudioContext, getUserMedia, getDisplayMedia }
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
it('shows the Analyse note button enabled when the note has content and is idle', () => {
  render(<TranscriptionPanel noteId="note-1" noteHasContent />)
  expect(screen.getByTestId('transcription-analyse-button')).toHaveTextContent('Analyse note')
  expect(screen.getByTestId('transcription-analyse-button')).toBeEnabled()
})

// Scenario: The "Update note content" toggle is gone (15-A) — AI never edits the user's notes
it('does not render an Update note content toggle', () => {
  render(<TranscriptionPanel noteId="note-1" noteHasContent />)
  expect(screen.queryByTestId('transcription-update-content-toggle')).toBeNull()
  expect(screen.queryByText(/update note content/i)).toBeNull()
})

// Scenario: Analyse note is visible but disabled when there is nothing to analyse (10-H2)
it('shows the Analyse note button visible but disabled when there is nothing to analyse', () => {
  render(<TranscriptionPanel noteId="note-1" />)
  const btn = screen.getByTestId('transcription-analyse-button')
  expect(btn).toBeInTheDocument()
  expect(btn).toBeDisabled()
  expect(btn).toHaveAttribute('title')
})

// Scenario: analysing POSTs to /analyse with no body and refreshes (15-A)
it('clicking Analyse note POSTs to /analyse and triggers a refresh', async () => {
  let analyseCalled = false
  let analyseBody: string | null = null
  server.use(
    http.post('/api/notes/note-1/analyse', async ({ request }) => {
      analyseCalled = true
      analyseBody = await request.text()
      return new HttpResponse(null, { status: 204 })
    }),
  )
  const onAnalysisComplete = vi.fn()
  render(<TranscriptionPanel noteId="note-1" noteHasContent onAnalysisComplete={onAnalysisComplete} />)

  await userEvent.click(screen.getByTestId('transcription-analyse-button'))

  await waitFor(() => expect(analyseCalled).toBe(true))
  expect(analyseBody).toBe('')
  await waitFor(() => expect(onAnalysisComplete).toHaveBeenCalled())
})

// ── 10-F: Capture remote participants (system audio mix) ──────────

// Scenario: System audio is mixed with mic when toggle is on
//   Given the "Include call audio" toggle is ON (default)
//   When I press Record and grant screen-share permission
//   Then getDisplayMedia is called with { audio: true, video: true } (Chromium rejects audio-only)
//   And the resulting audio track is mixed with the microphone track
it('captures system audio via getDisplayMedia when the call-audio toggle is on', async () => {
  const { getDisplayMedia, mockAudioContext } = stubBrowserApis()

  render(<TranscriptionPanel noteId="note-1" />)
  // Toggle defaults ON, so no interaction needed.
  expect(screen.getByTestId('transcription-call-audio-toggle')).toBeChecked()
  await userEvent.click(screen.getByTestId('transcription-record-button'))

  await waitFor(() => expect(screen.getByTestId('transcription-stop-button')).toBeInTheDocument())
  expect(getDisplayMedia).toHaveBeenCalledWith({ audio: true, video: true })
  // Mic + system sources are both created and summed into the mixer (GainNode).
  await waitFor(() => expect(mockAudioContext.createMediaStreamSource).toHaveBeenCalledTimes(2))
  expect(mockAudioContext.createGain).toHaveBeenCalled()
})

// Scenario: Falls back to mic-only if screen-share is cancelled
//   Given the toggle is ON
//   When I press Record and cancel the screen-share prompt
//   Then recording continues with microphone audio only
//   And no error is shown
it('falls back to mic-only and shows no error when screen-share is cancelled', async () => {
  const { getDisplayMedia, mockAudioContext } = stubBrowserApis()
  getDisplayMedia.mockRejectedValueOnce(new DOMException('Permission denied', 'NotAllowedError'))

  render(<TranscriptionPanel noteId="note-1" />)
  await userEvent.click(screen.getByTestId('transcription-record-button'))

  await waitFor(() => expect(screen.getByTestId('transcription-stop-button')).toBeInTheDocument())
  expect(screen.queryByTestId('transcription-error')).toBeNull()
  // Only the mic source is created; recording proceeds normally.
  expect(mockAudioContext.createMediaStreamSource).toHaveBeenCalledTimes(1)
})

// Scenario: Mic-only when toggle is off
//   Given the "Include call audio" toggle is OFF
//   When I press Record
//   Then getDisplayMedia is not called
//   And recording uses the microphone only
it('does not call getDisplayMedia when the call-audio toggle is off', async () => {
  const { getDisplayMedia, mockAudioContext } = stubBrowserApis()

  render(<TranscriptionPanel noteId="note-1" />)
  await userEvent.click(screen.getByTestId('transcription-call-audio-toggle'))
  await userEvent.click(screen.getByTestId('transcription-record-button'))

  await waitFor(() => expect(screen.getByTestId('transcription-stop-button')).toBeInTheDocument())
  expect(getDisplayMedia).not.toHaveBeenCalled()
  expect(mockAudioContext.createMediaStreamSource).toHaveBeenCalledTimes(1)
})

// Scenario: Screen-share granted but carries no audio (e.g. a silent window/tab)
//   Given the toggle is ON and the user shares a window with no audio
//   When I press Record
//   Then no mixer is created and recording proceeds mic-only
it('records mic-only when the shared display stream carries no audio track', async () => {
  const { getDisplayMedia, mockAudioContext } = stubBrowserApis()
  // A display stream the user granted but that has no audio (shared a silent window).
  getDisplayMedia.mockResolvedValueOnce({
    getTracks: () => [{ stop: vi.fn() }],
    getAudioTracks: () => [],
  } as unknown as MediaStream)

  render(<TranscriptionPanel noteId="note-1" />)
  await userEvent.click(screen.getByTestId('transcription-record-button'))

  await waitFor(() => expect(screen.getByTestId('transcription-stop-button')).toBeInTheDocument())
  // Only the mic source is wired; the empty display stream is not mixed in.
  expect(mockAudioContext.createMediaStreamSource).toHaveBeenCalledTimes(1)
  expect(mockAudioContext.createGain).not.toHaveBeenCalled()
})

// ── 10-E: Auto-analysis on stop ───────────────────────────────────

// Scenario: Auto-analysis fires when switch is on and recording stops
//   Given the auto-analyse switch is ON (default)
//   When I stop the recording
//   Then analyseNote() is called automatically
//   And a loading state is shown in the panel
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

  render(<TranscriptionPanel noteId="note-1" />)
  // Switch defaults ON, no interaction needed.
  expect(screen.getByTestId('transcription-auto-analyse-toggle')).toBeChecked()

  await userEvent.click(screen.getByTestId('transcription-record-button'))
  await waitFor(() => expect(screen.getByTestId('transcription-stop-button')).toBeInTheDocument())
  emitTranscriptResult('Meeting transcript')
  await waitFor(() => expect(screen.getByTestId('transcription-text')).toHaveTextContent('Meeting transcript'))

  await userEvent.click(screen.getByTestId('transcription-stop-button'))

  // analyseNote fires automatically...
  await waitFor(() => expect(analyseCalled).toBe(true))
  // ...and the panel shows a loading state while it runs.
  await waitFor(() => expect(screen.getByTestId('transcription-analyse-button')).toHaveTextContent('Analysing…'))
  expect(screen.getByTestId('transcription-analyse-button')).toBeDisabled()

  resolveAnalyse()
})

// Scenario: Auto-analysis is suppressed when switch is off
//   Given the auto-analyse switch is OFF
//   When I stop the recording
//   Then analyseNote() is not called
//   And the Analyse note button is still available to trigger it manually
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

  render(<TranscriptionPanel noteId="note-1" />)
  await userEvent.click(screen.getByTestId('transcription-auto-analyse-toggle'))
  expect(screen.getByTestId('transcription-auto-analyse-toggle')).not.toBeChecked()

  await userEvent.click(screen.getByTestId('transcription-record-button'))
  await waitFor(() => expect(screen.getByTestId('transcription-stop-button')).toBeInTheDocument())
  emitTranscriptResult('Meeting transcript')
  await waitFor(() => expect(screen.getByTestId('transcription-text')).toHaveTextContent('Meeting transcript'))

  await userEvent.click(screen.getByTestId('transcription-stop-button'))

  // Stop completes (transcript persisted) but analysis is NOT triggered automatically.
  await waitFor(() => expect(completionCalled).toBe(true))
  expect(analyseCalled).toBe(false)
  expect(screen.getByTestId('transcription-analyse-button')).toBeInTheDocument()
})

// Scenario: An empty recording (no transcript) does not auto-analyse
//   Auto-analyse on stop is about what was just recorded; with nothing captured it must not fire.
it('does not auto-analyse on stop when the recording produced no transcript', async () => {
  stubBrowserApis()
  let analyseCalled = false
  server.use(
    http.post('/api/notes/note-1/analyse', () => {
      analyseCalled = true
      return new HttpResponse(null, { status: 204 })
    }),
  )

  render(<TranscriptionPanel noteId="note-1" />)
  await userEvent.click(screen.getByTestId('transcription-record-button'))
  await waitFor(() => expect(screen.getByTestId('transcription-stop-button')).toBeInTheDocument())
  // No emitTranscriptResult — nothing was captured.
  await userEvent.click(screen.getByTestId('transcription-stop-button'))

  await waitFor(() => expect(screen.getByTestId('transcription-record-button')).toBeInTheDocument())
  expect(analyseCalled).toBe(false)
})

// Scenario: A second recording re-arms auto-analyse (the fired-ref resets on each new recording)
it('auto-analyses again on a second recording', async () => {
  stubBrowserApis()
  let analyseCount = 0
  server.use(
    http.post('/api/notes/note-1/analyse', () => {
      analyseCount += 1
      return new HttpResponse(null, { status: 204 })
    }),
  )

  render(<TranscriptionPanel noteId="note-1" />)

  // First recording → stop → auto-analyse.
  await userEvent.click(screen.getByTestId('transcription-record-button'))
  await waitFor(() => expect(screen.getByTestId('transcription-stop-button')).toBeInTheDocument())
  emitTranscriptResult('First meeting')
  await waitFor(() => expect(screen.getByTestId('transcription-text')).toHaveTextContent('First meeting'))
  await userEvent.click(screen.getByTestId('transcription-stop-button'))
  await waitFor(() => expect(analyseCount).toBe(1))

  // Second recording → stop → auto-analyse fires again.
  await userEvent.click(screen.getByTestId('transcription-record-button'))
  await waitFor(() => expect(screen.getByTestId('transcription-stop-button')).toBeInTheDocument())
  emitTranscriptResult('Second meeting')
  await waitFor(() => expect(screen.getByTestId('transcription-text')).toHaveTextContent('Second meeting'))
  await userEvent.click(screen.getByTestId('transcription-stop-button'))
  await waitFor(() => expect(analyseCount).toBe(2))
})

// Scenario: Switch resets to ON on page reload (it is ephemeral, never persisted)
it('auto-analyse switch defaults back to ON on a fresh mount', async () => {
  const first = render(<TranscriptionPanel noteId="note-1" />)
  await userEvent.click(screen.getByTestId('transcription-auto-analyse-toggle'))
  expect(screen.getByTestId('transcription-auto-analyse-toggle')).not.toBeChecked()
  first.unmount()

  render(<TranscriptionPanel noteId="note-1" />)
  expect(screen.getByTestId('transcription-auto-analyse-toggle')).toBeChecked()
})
