import type { TranscriptEndReason, TranscriptEngine, TranscriptHealth } from '../api/transcription';

// TI-99: how long a recording may go without new finalised text before the checkpoint reports a
// stall, and how often a continuing stall is re-reported.
const STALL_AFTER_MS = 120_000;
const STALL_REPEAT_MS = 5 * 60_000;

const MAX_ERROR_TEXT = 200;
const PCM_BYTES_PER_SAMPLE = 2;

// BUG-85: the level at which captured audio starts counting as sound.
//
// It is not a judgement about loudness — it is pinned to where the encoder stops. Captured Float32
// samples are quantised to 16-bit PCM (`floatTo16BitPcm`: round(x × 32767)), so the encoder's own
// floor is half a step, 0.5/32767: anything under that rounds to zero and the transcription
// service receives digital silence whatever the analogue signal was.
//
// This sits at one whole step — 1/32767, about −90 dBFS — deliberately 6 dB above that floor, so a
// signal that only rounds to ±1 on some frames is not counted as sound. `transcriptSilence.test.ts`
// measures both numbers against the real encoder rather than restating them.
//
// A dead or muted track delivers buffers of exact zeros at the normal rate, so it lands far below
// this; room tone from a live microphone sits around −60 dBFS, about a thousand times above it.
export const SILENT_PEAK = 1 / 32767;

/** Why the transcript has stopped growing, in the order the evidence settles it. */
export type TranscriptionStallKind = 'sourceEnded' | 'noSound' | 'noWords';

export interface TranscriptionStall {
  kind: TranscriptionStallKind;
  /** Seconds since the last finalised text, or since the recording started if none ever arrived. */
  stalledForSeconds: number;
}

/** The loudest sample in a captured frame, either direction. */
export function peakOf(frame: Float32Array): number {
  let peak = 0;
  for (let i = 0; i < frame.length; i++) {
    const level = frame[i] < 0 ? -frame[i] : frame[i];
    if (level > peak) peak = level;
  }
  return peak;
}

function seconds(ms: number): number {
  return Math.round(ms / 100) / 10;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

// Anything can be thrown — including values with no string form (Object.create(null)) or an Error
// whose name was overwritten — so every read is type-checked and the whole thing is guarded.
function describeError(error: unknown): { errorName: string; errorMessage: string } {
  let errorName: string = error === null ? 'null' : typeof error;
  let errorMessage = '';
  try {
    if (typeof error === 'object' && error !== null) {
      const { name, message } = error as { name?: unknown; message?: unknown };
      if (typeof name === 'string') errorName = name;
      if (typeof message === 'string') errorMessage = message;
    } else {
      errorMessage = String(error);
    }
  } catch {
    // An accessor that throws leaves the defaults.
  }
  return { errorName: errorName.slice(0, MAX_ERROR_TEXT), errorMessage: errorMessage.slice(0, MAX_ERROR_TEXT) };
}

interface EndState {
  reason: TranscriptEndReason;
  errorName?: string;
  errorMessage?: string;
}

// Plain mutable tracker held in a ref: every update is a field write, so recording health never
// causes a re-render. `snapshot` turns it into the record sent with each transcript save.
export class TranscriptHealthTracker {
  private engine: TranscriptEngine = 'cloud';
  private sampleRate = 16000;
  private startedAt = 0;
  private streams = 0;
  // Coverage is per stream (the service's EndTime restarts at 0 on a new stream), so finished
  // streams are banked and the open stream's furthest EndTime is added on top.
  private coveredByEndedStreams = 0;
  private coveredByOpenStream = 0;
  private hasCoverage = false;
  private lastTextAt = 0;
  private audioBytes = 0;
  private lastAudioAt = 0;
  private lastStallReportAt = 0;
  private end: EndState | null = null;
  // BUG-85: what the captured audio is actually doing, as opposed to how many buffers were pushed.
  //
  // The tracks are held and read LIVE, never latched from events. A latch cannot self-correct: a
  // source that ends and is replaced, or one duplicated mute event, would otherwise mark the rest
  // of the meeting — and every later save would ride up to the server at Warning, poisoning the one
  // piece of evidence this exists to collect.
  private tracks: MediaStreamTrack[] = [];
  private releasedEnded = false;
  private releasedMuted = false;
  private released = false;
  private lastLoudAt = 0;

  reset(): void {
    this.engine = 'cloud';
    this.sampleRate = 16000;
    this.startedAt = 0;
    this.streams = 0;
    this.coveredByEndedStreams = 0;
    this.coveredByOpenStream = 0;
    this.hasCoverage = false;
    this.lastTextAt = 0;
    this.audioBytes = 0;
    this.lastAudioAt = 0;
    this.lastStallReportAt = 0;
    this.end = null;
    this.tracks = [];
    this.releasedEnded = false;
    this.releasedMuted = false;
    this.released = false;
    this.lastLoudAt = 0;
  }

  recordingStarted(engine: TranscriptEngine, sampleRate: number, now: number): void {
    this.engine = engine;
    this.sampleRate = sampleRate;
    this.startedAt = now;
  }

  // False until capture is running — a failure before that (credentials refused, microphone
  // denied) has no recording to report on.
  get hasStarted(): boolean {
    return this.startedAt !== 0;
  }

  streamOpened(): void {
    this.coveredByEndedStreams += this.coveredByOpenStream;
    this.coveredByOpenStream = 0;
    this.streams += 1;
  }

  // `endTime` is the service's own offset (seconds into the stream) for the end of the result.
  textArrived(now: number, endTime?: number): void {
    this.lastTextAt = now;
    this.lastStallReportAt = 0;
    if (endTime !== undefined && Number.isFinite(endTime)) {
      this.coveredByOpenStream = Math.max(this.coveredByOpenStream, endTime);
      this.hasCoverage = true;
    }
  }

  audioSent(bytes: number, now: number): void {
    this.audioBytes += bytes;
    this.lastAudioAt = now;
  }

  // BUG-85: watch a captured stream's AUDIO tracks. Audio only, deliberately: the screen share is
  // requested with video purely because Chromium refuses an audio-only capture, and clicking "Stop
  // sharing" ends that video track while the microphone carries on. Reading it as a dead audio
  // source mislabels the notice and marks every later save as a failure.
  watchStream(stream: MediaStream | null): void {
    if (!stream) return;
    try {
      this.tracks.push(...stream.getAudioTracks());
    } catch (err) {
      console.warn('Reading the captured audio tracks failed.', err);
    }
  }

  // Capture is being torn down. `track.stop()` ends every track, so the live reads would all say
  // "source ended" from here on — the last live reading is taken first and reported from then on.
  // Called before the tracks are stopped; a save that happens after teardown (the error path saves
  // its draft after releasing the microphone) still reports what was true while recording.
  releaseTracks(): void {
    if (!this.released) {
      this.releasedEnded = this.anyTrackEnded();
      this.releasedMuted = this.anyTrackMuted();
      this.released = true;
    }
    this.tracks = [];
  }

  private anyTrackEnded(): boolean {
    if (this.tracks.length === 0) return this.releasedEnded;
    return this.tracks.some((track) => track.readyState === 'ended');
  }

  private anyTrackMuted(): boolean {
    if (this.tracks.length === 0) return this.releasedMuted;
    return this.tracks.some((track) => track.muted);
  }

  // The loudest sample of a captured frame. Anything at or above the transmit floor is sound; below
  // it, what leaves this machine is indistinguishable from a zero-filled buffer.
  audioLevel(peak: number, now: number): void {
    if (peak >= SILENT_PEAK) this.lastLoudAt = now;
  }

  // Silence is measured from the last sample above the floor, or from the start of the recording
  // when there has never been one — no audio at all is the loudest case of no sound, not an
  // absence of evidence.
  private silentSince(): number {
    return this.lastLoudAt || this.startedAt;
  }

  // When the transcript stopped growing: the last finalised text, or the start of the recording.
  // Both the stall window and the silence question are measured from this one instant, so the two
  // can never disagree.
  private stalledSince(): number {
    return this.lastTextAt || this.startedAt;
  }

  // Silent for THIS episode: no sample above the floor has arrived since the transcript last grew.
  //
  // Deliberately not a window of its own. A second clock could say "sound is arriving" while the
  // audio had been digitally silent for 90 seconds and then flip mid-notice. Sound arriving after
  // the last words settles the episode as sound-but-no-words and it stays settled — a source that
  // dies part-way through the gap is caught by the track reads above, which is the sharper signal.
  private isSilent(now: number): boolean {
    return this.hasStarted && now - this.stalledSince() >= STALL_AFTER_MS && this.lastLoudAt <= this.stalledSince();
  }

  // BUG-85: why the transcript has stopped growing, or undefined while it is healthy. Read once a
  // second by the recording UI; nothing here allocates or scans.
  stallState(now: number): TranscriptionStall | undefined {
    if (!this.hasStarted || this.end) return undefined;
    const since = this.stalledSince();
    if (now - since < STALL_AFTER_MS) return undefined;
    const stalledForSeconds = Math.floor((now - since) / 1000);
    // Ordered by how conclusive the evidence is: a dead track explains everything below it, and
    // silence explains no words.
    if (this.anyTrackEnded()) return { kind: 'sourceEnded', stalledForSeconds };
    if (this.anyTrackMuted() || this.isSilent(now)) return { kind: 'noSound', stalledForSeconds };
    // Nothing has ever been transcribed, so nothing can be said to have stopped: a meeting that has
    // not started, someone joining, two minutes of reading. Sound is arriving and the source is
    // alive — there is no evidence of a fault, and saying there is would make a fine recording
    // worse by inviting a restart.
    if (this.lastTextAt === 0) return undefined;
    return { kind: 'noWords', stalledForSeconds };
  }

  // Latches the first terminal outcome, so a commit that happens later (leaving the note after an
  // error) still reports why the stream actually ended. Total: a thrown value can be anything.
  ended(reason: TranscriptEndReason, error?: unknown): void {
    if (this.end) return;
    this.end = reason === 'error' ? { reason, ...describeError(error) } : { reason };
  }

  // A stall is reported once when no text has arrived for STALL_AFTER_MS, then at most every
  // STALL_REPEAT_MS while it continues; new text ends the episode.
  stallDue(now: number): boolean {
    const since = this.lastTextAt || this.startedAt;
    if (!since || now - since < STALL_AFTER_MS) return false;
    return this.lastStallReportAt === 0 || now - this.lastStallReportAt >= STALL_REPEAT_MS;
  }

  stallReported(now: number): void {
    this.lastStallReportAt = now;
  }

  snapshot(reason: TranscriptEndReason, now: number): TranscriptHealth {
    const end = this.end ?? { reason };
    return {
      engine: this.engine,
      endReason: end.reason,
      errorName: end.errorName,
      errorMessage: end.errorMessage,
      coveredSeconds: this.hasCoverage ? round2(this.coveredByEndedStreams + this.coveredByOpenStream) : null,
      secondsSinceLastText: this.lastTextAt ? seconds(now - this.lastTextAt) : null,
      audioSecondsSent: round2(this.audioBytes / PCM_BYTES_PER_SAMPLE / this.sampleRate),
      secondsSinceLastAudio: this.lastAudioAt ? seconds(now - this.lastAudioAt) : null,
      streamCount: this.streams,
      sourceEnded: this.anyTrackEnded(),
      sourceMuted: this.anyTrackMuted(),
      audioSilent: this.isSilent(now),
      // Clamped: a clock that steps backwards mid-recording must not report a negative duration.
      secondsSilent: this.hasStarted ? seconds(Math.max(0, now - this.silentSince())) : null,
    };
  }
}
