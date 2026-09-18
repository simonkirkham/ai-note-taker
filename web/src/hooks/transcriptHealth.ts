import type { TranscriptEndReason, TranscriptEngine, TranscriptHealth } from '../api/transcription';

// TI-99: how long a recording may go without new finalised text before the checkpoint reports a
// stall, and how often a continuing stall is re-reported.
const STALL_AFTER_MS = 120_000;
const STALL_REPEAT_MS = 5 * 60_000;

const MAX_ERROR_TEXT = 200;
const PCM_BYTES_PER_SAMPLE = 2;

// BUG-85: the level below which the audio this app TRANSMITS is all-zero bytes.
//
// It is not a judgement about loudness — it is where the encoder stops. Captured Float32 samples
// are quantised to 16-bit PCM (`floatTo16BitPcm`: round(x × 32767)), so anything under half a step
// rounds to zero and the transcription service receives digital silence whatever the analogue
// signal was. One whole step — 1/32767, about −90 dBFS — is the first amplitude that reliably
// survives, and `transcriptSilence.test.ts` measures that against the real encoder.
//
// A dead or muted track delivers buffers of exact zeros at the normal rate, so it lands far below
// this; room tone from a live microphone sits around −60 dBFS, about a thousand times above it.
export const SILENT_PEAK = 1 / 32767;

// How long every captured sample must stay under that floor before the audio counts as silent.
// Deliberately as long as the no-text window: two minutes of literally zero transmitted audio is
// not a pause in a conversation, and the notice it drives only ever appears alongside no new text.
const SILENCE_WINDOW_MS = 120_000;

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
  private sourceEnded = false;
  private mutedTracks = 0;
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
    this.sourceEnded = false;
    this.mutedTracks = 0;
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

  // BUG-85: a captured track died — the microphone was unplugged, the screen share was stopped, the
  // device was taken by something else. Latched: it does not come back on its own.
  sourceTrackEnded(): void {
    this.sourceEnded = true;
  }

  // Muting is reversible, so it is counted rather than latched — several tracks are captured and
  // any one of them being muted is a hole in what is heard.
  sourceTrackMuted(muted: boolean): void {
    this.mutedTracks = Math.max(0, this.mutedTracks + (muted ? 1 : -1));
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

  private isSilent(now: number): boolean {
    return this.hasStarted && now - this.silentSince() >= SILENCE_WINDOW_MS;
  }

  // BUG-85: why the transcript has stopped growing, or null while it is healthy. Read once a
  // second by the recording UI; nothing here allocates or scans.
  stallState(now: number): TranscriptionStall | undefined {
    if (!this.hasStarted || this.end) return undefined;
    const since = this.lastTextAt || this.startedAt;
    if (now - since < STALL_AFTER_MS) return undefined;
    const stalledForSeconds = Math.floor((now - since) / 1000);
    // Ordered by how conclusive the evidence is: a dead track explains everything below it, and
    // silence explains no words.
    if (this.sourceEnded) return { kind: 'sourceEnded', stalledForSeconds };
    if (this.mutedTracks > 0 || this.isSilent(now)) return { kind: 'noSound', stalledForSeconds };
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
      sourceEnded: this.sourceEnded,
      sourceMuted: this.mutedTracks > 0,
      audioSilent: this.isSilent(now),
      secondsSilent: this.hasStarted ? seconds(now - this.silentSince()) : null,
    };
  }
}
