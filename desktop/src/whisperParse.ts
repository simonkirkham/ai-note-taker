// 48-A — parse whisper-cli stdout. Pure (no electron, no child_process) so the
// segment extraction unit-tests headlessly against captured output, à la displayMedia.ts.
// whisper-cli prints one line per finalised segment:
//   "[00:00:04.740 --> 00:00:07.220]   text"

export type WhisperSegment = { startMs: number; endMs: number; text: string }

const LINE_RE =
  /^\[(\d{2}):(\d{2}):(\d{2})\.(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})\.(\d{3})\]\s*(.*)$/

// True when the segment text is a non-speech annotation whisper emits on silence/noise
// (e.g. "[BLANK_AUDIO]", "(buzzing)") — dropped so they never reach the live transcript.
function isNonSpeech(text: string): boolean {
  if (text.length === 0) return true
  return /^[[(].*[\])]$/.test(text)
}

function tsToMs(h: string, m: string, s: string, ms: string): number {
  return ((Number(h) * 60 + Number(m)) * 60 + Number(s)) * 1000 + Number(ms)
}

// Parse one line. Returns null for log noise, blanks, and non-speech annotations.
// baseMs shifts a windowed transcription onto the full-recording timeline.
export function parseWhisperLine(line: string, baseMs = 0): WhisperSegment | null {
  const m = LINE_RE.exec(line.trimEnd())
  if (!m) return null
  const text = m[9].trim()
  if (isNonSpeech(text)) return null
  return {
    startMs: baseMs + tsToMs(m[1], m[2], m[3], m[4]),
    endMs: baseMs + tsToMs(m[5], m[6], m[7], m[8]),
    text,
  }
}

// Parse full stdout into speech segments, each offset by baseMs.
export function parseWhisperOutput(stdout: string, baseMs = 0): WhisperSegment[] {
  const out: WhisperSegment[] = []
  for (const line of stdout.split('\n')) {
    const seg = parseWhisperLine(line, baseMs)
    if (seg) out.push(seg)
  }
  return out
}
