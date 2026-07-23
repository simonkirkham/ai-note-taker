// 48-C — merge two source-separated transcripts (mic = "Me", loopback = "Them") into one
// speaker-labelled transcript by interleaving segments on their (shared) recording timeline.
// Pure (no electron/child_process) so it unit-tests headlessly. For a 1:1 call this is
// structurally exact — two physical channels can never yield a third speaker.

import type { WhisperSegment } from './whisperParse'

export type Speaker = 'Me' | 'Them'
export type Turn = { speaker: Speaker; text: string }

// Interleave by start time and collapse consecutive same-speaker segments into one turn.
// Both streams share t=0 (recording start), so their timestamps are directly comparable.
export function mergeDiarized(me: WhisperSegment[], them: WhisperSegment[]): Turn[] {
  const tagged = [
    ...me.map((s) => ({ ...s, speaker: 'Me' as Speaker })),
    ...them.map((s) => ({ ...s, speaker: 'Them' as Speaker })),
  ].sort((a, b) => a.startMs - b.startMs || (a.speaker === b.speaker ? 0 : a.speaker === 'Me' ? -1 : 1))

  const turns: Turn[] = []
  for (const seg of tagged) {
    const text = seg.text.trim()
    if (!text) continue
    const last = turns[turns.length - 1]
    if (last && last.speaker === seg.speaker) last.text += ' ' + text
    else turns.push({ speaker: seg.speaker, text })
  }
  return turns
}

// Render turns as the committed transcript: one "Speaker: text" line per turn.
export function turnsToText(turns: Turn[]): string {
  return turns.map((t) => `${t.speaker}: ${t.text}`).join('\n')
}
