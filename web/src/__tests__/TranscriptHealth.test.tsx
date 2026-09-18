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

// A media track the specs can kill or mute the way the operating system does mid-meeting.
//
// Review round 1: this double used to report `getAudioTracks: () => []` while the hook watched
// `getTracks()`, which is exactly why no spec caught the screen share's VIDEO track being watched.
// It now models the two properties that carry the state — `readyState` and `muted` — including
// `stop()` ending a track, which is what pressing Stop does to every one of them.
interface FakeTrack {
  kind: 'audio' | 'video'
  readyState: 'live' | 'ended'
  muted: boolean
  stop: () => void
  end: () => void
  setMuted: (muted: boolean) => void
}

let micTrack: FakeTrack
let systemAudioTrack: FakeTrack
let systemVideoTrack: FakeTrack

function makeTrack(kind: 'audio' | 'video', onStop?: () => void): FakeTrack {
  const track: FakeTrack = {
    kind,
    readyState: 'live',
    muted: false,
    stop: () => {
      track.readyState = 'ended'
      onStop?.()
    },
    end: () => {
      track.readyState = 'ended'
    },
    setMuted: (muted) => {
      track.muted = muted
    },
  }
  return track
}

function fakeStream(tracks: FakeTrack[]): MediaStream {
  return {
    getTracks: () => tracks,
    getAudioTracks: () => tracks.filter((t) => t.kind === 'audio'),
  } as unknown as MediaStream
}

function stubBrowserApis() {
  micTrackStop = vi.fn()
  micTrack = makeTrack('audio', micTrackStop)
  systemAudioTrack = makeTrack('audio')
  systemVideoTrack = makeTrack('video')
  const mediaStream = fakeStream([micTrack])
  const displayStream = fakeStream([systemVideoTrack, systemAudioTrack])
  Object.defineProperty(global.navigator, 'mediaDevices', {
    value: {
      getUserMedia: vi.fn().mockResolvedValue(mediaStream),
      getDisplayMedia: vi.fn().mockResolvedValue(displayStream),
    },
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
let secondTick: (() => void) | null = null

function at(seconds: number) {
  now = T0 + seconds * 1000
}

function tick() {
  act(() => { checkpoint!() })
}

// The once-a-second timer that drives the elapsed clock — and, since BUG-85, the stall notice.
function tickSecond() {
  act(() => { secondTick!() })
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
  secondTick = null
  at(0)
  vi.spyOn(Date, 'now').mockImplementation(() => now)
  vi.spyOn(global, 'setInterval').mockImplementation((function (cb: () => void, ms?: number, ...rest: unknown[]) {
    if (ms === CHECKPOINT_INTERVAL_MS) checkpoint = cb
    if (ms === 1000) secondTick = cb
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

async function startCloudRecording(resumeFrom?: string, includeCallAudio = false) {
  const view = renderHook(() => useTranscription('note-1'))
  act(() => view.result.current.startRecording(includeCallAudio, false, resumeFrom))
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

// `amplitude` is the level of the captured audio. The default is ordinary speech; 0 is what a dead
// or muted track delivers — zero-filled buffers at the normal rate, which is why counting buffers
// pushed could never tell the two apart (BUG-85).
async function sendAudio(frames: number, amplitude = 0.2) {
  const target = audioChunksConsumed + frames
  for (let i = 0; i < frames; i++) {
    act(() => workletNode.port.onmessage!({ data: new Float32Array(1600).fill(amplitude) } as MessageEvent))
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
      sourceEnded: false,
      sourceMuted: false,
      audioSilent: false,
      secondsSilent: 10,
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

  // The start-of-meeting version of the incident: the stream dies before any text arrives. The
  // reason still reaches the server, as health only, and nothing is committed.
  it('reports the error with health only when no text had been captured', async () => {
    const view = await startCloudRecording()
    at(30)
    streams[0].push({ kind: 'error', error: namedError('BadRequestException', 'boom') })

    await waitFor(() => expect(view.result.current.status).toBe('error'))
    await waitFor(() => expect(drafts).toHaveLength(1))
    expect(drafts[0].transcriptText).toBe('')
    expect(drafts[0].health).toMatchObject({
      endReason: 'error',
      errorName: 'BadRequestException',
      errorMessage: 'boom',
      coveredSeconds: null,
      secondsSinceLastText: null,
    })
    await new Promise((r) => setTimeout(r, 20))
    expect(commits).toHaveLength(0)
  })

  it('sends nothing when recording never started (credentials refused)', async () => {
    server.use(http.get('/api/transcription/credentials', () => new HttpResponse(null, { status: 403 })))
    const view = renderHook(() => useTranscription('note-1'))
    act(() => view.result.current.startRecording(false, false))

    await waitFor(() => expect(view.result.current.status).toBe('error'))
    await new Promise((r) => setTimeout(r, 20))
    expect(drafts).toHaveLength(0)
  })

  it('reports the error with health only on a resumed recording with no new text', async () => {
    const view = await startCloudRecording('Speaker 1: earlier')
    streams[0].push({ kind: 'error', error: namedError('Error', 'boom') })

    await waitFor(() => expect(view.result.current.status).toBe('error'))
    await waitFor(() => expect(drafts).toHaveLength(1))
    expect(drafts[0].transcriptText).toBe('')
    expect(drafts[0].health!.endReason).toBe('error')
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

// BUG-85 slice 1 — twice now the live transcript has stopped part-way through a meeting while the
// timer kept running, costing 54 minutes of one meeting and 3.5 hours of another, with nothing on
// screen to say so. The recording now knows the transcript has stopped growing, and knows which of
// three things is behind it: the audio source died, no sound is reaching it, or sound is arriving
// and nothing comes back. Counting buffers pushed could never tell those apart — a dead track
// delivers zero-filled buffers at exactly the normal rate.
describe('a recording whose transcript has stopped growing', () => {
  it('says nothing while text is still arriving, and nothing in the first two minutes without it', async () => {
    const view = await startCloudRecording()
    at(10)
    await emitResult(view, 'Hello', 9)
    await sendAudio(3)

    at(125)
    tickSecond()

    expect(view.result.current.stall).toBeUndefined()
  })

  // Review round 1 must-fix: a healthy meeting can be quiet for two minutes — people joining, a
  // pause to read something. Before any words have ever been transcribed there is nothing to say
  // has stopped, so the sound-but-no-words case waits for proof that words were once flowing.
  it('says nothing about missing words before any words have ever arrived, however long it takes', async () => {
    const view = await startCloudRecording()
    at(5)
    await sendAudio(3)

    at(600)
    tickSecond()

    expect(view.result.current.stall).toBeUndefined()
  })

  // The gate is on the words case only. A source that dies before the first word is still a dead
  // source, and still worth saying.
  it('still reports a dead source before any words have arrived', async () => {
    const view = await startCloudRecording()
    at(5)
    await sendAudio(3)
    at(20)
    micTrack.end()

    at(150)
    tickSecond()

    expect(view.result.current.stall).toEqual({ kind: 'sourceEnded', stalledForSeconds: 150 })
  })

  it('reports the audio source as ended when a captured track dies mid-recording', async () => {
    const view = await startCloudRecording()
    at(5)
    await sendAudio(3)
    at(10)
    await emitResult(view, 'Hello', 9)
    at(20)
    micTrack.end()

    at(150)
    tickSecond()

    expect(view.result.current.stall).toEqual({ kind: 'sourceEnded', stalledForSeconds: 140 })
  })

  // Review round 1 must-fix: the screen share's VIDEO track is not audio. Clicking "Stop sharing"
  // used to mark the recording as a dead source for good — and mark every later save at Warning,
  // poisoning the one piece of evidence this work exists to collect.
  it('ignores the screen share video track ending — that is not the audio going away', async () => {
    const view = await startCloudRecording(undefined, true)
    at(10)
    await emitResult(view, 'Hello', 9)
    at(15)
    await sendAudio(3)
    at(20)
    systemVideoTrack.end()

    at(150)
    tickSecond()
    expect(view.result.current.stall).toEqual({ kind: 'noWords', stalledForSeconds: 140 })

    at(160)
    tick()
    await waitFor(() => expect(drafts).toHaveLength(1))
    expect(drafts[0].health!.sourceEnded).toBe(false)
  })

  it('does report the screen share AUDIO track ending', async () => {
    const view = await startCloudRecording(undefined, true)
    at(5)
    await sendAudio(3)
    at(10)
    await emitResult(view, 'Hello', 9)
    at(20)
    systemAudioTrack.end()

    at(150)
    tickSecond()

    expect(view.result.current.stall).toEqual({ kind: 'sourceEnded', stalledForSeconds: 140 })
  })

  // Review round 1 must-fix: read live rather than latched, so a source that ends and is replaced
  // does not mark the rest of the meeting.
  it('stops reporting a dead source once the track is live again', async () => {
    const view = await startCloudRecording()
    at(5)
    await sendAudio(3)
    at(10)
    await emitResult(view, 'Hello', 9)
    at(20)
    micTrack.end()
    at(150)
    tickSecond()
    expect(view.result.current.stall!.kind).toBe('sourceEnded')

    micTrack.readyState = 'live'
    at(160)
    await sendAudio(3)
    tickSecond()

    expect(view.result.current.stall).toEqual({ kind: 'noWords', stalledForSeconds: 150 })
  })

  // Pressing Stop ends every captured track. That must not be read as the source having failed.
  it('does not report a dead source just because Stop released the tracks', async () => {
    const view = await startCloudRecording()
    at(5)
    await sendAudio(3)
    at(10)
    await emitResult(view, 'Hello', 9)

    at(40)
    act(() => view.result.current.stopRecording())

    await waitFor(() => expect(commits).toHaveLength(1))
    expect(commits[0].health!.sourceEnded).toBe(false)
  })

  // The error path saves its draft AFTER releasing the microphone, and releasing it ends every
  // track — so the reading has to be taken before the teardown or the fact is lost in one
  // direction and invented in the other.
  it('still reports a source that really died when the stream errors after teardown', async () => {
    const view = await startCloudRecording()
    at(5)
    await sendAudio(3)
    at(10)
    await emitResult(view, 'Captured', 9)
    at(20)
    micTrack.end()

    at(60)
    streams[0].push({ kind: 'error', error: namedError('BadRequestException', 'no new audio') })

    await waitFor(() => expect(view.result.current.status).toBe('error'))
    await waitFor(() => expect(drafts).toHaveLength(1))
    expect(drafts[0].health).toMatchObject({ endReason: 'error', sourceEnded: true })
  })

  it('carries the dead source to the server on the next save', async () => {
    const view = await startCloudRecording()
    at(5)
    await sendAudio(3)
    at(10)
    await emitResult(view, 'Hello', 9)
    at(20)
    micTrack.end()

    at(150)
    tick()

    await waitFor(() => expect(drafts).toHaveLength(1))
    expect(drafts[0].health).toMatchObject({ endReason: 'stalled', sourceEnded: true })
  })

  it('reports no sound when no sample above the floor has arrived since the last words', async () => {
    const view = await startCloudRecording()
    at(10)
    await emitResult(view, 'Hello', 9)
    at(150)
    await sendAudio(5, 0)

    at(200)
    tickSecond()

    expect(view.result.current.stall).toEqual({ kind: 'noSound', stalledForSeconds: 190 })
  })

  // Review round 1 should-fix: the old silence window ran on its own clock, so the notice could say
  // "sound is arriving" while the audio had been digitally silent for 90 seconds and then flip to
  // "no sound" mid-stall. Sound that arrived AFTER the last words settles the episode as
  // sound-but-no-words, and it stays settled however long the silence afterwards runs.
  it('does not flip between the two once sound has arrived since the last words', async () => {
    const view = await startCloudRecording()
    at(10)
    await emitResult(view, 'Hello', 9)
    at(100)
    await sendAudio(3)
    at(101)
    await sendAudio(3, 0)

    for (const second of [130, 200, 230, 400]) {
      at(second)
      tickSecond()
      expect(view.result.current.stall!.kind).toBe('noWords')
    }
  })

  it('carries the silence and how long it has lasted to the server', async () => {
    const view = await startCloudRecording()
    at(10)
    await emitResult(view, 'Hello', 9)
    at(150)
    await sendAudio(5, 0)

    at(200)
    tick()

    await waitFor(() => expect(drafts).toHaveLength(1))
    expect(drafts[0].health).toMatchObject({
      endReason: 'stalled',
      sourceEnded: false,
      sourceMuted: false,
      audioSilent: true,
      secondsSilent: 200,
    })
  })

  // Review round 1 nit: a clock that moves backwards must not produce a negative duration.
  it('never reports a negative silence, whatever the clock does', async () => {
    const view = await startCloudRecording()
    at(200)
    await emitResult(view, 'Hello', 9)
    await sendAudio(3)

    at(100)
    tick()

    await waitFor(() => expect(drafts).toHaveLength(1))
    expect(drafts[0].health!.secondsSilent).toBeGreaterThanOrEqual(0)
  })

  it('reports sound arriving but no words when the audio is above the transmit floor', async () => {
    const view = await startCloudRecording()
    at(10)
    await emitResult(view, 'Hello', 9)
    at(190)
    await sendAudio(5)

    at(200)
    tickSecond()

    expect(view.result.current.stall).toEqual({ kind: 'noWords', stalledForSeconds: 190 })
    at(201)
    tick()
    await waitFor(() => expect(drafts).toHaveLength(1))
    expect(drafts[0].health).toMatchObject({ audioSilent: false, secondsSilent: 11 })
  })

  it('clears the report as soon as new text arrives', async () => {
    const view = await startCloudRecording()
    at(10)
    await emitResult(view, 'Hello', 9)
    at(190)
    await sendAudio(5)
    at(200)
    tickSecond()
    expect(view.result.current.stall).not.toBeUndefined()

    at(205)
    await emitResult(view, 'and on we go', 200)
    tickSecond()

    expect(view.result.current.stall).toBeUndefined()
  })

  it('reports no sound while a captured track is muted, and clears once it is unmuted and words return', async () => {
    const view = await startCloudRecording()
    at(10)
    await emitResult(view, 'Hello', 9)
    await sendAudio(5)
    at(20)
    micTrack.setMuted(true)

    at(150)
    tickSecond()
    expect(view.result.current.stall).toEqual({ kind: 'noSound', stalledForSeconds: 140 })

    micTrack.setMuted(false)
    at(160)
    await sendAudio(5)
    await emitResult(view, 'back again', 155)
    tickSecond()

    expect(view.result.current.stall).toBeUndefined()
  })

  // Review round 1 should-fix: the mute state used to be counted from events, so one duplicated
  // mute stuck "no sound" on for the rest of the meeting. Read from the track itself, an extra
  // mute is simply the same fact twice.
  it('recovers from a duplicated mute — one unmute is enough however many mutes arrived', async () => {
    const view = await startCloudRecording()
    at(10)
    await emitResult(view, 'Hello', 9)
    await sendAudio(5)
    at(20)
    micTrack.setMuted(true)
    micTrack.setMuted(true)
    micTrack.setMuted(true)

    // Read while it is muted, three mutes deep — a counter is now at 3, and one unmute leaves it
    // at 2, which is how the old shape stuck "no sound" on for the rest of the meeting.
    at(150)
    tickSecond()
    expect(view.result.current.stall!.kind).toBe('noSound')

    micTrack.setMuted(false)
    at(160)
    await sendAudio(5)
    tickSecond()

    expect(view.result.current.stall).toEqual({ kind: 'noWords', stalledForSeconds: 150 })
  })
})
