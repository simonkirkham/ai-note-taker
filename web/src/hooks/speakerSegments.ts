// Speaker-attributed transcript assembly for AWS Transcribe Streaming with
// ShowSpeakerLabel enabled. Each finalised result's items carry a `Speaker`
// id ("0", "1", …); these helpers group items into speaker turns and accumulate
// them into a readable, labelled transcript. This is an evaluation aid for
// diarization quality — single-mic capture is diarization's hardest input, so
// the labels show the realistic floor, not the best case.

export interface TranscriptItem {
  Content?: string;
  Speaker?: string; // streaming returns a 0-based id as a string
  Type?: string; // "pronunciation" | "punctuation"
}

export interface SpeakerSegment {
  speaker: string;
  text: string;
}

// Group a result's items into consecutive same-speaker runs. Punctuation
// attaches to the current run (no leading space) and never starts a new speaker.
export function groupBySpeaker(items: TranscriptItem[]): SpeakerSegment[] {
  const segments: SpeakerSegment[] = [];
  for (const item of items) {
    const content = item.Content ?? '';
    if (!content) continue;
    const isPunctuation = item.Type === 'punctuation';
    const last = segments[segments.length - 1];
    if (last && (isPunctuation || item.Speaker === last.speaker)) {
      last.text += isPunctuation ? content : ` ${content}`;
    } else {
      segments.push({ speaker: item.Speaker ?? '?', text: content });
    }
  }
  return segments;
}

// Transcribe's 0-based speaker id → a 1-based human label.
export function speakerLabel(speaker: string): string {
  const n = Number(speaker);
  return Number.isFinite(n) ? `Speaker ${n + 1}` : `Speaker ${speaker}`;
}

// Accumulates finalised results into a speaker-labelled transcript: the same
// speaker's consecutive turns extend one line; a speaker change starts a new
// labelled line.
export class SpeakerTranscript {
  private readonly lines: string[] = [];
  private lastSpeaker: string | null = null;

  append(items: TranscriptItem[]): void {
    for (const segment of groupBySpeaker(items)) {
      if (segment.speaker === this.lastSpeaker && this.lines.length > 0) {
        this.lines[this.lines.length - 1] += ` ${segment.text}`;
      } else {
        this.lines.push(`${speakerLabel(segment.speaker)}: ${segment.text}`);
        this.lastSpeaker = segment.speaker;
      }
    }
  }

  toString(): string {
    return this.lines.join('\n');
  }
}
