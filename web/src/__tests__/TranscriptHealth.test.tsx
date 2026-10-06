import { act, renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { TranscriptHealth } from '../api/transcription'
import { LOUDNESS_FLOOR_DBFS, MIN_SPEECH_SECONDS, TranscriptHealthTracker } from '../hooks/transcriptHealth'
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
  getSettings: () => { deviceId?: string; groupId?: string }
  addEventListener: (type: string, listener: () => void) => void
  removeEventListener: (type: string, listener: () => void) => void
}

let micTrack: FakeTrack
let systemAudioTrack: FakeTrack
let systemVideoTrack: FakeTrack

// `end()` is the operating system taking the device away, which fires `ended`; `stop()` is the app
// releasing it, which in a real browser does NOT fire `ended` — the asymmetry the reconnect relies
// on to tell a lost microphone from one it let go of itself.
function makeTrack(kind: 'audio' | 'video', onStop?: () => void, deviceId = 'dock-webcam-mic'): FakeTrack {
  const endedListeners = new Set<() => void>()
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
      for (const listener of [...endedListeners]) listener()
    },
    setMuted: (muted) => {
      track.muted = muted
    },
    getSettings: () => ({ deviceId, groupId: `group-${deviceId}` }),
    addEventListener: (type, listener) => {
      if (type === 'ended') endedListeners.add(listener)
    },
    removeEventListener: (type, listener) => {
      if (type === 'ended') endedListeners.delete(listener)
    },
  }
  return track
}

// A track whose state getter throws — a revoked or already-released device track. Reading it must
// never cost the recording (BUG-74's shape: the read happens inside commitTranscript's argument
// list, AFTER the one-shot guard has been set).
function breakTrackState(track: FakeTrack, property: 'readyState' | 'muted'): void {
  Object.defineProperty(track, property, {
    get() {
      throw new Error(`the ${property} of a released track`)
    },
    configurable: true,
  })
}

function fakeStream(tracks: FakeTrack[]): MediaStream {
  return {
    getTracks: () => tracks,
    getAudioTracks: () => tracks.filter((t) => t.kind === 'audio'),
  } as unknown as MediaStream
}

// BUG-85: what asking for a microphone again returns, in order — a fresh device that came back, or
// an error because nothing is plugged in. Once the list runs out the device stays gone, which is
// what every spec not about reconnecting needs: a dead microphone stays dead.
type MicAnswer =
  | { kind: 'device'; deviceId: string }
  | { kind: 'missing' }
  // The device answers only once the spec says so — for "Stop pressed while still reconnecting".
  | { kind: 'held'; deviceId: string; until: Promise<void> }
let micAnswers: MicAnswer[] = []
let reacquiredTracks: FakeTrack[] = []
let getUserMedia: ReturnType<typeof vi.fn>
// What `enumerateDevices` lists: Chromium's two virtual inputs, the dock's webcam mic behind them,
// and the laptop's own.
const inputDevices = [
  { kind: 'audioinput', deviceId: 'default', groupId: 'group-dock-webcam-mic', label: 'Default - Webcam' },
  { kind: 'audioinput', deviceId: 'communications', groupId: 'group-dock-webcam-mic', label: 'Communications - Webcam' },
  { kind: 'audioinput', deviceId: 'dock-webcam-mic', groupId: 'group-dock-webcam-mic', label: 'Webcam' },
  { kind: 'audioinput', deviceId: 'built-in-mic', groupId: 'group-built-in-mic', label: 'Microphone Array' },
]

interface FakeSource {
  stream: MediaStream
  connect: ReturnType<typeof vi.fn>
  disconnect: ReturnType<typeof vi.fn>
}
let sources: FakeSource[] = []
let mixer: { connect: ReturnType<typeof vi.fn> }

function stubBrowserApis() {
  micTrackStop = vi.fn()
  micTrack = makeTrack('audio', micTrackStop)
  systemAudioTrack = makeTrack('audio')
  systemVideoTrack = makeTrack('video')
  micAnswers = []
  reacquiredTracks = []
  sources = []
  const mediaStream = fakeStream([micTrack])
  const displayStream = fakeStream([systemVideoTrack, systemAudioTrack])
  let firstCall = true
  getUserMedia = vi.fn().mockImplementation(async () => {
    if (firstCall) {
      firstCall = false
      return mediaStream
    }
    const answer = micAnswers.shift() ?? { kind: 'missing' }
    if (answer.kind === 'missing') throw namedError('NotFoundError', 'Requested device not found')
    if (answer.kind === 'held') await answer.until
    const track = makeTrack('audio', undefined, answer.deviceId)
    reacquiredTracks.push(track)
    return fakeStream([track])
  })
  Object.defineProperty(global.navigator, 'mediaDevices', {
    value: {
      getUserMedia,
      getDisplayMedia: vi.fn().mockResolvedValue(displayStream),
      enumerateDevices: vi.fn().mockResolvedValue(inputDevices),
    },
    configurable: true,
  })
  mixer = { connect: vi.fn() }
  const audioContext = {
    sampleRate: 16000,
    createMediaStreamSource: vi.fn().mockImplementation((stream: MediaStream) => {
      const source = { stream, connect: vi.fn(), disconnect: vi.fn() }
      sources.push(source)
      return source
    }),
    createGain: vi.fn().mockReturnValue(mixer),
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

// Speech-level audio for `seconds` of captured time, in 100 ms frames. The notice claims speech is
// arriving only past a minimum stretch of it, so a spec about that case sends a real stretch.
async function speak(seconds: number, amplitude = 0.2) {
  await sendAudio(seconds * 10, amplitude)
}

// About -50 dBFS: a live microphone in a room where nobody is speaking. Well above the silence floor
// (so it is not "no sound"), well below the speech threshold.
const ROOM_TONE = 0.003

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
      microphoneReconnects: 0,
      audioSilent: false,
      secondsSilent: 10,
      // The window restarted with the last words at 30 s and no audio has arrived since.
      loudestDbfs: LOUDNESS_FLOOR_DBFS,
      speechSeconds: 0,
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
// four things is behind it: the audio source died, no sound is reaching it, only quiet room sound
// is arriving, or speech is arriving and nothing comes back. Counting buffers pushed could never tell those apart — a dead track
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
    // Sound keeps arriving throughout — a live microphone in a room where nobody has spoken yet.
    for (const second of [5, 300, 595]) {
      at(second)
      await sendAudio(3)
    }

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
    // The microphone carries on — stopping a screen share does not stop the room.
    at(145)
    await speak(15)

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
    await speak(15)
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

  // Review round 2 should-fix: the state read happens inside commitTranscript's argument list,
  // AFTER the one-shot guard is set — so a throw there loses the transcript outright and the retry
  // is refused. Same shape as BUG-74, one frame further on.
  it('still commits the transcript when a track state read throws', async () => {
    const view = await startCloudRecording()
    at(5)
    await sendAudio(3)
    at(10)
    await emitResult(view, 'every word of this must survive', 9)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    breakTrackState(micTrack, 'readyState')

    at(40)
    act(() => view.result.current.stopRecording())

    await waitFor(() => expect(commits).toHaveLength(1))
    expect(commits[0].transcriptText).toContain('every word of this must survive')
  })

  it('keeps reporting the stall when a track state read throws', async () => {
    const view = await startCloudRecording()
    at(5)
    await sendAudio(3)
    at(10)
    await emitResult(view, 'Hello', 9)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    breakTrackState(micTrack, 'muted')
    at(145)
    await speak(15)

    at(150)
    tickSecond()

    expect(view.result.current.stall).toEqual({ kind: 'noWords', stalledForSeconds: 140 })
  })

  // The mirror of the spec above, and the one that pins the ORDER of the teardown: releasing the
  // microphone ends every track, so a reading taken after it would report a dead source on every
  // recording that ever errored. The error path saves its draft after the teardown, so this is the
  // only place the order is observable.
  it('does not invent a dead source when the stream errors on a healthy microphone', async () => {
    const view = await startCloudRecording()
    at(5)
    await sendAudio(3)
    at(10)
    await emitResult(view, 'Captured', 9)

    at(60)
    streams[0].push({ kind: 'error', error: namedError('NetworkError', 'socket closed') })

    await waitFor(() => expect(view.result.current.status).toBe('error'))
    await waitFor(() => expect(drafts).toHaveLength(1))
    expect(drafts[0].health).toMatchObject({ endReason: 'error', sourceEnded: false })
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

  // Review round 2 must-fix, and the reason this slice exists. The speech service delivers a
  // finalised result AFTER the audio it covers, so a capture that dies during a pause leaves its
  // last sound of audio timestamped LATER than the last words — which is the likely shape of the
  // 28.7-minute freeze. Requiring silence to predate the last words disqualified exactly that
  // recording: measured, audio dead from 65 s reported "not silent" at 200 s, 600 s, 1800 s and
  // 4000 s while the silence figure climbed past an hour.
  it('reports silence that began AFTER the last words — the ordering the speech service produces', async () => {
    const view = await startCloudRecording()
    at(60)
    await emitResult(view, 'the last thing anyone said', 59)
    at(65)
    await sendAudio(3)
    at(66)
    await sendAudio(5, 0)

    at(185)
    tickSecond()

    expect(view.result.current.stall).toEqual({ kind: 'noSound', stalledForSeconds: 125 })
  })

  it('tells the server the audio is silent on that same ordering', async () => {
    const view = await startCloudRecording()
    at(60)
    await emitResult(view, 'the last thing anyone said', 59)
    at(65)
    await sendAudio(3)
    at(66)
    await sendAudio(5, 0)

    at(200)
    tick()

    await waitFor(() => expect(drafts).toHaveLength(1))
    expect(drafts[0].health).toMatchObject({ audioSilent: true, secondsSilent: 135 })
  })

  // Settling one way as the evidence arrives, never back and forth: sound after the last words
  // reads as sound-but-no-words until the silence has itself lasted the window, and from there it
  // stays no-sound unless real sound returns.
  it('settles from no-words to no-sound as the silence lengthens, and never back', async () => {
    const view = await startCloudRecording()
    at(10)
    await emitResult(view, 'Hello', 9)
    at(100)
    await speak(15)
    at(101)
    await sendAudio(3, 0)

    for (const second of [130, 200, 219]) {
      at(second)
      tickSecond()
      expect(view.result.current.stall!.kind).toBe('noWords')
    }
    for (const second of [220, 400, 4000]) {
      at(second)
      tickSecond()
      expect(view.result.current.stall!.kind).toBe('noSound')
    }
  })

  it('goes back to no-words once real sound returns for long enough', async () => {
    const view = await startCloudRecording()
    at(10)
    await emitResult(view, 'Hello', 9)
    at(100)
    await sendAudio(3, 0)
    at(400)
    tickSecond()
    expect(view.result.current.stall!.kind).toBe('noSound')

    at(410)
    await speak(15)
    tickSecond()

    expect(view.result.current.stall!.kind).toBe('noWords')
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
    await speak(15)

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
    await speak(15)
    tickSecond()

    expect(view.result.current.stall).toEqual({ kind: 'noWords', stalledForSeconds: 150 })
  })
})

// BUG-85 — when a transcript stops, the record has to say whether people were still speaking. The
// silence floor catches only a dead source, so a quiet room used to read as "sound is arriving, but
// nothing is coming back from transcription" — the claim of a fault. On 2026-09-18 the notice fired
// exactly that way on real hardware, in a room where nobody spoke from 2:00 to 5:00.
describe('telling a quiet room from a transcription stall', () => {
  it('calls speech-level audio with no words a transcription stall', async () => {
    const view = await startCloudRecording()
    at(10)
    await emitResult(view, 'Hello', 9)
    at(60)
    await speak(15)
    at(150)
    await sendAudio(5, ROOM_TONE)

    at(200)
    tickSecond()

    expect(view.result.current.stall).toEqual({ kind: 'noWords', stalledForSeconds: 190 })
  })

  // Review round 2 must-fix: the boundary itself. The runbook states the rule as "10 s or more of
  // speech with no words is a transcription stall, under 10 s is a quiet room", and the nearest
  // other spec steps straight past it from 5 s to 15 s. Exactly the minimum is the stall side.
  it('calls exactly the speech minimum a transcription stall, not a quiet room', async () => {
    const view = await startCloudRecording()
    at(10)
    await emitResult(view, 'Hello', 9)
    at(60)
    await speak(MIN_SPEECH_SECONDS)
    at(130)
    await sendAudio(5, ROOM_TONE)

    at(200)
    tickSecond()

    expect(view.result.current.stall).toEqual({ kind: 'noWords', stalledForSeconds: 190 })
  })

  // The 2026-09-18 hardware test, replayed: words until 2:00, then a live microphone in a silent
  // room. The notice appeared at 4:15 claiming a transcription fault. It must say quiet room.
  it('calls room-level audio with no words a quiet room — the 2026-09-18 hardware test', async () => {
    const view = await startCloudRecording()
    at(60)
    await speak(20)
    at(120)
    await emitResult(view, 'can you hear me', 119)
    // A realistic stretch of room tone — far more than the speech minimum, so counting it as speech
    // would flip this to a stall.
    for (const second of [130, 180, 240]) {
      at(second)
      await sendAudio(100, ROOM_TONE)
    }

    at(255)
    tickSecond()

    expect(view.result.current.stall).toEqual({ kind: 'quiet', stalledForSeconds: 135 })
  })

  it('still calls it a quiet room when one short remark breaks the silence', async () => {
    const view = await startCloudRecording()
    at(10)
    await emitResult(view, 'Hello', 9)
    at(40)
    await sendAudio(100, ROOM_TONE)
    at(80)
    await speak(3)
    at(120)
    await sendAudio(100, ROOM_TONE)

    at(200)
    tickSecond()

    expect(view.result.current.stall).toEqual({ kind: 'quiet', stalledForSeconds: 190 })
  })

  // The loudness window restarts at the same instant the stall does — the last words — so the two
  // can never describe different stretches of the meeting.
  it('does not count speech the last words already covered', async () => {
    const view = await startCloudRecording()
    at(5)
    await speak(30)
    at(40)
    await emitResult(view, 'everything said so far', 39)
    at(60)
    await sendAudio(20, ROOM_TONE)

    at(170)
    tickSecond()
    expect(view.result.current.stall).toEqual({ kind: 'quiet', stalledForSeconds: 130 })

    tick()
    await waitFor(() => expect(drafts).toHaveLength(1))
    expect(drafts[0].health!.speechSeconds).toBe(0)
    expect(drafts[0].health!.loudestDbfs).toBeCloseTo(-50.5, 1)
  })

  // Speech seconds only grow within an episode, so the reading settles one way as evidence arrives.
  it('settles from quiet room to transcription stall as speech accumulates, and never back', async () => {
    const view = await startCloudRecording()
    at(10)
    await emitResult(view, 'Hello', 9)
    at(20)
    await sendAudio(20, ROOM_TONE)

    at(130)
    tickSecond()
    expect(view.result.current.stall!.kind).toBe('quiet')

    at(140)
    await speak(5)
    tickSecond()
    expect(view.result.current.stall!.kind).toBe('quiet')

    at(150)
    await speak(10)
    tickSecond()
    expect(view.result.current.stall!.kind).toBe('noWords')

    for (const second of [200, 400, 4000]) {
      at(second)
      await sendAudio(5, ROOM_TONE)
      tickSecond()
      expect(view.result.current.stall!.kind).toBe('noWords')
    }
  })

  it('carries the loudness of the stalled stretch to the server', async () => {
    const view = await startCloudRecording()
    at(10)
    await emitResult(view, 'Hello', 9)
    at(60)
    await speak(12)
    at(150)
    await sendAudio(5, ROOM_TONE)

    at(200)
    tick()

    await waitFor(() => expect(drafts).toHaveLength(1))
    expect(drafts[0].health).toMatchObject({ endReason: 'stalled', loudestDbfs: -14, speechSeconds: 12 })
  })

  // The notice and the record read the same window, so at any instant they agree.
  it('reports the same speech in the record as the notice classified on', async () => {
    const view = await startCloudRecording()
    at(10)
    await emitResult(view, 'Hello', 9)
    at(60)
    await speak(4)
    at(150)
    await sendAudio(5, ROOM_TONE)

    at(200)
    tickSecond()
    tick()

    await waitFor(() => expect(drafts).toHaveLength(1))
    expect(view.result.current.stall!.kind).toBe('quiet')
    expect(drafts[0].health!.speechSeconds).toBe(4)
  })

  // Silence is still its own, stronger case: a quiet room is sound, zero-filled buffers are not.
  it('still calls zero-filled buffers no sound, not a quiet room', async () => {
    const view = await startCloudRecording()
    at(10)
    await emitResult(view, 'Hello', 9)
    at(20)
    await sendAudio(20, 0)

    at(200)
    tickSecond()

    expect(view.result.current.stall).toEqual({ kind: 'noSound', stalledForSeconds: 190 })
  })
})

// BUG-85, 2026-10-06: a USB dock dropped off the laptop for two seconds when the screen flicked off,
// taking the webcam microphone on it. The device was back almost at once; the app never asked for
// it again and recorded 23 minutes of digital silence. These specs drive that unplug and replug.
describe('a microphone that drops out mid-recording', () => {
  const sameDevice = { audio: { deviceId: { exact: 'dock-webcam-mic' } } }

  function lastSource() {
    return sources[sources.length - 1]
  }

  it('asks for the same microphone again and keeps the recording going when it is back', async () => {
    const view = await startCloudRecording()
    at(5)
    await emitResult(view, 'Before the dock dropped', 4)
    micAnswers = [{ kind: 'device', deviceId: 'dock-webcam-mic' }]

    at(10)
    act(() => micTrack.end())

    await waitFor(() => expect(reacquiredTracks).toHaveLength(1))
    expect(getUserMedia).toHaveBeenLastCalledWith(sameDevice)
    await waitFor(() => expect(lastSource().stream.getAudioTracks()[0]).toBe(reacquiredTracks[0]))
    expect(lastSource().connect).toHaveBeenCalledWith(workletNode)
    expect(sources[0].disconnect).toHaveBeenCalled()
    expect(view.result.current.status).toBe('recording')
    expect(streams).toHaveLength(1)

    at(20)
    await emitResult(view, 'After it came back', 19)
  })

  it('does not report a dead source once the microphone is back', async () => {
    const view = await startCloudRecording()
    at(5)
    await emitResult(view, 'Hello', 4)
    micAnswers = [{ kind: 'device', deviceId: 'dock-webcam-mic' }]
    act(() => micTrack.end())
    await waitFor(() => expect(reacquiredTracks).toHaveLength(1))

    at(140)
    tickSecond()
    expect(view.result.current.stall?.kind).not.toBe('sourceEnded')
  })

  it('tells the server how many times the microphone was reconnected', async () => {
    const view = await startCloudRecording()
    at(5)
    await emitResult(view, 'Hello', 4)
    micAnswers = [{ kind: 'device', deviceId: 'dock-webcam-mic' }]
    act(() => micTrack.end())
    await waitFor(() => expect(reacquiredTracks).toHaveLength(1))

    at(40)
    act(() => view.result.current.stopRecording())
    await waitFor(() => expect(commits).toHaveLength(1))
    expect(commits[0].health).toMatchObject({ sourceEnded: false, microphoneReconnects: 1 })
  })

  it('releases the lost microphone it replaced', async () => {
    await startCloudRecording()
    micAnswers = [{ kind: 'device', deviceId: 'dock-webcam-mic' }]
    act(() => micTrack.end())
    await waitFor(() => expect(reacquiredTracks).toHaveLength(1))
    await waitFor(() => expect(micTrackStop).toHaveBeenCalled())
  })

  it('keeps asking once a second while the microphone is missing, and reconnects when it returns', async () => {
    await startCloudRecording()
    micAnswers = [{ kind: 'missing' }, { kind: 'missing' }, { kind: 'device', deviceId: 'dock-webcam-mic' }]

    act(() => micTrack.end())
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2))
    tickSecond()
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(3))
    expect(reacquiredTracks).toHaveLength(0)
    tickSecond()
    await waitFor(() => expect(reacquiredTracks).toHaveLength(1))
    expect(getUserMedia).toHaveBeenLastCalledWith(sameDevice)

    // Back, so the asking stops.
    tickSecond()
    tickSecond()
    expect(getUserMedia).toHaveBeenCalledTimes(4)
  })

  it('falls back to the default microphone when the same one has not come back after ten tries', async () => {
    await startCloudRecording()
    micAnswers = [...Array.from({ length: 10 }, () => ({ kind: 'missing' as const })), { kind: 'device', deviceId: 'built-in-mic' }]

    act(() => micTrack.end())
    for (let attempt = 2; attempt <= 10; attempt++) {
      await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(attempt))
      tickSecond()
    }
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(11))
    expect(getUserMedia).toHaveBeenLastCalledWith(sameDevice)
    tickSecond()
    await waitFor(() => expect(reacquiredTracks).toHaveLength(1))
    expect(getUserMedia).toHaveBeenLastCalledWith({ audio: true })
  })

  it('notices a microphone that died without saying so, on the next second', async () => {
    await startCloudRecording()
    micAnswers = [{ kind: 'device', deviceId: 'dock-webcam-mic' }]

    // Dead, but no `ended` event: the backstop is the once-a-second clock.
    micTrack.readyState = 'ended'
    tickSecond()
    await waitFor(() => expect(reacquiredTracks).toHaveLength(1))
  })

  it('feeds a reconnected microphone into the call-audio mix, not around it', async () => {
    await startCloudRecording(undefined, true)
    micAnswers = [{ kind: 'device', deviceId: 'dock-webcam-mic' }]
    act(() => micTrack.end())
    await waitFor(() => expect(reacquiredTracks).toHaveLength(1))
    await waitFor(() => expect(lastSource().stream.getAudioTracks()[0]).toBe(reacquiredTracks[0]))
    expect(lastSource().connect).toHaveBeenCalledWith(mixer)
    expect(lastSource().connect).not.toHaveBeenCalledWith(workletNode)
  })

  it("feeds your voice channel from the reconnected microphone when the drop lands while the on-device engine is starting", async () => {
    const nodes: { connect: ReturnType<typeof vi.fn>; port: { onmessage: unknown } }[] = []
    vi.stubGlobal('AudioWorkletNode', vi.fn().mockImplementation(function () {
      const node = { connect: vi.fn(), port: { onmessage: null } }
      nodes.push(node)
      return node
    }))
    let engineStarted!: () => void
    ;(window as unknown as { desktop?: unknown }).desktop = {
      isDesktop: true,
      platform: 'win32',
      local: {
        getStatus: async () => ({ modelReady: true }),
        start: () => new Promise<void>((resolve) => { engineStarted = resolve }),
        onLive: () => () => {},
        onError: () => () => {},
        pushPcm: () => {},
        finish: async () => null,
        discard: () => {},
      },
    }
    localStorage.setItem('note-taker-transcription-mode', 'local')
    try {
      const view = renderHook(() => useTranscription('note-1'))
      act(() => view.result.current.startRecording(true, false))
      await waitFor(() => expect(engineStarted).toBeDefined())

      micAnswers = [{ kind: 'device', deviceId: 'dock-webcam-mic' }]
      act(() => micTrack.end())
      await waitFor(() => expect(lastSource().stream.getAudioTracks()[0]).toBe(reacquiredTracks[0]))

      await act(async () => { engineStarted() })
      await waitFor(() => expect(view.result.current.status).toBe('recording'))
      const me = nodes[1]
      expect(lastSource().connect).toHaveBeenCalledWith(me)
      expect(sources[0].connect).not.toHaveBeenCalledWith(me)
      view.unmount()
    } finally {
      delete (window as unknown as { desktop?: unknown }).desktop
      localStorage.removeItem('note-taker-transcription-mode')
    }
  })

  it("also feeds a reconnected microphone into the on-device engine's own channel for your voice", async () => {
    // On-device mode with call audio records "me" and "them" separately, so the microphone feeds a
    // third node there. A reconnection that skipped it would label the rest of the call as silence.
    const nodes: { connect: ReturnType<typeof vi.fn>; port: { onmessage: unknown } }[] = []
    vi.stubGlobal('AudioWorkletNode', vi.fn().mockImplementation(function () {
      const node = { connect: vi.fn(), port: { onmessage: null } }
      nodes.push(node)
      return node
    }))
    ;(window as unknown as { desktop?: unknown }).desktop = {
      isDesktop: true,
      platform: 'win32',
      local: {
        getStatus: async () => ({ modelReady: true }),
        start: async () => {},
        onLive: () => () => {},
        onError: () => () => {},
        pushPcm: () => {},
        finish: async () => null,
        discard: () => {},
      },
    }
    localStorage.setItem('note-taker-transcription-mode', 'local')
    try {
      const view = renderHook(() => useTranscription('note-1'))
      act(() => view.result.current.startRecording(true, false))
      await waitFor(() => expect(view.result.current.status).toBe('recording'))
      expect(nodes).toHaveLength(3)
      const [, me, them] = nodes

      micAnswers = [{ kind: 'device', deviceId: 'dock-webcam-mic' }]
      act(() => micTrack.end())
      await waitFor(() => expect(reacquiredTracks).toHaveLength(1))
      await waitFor(() => expect(lastSource().stream.getAudioTracks()[0]).toBe(reacquiredTracks[0]))
      expect(lastSource().connect).toHaveBeenCalledWith(mixer)
      expect(lastSource().connect).toHaveBeenCalledWith(me)
      expect(lastSource().connect).not.toHaveBeenCalledWith(them)
      view.unmount()
    } finally {
      delete (window as unknown as { desktop?: unknown }).desktop
      localStorage.removeItem('note-taker-transcription-mode')
    }
  })

  it('asks for the physical microphone, not the system default it was first opened through', async () => {
    // A recording asks for no particular device, so its track reports Chromium's virtual "default".
    // Asking for that again straight after a drop gets whatever Windows promoted in the meantime —
    // the laptop's own microphone — and it would never go back to the dock's.
    micTrack.getSettings = () => ({ deviceId: 'default', groupId: 'group-dock-webcam-mic' })
    await startCloudRecording()
    micAnswers = [{ kind: 'device', deviceId: 'dock-webcam-mic' }]

    act(() => micTrack.end())
    await waitFor(() => expect(reacquiredTracks).toHaveLength(1))
    expect(getUserMedia).toHaveBeenLastCalledWith(sameDevice)
  })

  it('asks again when the browser never answers a request, instead of waiting for ever', async () => {
    await startCloudRecording()
    micAnswers = [
      { kind: 'held', deviceId: 'dock-webcam-mic', until: new Promise<void>(() => {}) },
      { kind: 'device', deviceId: 'dock-webcam-mic' },
    ]
    at(10)
    act(() => micTrack.end())
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2))

    at(12)
    tickSecond()
    expect(getUserMedia).toHaveBeenCalledTimes(2)

    at(15)
    tickSecond()
    await waitFor(() => expect(reacquiredTracks).toHaveLength(1))
  })

  it('releases a late answer to an abandoned request instead of swapping it over a working microphone', async () => {
    const view = await startCloudRecording()
    at(5)
    await emitResult(view, 'Hello', 4)
    let lateAnswer!: () => void
    micAnswers = [
      { kind: 'held', deviceId: 'dock-webcam-mic', until: new Promise<void>((r) => { lateAnswer = r }) },
      { kind: 'device', deviceId: 'dock-webcam-mic' },
    ]
    at(10)
    act(() => micTrack.end())
    at(15)
    tickSecond()
    await waitFor(() => expect(reacquiredTracks).toHaveLength(1))
    await waitFor(() => expect(lastSource().stream.getAudioTracks()[0]).toBe(reacquiredTracks[0]))
    const sourcesBefore = sources.length

    await act(async () => { lateAnswer() })
    await waitFor(() => expect(reacquiredTracks).toHaveLength(2))
    await waitFor(() => expect(reacquiredTracks[1].readyState).toBe('ended'))
    expect(sources).toHaveLength(sourcesBefore)
    expect(reacquiredTracks[0].readyState).toBe('live')

    at(40)
    act(() => view.result.current.stopRecording())
    await waitFor(() => expect(commits).toHaveLength(1))
    expect(commits[0].health).toMatchObject({ microphoneReconnects: 1 })
  })

  it('leaves at most one unanswered request behind, however long the browser stays stuck', async () => {
    await startCloudRecording()
    const never = new Promise<void>(() => {})
    micAnswers = [
      { kind: 'held', deviceId: 'dock-webcam-mic', until: never },
      { kind: 'held', deviceId: 'dock-webcam-mic', until: never },
      { kind: 'held', deviceId: 'dock-webcam-mic', until: never },
    ]
    at(10)
    act(() => micTrack.end())
    for (let second = 11; second <= 40; second++) {
      at(second)
      tickSecond()
    }
    // The first request, plus one more after it was abandoned — not one every five seconds.
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(3))
    expect(getUserMedia).toHaveBeenCalledTimes(3)
  })

  it('reconnects again if the microphone drops a second time', async () => {
    const view = await startCloudRecording()
    at(5)
    await emitResult(view, 'Hello', 4)
    micAnswers = [{ kind: 'device', deviceId: 'dock-webcam-mic' }]
    act(() => micTrack.end())
    await waitFor(() => expect(reacquiredTracks).toHaveLength(1))
    await waitFor(() => expect(lastSource().stream.getAudioTracks()[0]).toBe(reacquiredTracks[0]))

    micAnswers = [{ kind: 'device', deviceId: 'dock-webcam-mic' }]
    act(() => reacquiredTracks[0].end())
    // At once, on the replacement's own `ended` — not a second later from the clock.
    expect(getUserMedia).toHaveBeenCalledTimes(3)
    await waitFor(() => expect(reacquiredTracks).toHaveLength(2))
    await waitFor(() => expect(lastSource().stream.getAudioTracks()[0]).toBe(reacquiredTracks[1]))

    at(40)
    act(() => view.result.current.stopRecording())
    await waitFor(() => expect(commits).toHaveLength(1))
    expect(commits[0].health).toMatchObject({ sourceEnded: false, microphoneReconnects: 2 })
  })

  it('never asks for a microphone after Stop — releasing it is not losing it', async () => {
    const view = await startCloudRecording()
    at(10)
    act(() => view.result.current.stopRecording())
    act(() => micTrack.end())
    tickSecond()
    expect(getUserMedia).toHaveBeenCalledTimes(1)
  })

  it('releases a microphone that only answers after Stop was pressed', async () => {
    const view = await startCloudRecording()
    let answer!: () => void
    micAnswers = [{ kind: 'held', deviceId: 'dock-webcam-mic', until: new Promise<void>((r) => { answer = r }) }]
    act(() => micTrack.end())
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2))

    at(10)
    act(() => view.result.current.stopRecording())
    await act(async () => { answer() })

    await waitFor(() => expect(reacquiredTracks).toHaveLength(1))
    await waitFor(() => expect(reacquiredTracks[0].readyState).toBe('ended'))
    expect(sources.some((source) => (source.stream.getAudioTracks()[0] as unknown) === reacquiredTracks[0])).toBe(false)
  })
})
