import { test, expect } from '@playwright/test'
import { parseWhisperLine, parseWhisperOutput } from '../src/whisperParse'

// 48-A — whisper-cli emits one line per finalised segment:
//   "[00:00:04.740 --> 00:00:07.220]   I think the other thing..."
// The parser is pure (no child_process) so it unit-tests headlessly against captured
// stdout, the same seam as displayMedia.spec.ts. baseMs offsets a windowed transcription
// back onto the full-recording timeline.

test('parses a single segment line into ms offsets and trimmed text', () => {
  const seg = parseWhisperLine('[00:00:04.740 --> 00:00:07.220]   I think the other thing')
  expect(seg).not.toBeNull()
  expect(seg!.startMs).toBe(4740)
  expect(seg!.endMs).toBe(7220)
  expect(seg!.text).toBe('I think the other thing')
})

test('handles hours and minutes in the timestamp', () => {
  const seg = parseWhisperLine('[01:02:03.500 --> 01:02:05.000]  hello')
  expect(seg!.startMs).toBe(3723500)
  expect(seg!.endMs).toBe(3725000)
})

test('non-segment lines (blank, log noise) return null', () => {
  expect(parseWhisperLine('')).toBeNull()
  expect(parseWhisperLine('whisper_init_from_file_with_params_no_state: loading model')).toBeNull()
  expect(parseWhisperLine('main: processing 480000 samples')).toBeNull()
})

test('non-speech annotations are dropped (empty text, [BLANK_AUDIO], bracketed noises)', () => {
  expect(parseWhisperLine('[00:00:00.000 --> 00:00:05.000]  [BLANK_AUDIO]')).toBeNull()
  expect(parseWhisperLine('[00:00:00.000 --> 00:00:02.000]  (buzzing)')).toBeNull()
  expect(parseWhisperLine('[00:00:00.000 --> 00:00:02.000]   ')).toBeNull()
})

test('parseWhisperOutput extracts every speech segment and applies baseMs', () => {
  const stdout = [
    'whisper_print_timings: load time = 100 ms',
    '[00:00:00.000 --> 00:00:02.000]   Yeah, good.',
    '[00:00:02.000 --> 00:00:04.000]  [BLANK_AUDIO]',
    '[00:00:04.000 --> 00:00:06.000]   Next point.',
    '',
  ].join('\n')
  const segs = parseWhisperOutput(stdout, 300000) // window starts at 5 min
  expect(segs.map((s) => s.text)).toEqual(['Yeah, good.', 'Next point.'])
  expect(segs[0].startMs).toBe(300000)
  expect(segs[1].startMs).toBe(304000)
})

test('joined text of a window is a plain space-joined transcript', () => {
  const stdout = '[00:00:00.000 --> 00:00:02.000]  a\n[00:00:02.000 --> 00:00:04.000]  b'
  const segs = parseWhisperOutput(stdout)
  expect(segs.map((s) => s.text).join(' ')).toBe('a b')
})
