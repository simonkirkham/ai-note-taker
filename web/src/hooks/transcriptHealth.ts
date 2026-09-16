import type { TranscriptEndReason, TranscriptEngine, TranscriptHealth } from '../api/transcription';

// TI-99: how long a recording may go without new finalised text before the checkpoint reports a
// stall, and how often a continuing stall is re-reported.
const STALL_AFTER_MS = 120_000;
const STALL_REPEAT_MS = 5 * 60_000;

const MAX_ERROR_TEXT = 200;
const PCM_BYTES_PER_SAMPLE = 2;

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
    };
  }
}
