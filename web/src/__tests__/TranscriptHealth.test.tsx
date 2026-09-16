import { act, renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { TranscriptHealth } from '../api/transcription'
import { TranscriptHealthTracker } from '../hooks/transcriptHealth'
import { CHECKPOINT_INTERVAL_MS, useTranscription } from '../hooks/useTranscription'
import { server } from '../test/setup'

// TI-99: every transcript save carries how the live transcription was doing, so an incomplete
// transcript can be diagnosed from the server alone. These specs drive the real hook against a
// scripted Transcribe stream and a controllable clock.

// ── Scripted Transcribe stream ────────────────────────────────────
type StreamAction =
  | { kind: 'result'; text: string; endTime: number }
  | { kind: 'error'; error: unknown }
  | { kind: 'end' }

interface ScriptedStream {
  push: (action: StreamAction) => void
}

const streams: ScriptedStream[] = []
let audioChunksConsumed = 0

vi.mock('@aws-sdk/client-transcribe-streaming', () => ({
  TranscribeStreamingClient: vi.fn().mockImplementation(function () {
    return {
      send: vi.fn().mockImplementation(async (command: { input: { AudioStream: AsyncIterable<unknown> } }) => {
        // Drain the audio the hook yields, as the real client would.
        void (async () => {
          for await (const _chunk of command.input.AudioStream) audioChunksConsumed += 1
        })()

        const queue: StreamAction[] = []
        let wakeup: (() => void) | null = null
        streams.push({
          push: (action) => {
            queue.push(action)
            wakeup?.()
            wakeup = null
          },
        })

        async function* results() {
          for (;;) {
            if (queue.length === 0) await new Promise<void>((r) => { wakeup = r })
            while (queue.length > 0) {
              const action = queue.shift()!
              if (action.kind === 'end') return
              if (action.kind === 'error') throw action.error
              yield {
                TranscriptEvent: {
                  Transcript: {
                    Results: [
                      {
                        IsPartial: false,
                        EndTime: action.endTime,
                        Alternatives: [
                          {
                            Transcript: action.text,
                            Items: [{ Content: action.text, Speaker: '0', Type: 'pronunciation' }],
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

        return { TranscriptResultStream: results() }
      }),
    }
  }),
  StartStreamTranscriptionCommand: vi.fn().mockImplementation(function (input: unknown) {
    return { input }
  }),
}))

// ── Browser stubs ─────────────────────────────────────────────────
const workletNode = {
  connect: vi.fn(),
  port: { onmessage: null as ((e: MessageEvent) => void) | null },
}

let micTrackStop = vi.fn()

function stubBrowserApis() {
  micTrackStop = vi.fn()
  const track = { stop: micTrackStop }
  const mediaStream = { getTracks: () => [track], getAudioTracks: () => [] } as unknown as MediaStream
  Object.defineProperty(global.navigator, 'mediaDevices', {
    value: { getUserMedia: vi.fn().mockResolvedValue(mediaStream), getDisplayMedia: vi.fn() },
    configurable: true,
  })
  const audioContext = {
    sampleRate: 16000,
    createMediaStreamSource: vi.fn().mockReturnValue({ connect: vi.fn() }),
    createGain: vi.fn().mockReturnValue({ connect: vi.fn() }),
    audioWorklet: { addModule: vi.fn().mockResolvedValue(undefined) },
    close: vi.fn().mockResolvedValue(undefined),
  }
  vi.stubGlobal('AudioContext', vi.fn().mockImplementation(function () { return audioContext }))
  vi.stubGlobal('AudioWorkletNode', vi.fn().mockImplementation(function () { return workletNode }))
}

// ── Clock + checkpoint control ────────────────────────────────────
const nativeSetInterval = globalThis.setInterval
const T0 = 1_700_000_000_000
let now = T0
let checkpoint: (() => void) | null = null

function at(seconds: number) {
  now = T0 + seconds * 1000
}

function tick() {
  act(() => { checkpoint!() })
}

// ── Captured saves ────────────────────────────────────────────────
interface SaveBody {
  transcriptText: string
  durationSeconds: number
  health?: TranscriptHealth
}

let drafts: SaveBody[] = []
let commits: SaveBody[] = []

beforeEach(() => {
  streams.length = 0
  audioChunksConsumed = 0
  drafts = []
  commits = []
  checkpoint = null
  at(0)
  vi.spyOn(Date, 'now').mockImplementation(() => now)
  vi.spyOn(global, 'setInterval').mockImplementation((function (cb: () => void, ms?: number, ...rest: unknown[]) {
    if (ms === CHECKPOINT_INTERVAL_MS) checkpoint = cb
    return nativeSetInterval(cb, ms, ...rest)
  }) as unknown as typeof setInterval)
  stubBrowserApis()
  server.use(
    http.put('/api/notes/note-1/transcription/draft', async ({ request }) => {
      drafts.push((await request.json()) as SaveBody)
      return new HttpResponse(null, { status: 204 })
    }),
    http.post('/api/notes/note-1/transcription', async ({ request }) => {
      commits.push((await request.json()) as SaveBody)
      return new HttpResponse(null, { status: 204 })
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function startCloudRecording(resumeFrom?: string) {
  const view = renderHook(() => useTranscription('note-1'))
  act(() => view.result.current.startRecording(false, false, resumeFrom))
  await waitFor(() => expect(streams).toHaveLength(1))
  await waitFor(() => expect(checkpoint).not.toBeNull())
  return view
}

interface HookView {
  result: { current: ReturnType<typeof useTranscription> }
}

async function emitResult(view: HookView, text: string, endTime: number) {
  streams[streams.length - 1].push({ kind: 'result', text, endTime })
  await waitFor(() => expect(view.result.current.transcript).toContain(text))
}

async function sendAudio(frames: number) {
  const target = audioChunksConsumed + frames
  for (let i = 0; i < frames; i++) {
    act(() => workletNode.port.onmessage!({ data: new Float32Array(1600) } as MessageEvent))
  }
  await waitFor(() => expect(audioChunksConsumed).toBe(target))
}

function namedError(name: string, message: string): Error {
  const error = new Error(message)
  error.name = name
  return error
}

// ── Specs ─────────────────────────────────────────────────────────

describe('a stopped recording', () => {
  it('commits with the stop reason, the service-timed coverage, the audio sent and one stream', async () => {
    const view = await startCloudRecording()

    at(10)
    await emitResult(view, 'Hello', 12.5)
    at(30)
    await sendAudio(10)
    await emitResult(view, 'World', 30.25)
    at(40)
    act(() => view.result.current.stopRecording())

    await waitFor(() => expect(commits).toHaveLength(1))
    expect(commits[0].health).toEqual({
      engine: 'cloud',
      endReason: 'stopped',
      coveredSeconds: 30.25,
      secondsSinceLastText: 10,
      audioSecondsSent: 1,
      secondsSinceLastAudio: 10,
      streamCount: 1,
    })
  })
})

describe('a draft checkpoint while recording', () => {
  it('carries an in-progress health record', async () => {
    const view = await startCloudRecording()
    at(5)
    await emitResult(view, 'Hello', 4)
    at(15)
    tick()

    await waitFor(() => expect(drafts).toHaveLength(1))
    expect(drafts[0].health).toMatchObject({ engine: 'cloud', endReason: 'inProgress', coveredSeconds: 4, secondsSinceLastText: 10 })
  })
})

describe('a stream that errors', () => {
  it('saves the captured text as a draft that names the error, without committing', async () => {
    const view = await startCloudRecording()
    at(5)
    await emitResult(view, 'Captured so far', 4.5)
    at(60)
    streams[0].push({ kind: 'error', error: namedError('BadRequestException', 'no new audio was received') })

    await waitFor(() => expect(view.result.current.status).toBe('error'))
    await waitFor(() => expect(drafts).toHaveLength(1))
    expect(drafts[0].transcriptText).toBe('Speaker 1: Captured so far')
    expect(drafts[0].health).toMatchObject({
      endReason: 'error',
      errorName: 'BadRequestException',
      errorMessage: 'no new audio was received',
      coveredSeconds: 4.5,
      secondsSinceLastText: 55,
    })
    expect(commits).toHaveLength(0)
  })

  it('truncates a long error message to 200 characters', async () => {
    const view = await startCloudRecording()
    await emitResult(view, 'Captured', 1)
    streams[0].push({ kind: 'error', error: namedError('Error', 'x'.repeat(500)) })

    await waitFor(() => expect(drafts).toHaveLength(1))
    expect(drafts[0].health!.errorMessage).toBe('x'.repeat(200))
  })

  // Review must-fix: a thrown value that is not an Error must not stop the error handling —
  // otherwise the microphone stays on and the screen stays on "recording".
  it('still reaches the error state and releases capture when the stream throws a non-Error value', async () => {
    const view = await startCloudRecording()
    await emitResult(view, 'Captured', 1)
    streams[0].push({ kind: 'error', error: Object.create(null) })

    await waitFor(() => expect(view.result.current.status).toBe('error'))
    expect(micTrackStop).toHaveBeenCalled()
    await waitFor(() => expect(drafts).toHaveLength(1))
    expect(drafts[0].health).toMatchObject({ endReason: 'error', errorName: 'object' })
  })

  it('still tears down and shows the error when reporting the error itself fails', async () => {
    vi.spyOn(TranscriptHealthTracker.prototype, 'ended').mockImplementation(() => {
      throw new Error('reporting broke')
    })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const view = await startCloudRecording()
    await emitResult(view, 'Captured', 1)
    streams[0].push({ kind: 'error', error: new Error('stream died') })

    await waitFor(() => expect(view.result.current.status).toBe('error'))
    expect(view.result.current.error).toBe('stream died')
    expect(micTrackStop).toHaveBeenCalled()
  })

  it('reports a thrown error whose name is not a string without failing', async () => {
    const view = await startCloudRecording()
    await emitResult(view, 'Captured', 1)
    streams[0].push({ kind: 'error', error: Object.assign(new Error('odd'), { name: 42 }) })

    await waitFor(() => expect(view.result.current.status).toBe('error'))
    await waitFor(() => expect(drafts).toHaveLength(1))
    expect(drafts[0].health).toMatchObject({ endReason: 'error', errorMessage: 'odd' })
  })

  it('saves nothing when no text had been captured', async () => {
    const view = await startCloudRecording()
    streams[0].push({ kind: 'error', error: namedError('Error', 'boom') })

    await waitFor(() => expect(view.result.current.status).toBe('error'))
    await new Promise((r) => setTimeout(r, 20))
    expect(drafts).toHaveLength(0)
  })

  it('still reports the error when the transcript is committed on leaving the note', async () => {
    const view = await startCloudRecording()
    await emitResult(view, 'Captured', 1)
    streams[0].push({ kind: 'error', error: namedError('NetworkError', 'socket closed') })
    await waitFor(() => expect(drafts).toHaveLength(1))

    view.unmount()

    await waitFor(() => expect(commits).toHaveLength(1))
    expect(commits[0].health).toMatchObject({ endReason: 'error', errorName: 'NetworkError' })
  })
})

describe('a stream that ends on its own', () => {
  it('commits with the stream-ended reason', async () => {
    const view = await startCloudRecording()
    await emitResult(view, 'Whole meeting', 3)
    streams[0].push({ kind: 'end' })

    await waitFor(() => expect(commits).toHaveLength(1))
    expect(commits[0].health).toMatchObject({ endReason: 'streamEnded', streamCount: 1 })
  })
})

describe('a stalled recording', () => {
  it('reports the stall once after two minutes without new text, then at most every five minutes', async () => {
    const view = await startCloudRecording()
    at(10)
    await emitResult(view, 'Hello', 9)
    at(15)
    tick()
    await waitFor(() => expect(drafts).toHaveLength(1))

    at(129)
    tick()
    at(130)
    tick()
    await waitFor(() => expect(drafts).toHaveLength(2))
    expect(drafts[1].transcriptText).toBe('Speaker 1: Hello')
    expect(drafts[1].health).toMatchObject({ endReason: 'stalled', secondsSinceLastText: 120 })

    for (const s of [145, 200, 300, 429]) {
      at(s)
      tick()
    }
    await new Promise((r) => setTimeout(r, 20))
    expect(drafts).toHaveLength(2)

    at(430)
    tick()
    await waitFor(() => expect(drafts).toHaveLength(3))
    expect(drafts[2].health).toMatchObject({ endReason: 'stalled', secondsSinceLastText: 420 })
  })

  it('starts a fresh episode once new text arrives', async () => {
    const view = await startCloudRecording()
    at(10)
    await emitResult(view, 'Hello', 9)
    at(130)
    tick()
    await waitFor(() => expect(drafts).toHaveLength(1))
    expect(drafts[0].health!.endReason).toBe('stalled')

    at(140)
    await emitResult(view, 'again', 139)
    at(145)
    tick()
    await waitFor(() => expect(drafts).toHaveLength(2))
    expect(drafts[1].health!.endReason).toBe('inProgress')

    at(260)
    tick()
    await waitFor(() => expect(drafts).toHaveLength(3))
    expect(drafts[2].health).toMatchObject({ endReason: 'stalled', secondsSinceLastText: 120 })
  })

  // Review should-fix: a recording that has captured nothing is the most stalled of all — it
  // reports with health only, and the draft text is left empty so nothing is overwritten.
  it('reports a stall with health only when no text has been captured at all', async () => {
    await startCloudRecording()
    at(119)
    tick()
    at(120)
    tick()

    await waitFor(() => expect(drafts).toHaveLength(1))
    expect(drafts[0].transcriptText).toBe('')
    expect(drafts[0].health).toMatchObject({ endReason: 'stalled', secondsSinceLastText: null, coveredSeconds: null })

    at(135)
    tick()
    await new Promise((r) => setTimeout(r, 20))
    expect(drafts).toHaveLength(1)
  })

  it('reports a stall on a resumed recording without resending the earlier transcript', async () => {
    await startCloudRecording('Speaker 1: earlier')
    at(120)
    tick()

    await waitFor(() => expect(drafts).toHaveLength(1))
    expect(drafts[0].transcriptText).toBe('')
    expect(drafts[0].health!.endReason).toBe('stalled')
  })

  it('sends no draft at all before a stall when nothing has been captured', async () => {
    await startCloudRecording()
    for (const s of [15, 60, 119]) {
      at(s)
      tick()
    }
    await new Promise((r) => setTimeout(r, 20))
    expect(drafts).toHaveLength(0)
  })
})
