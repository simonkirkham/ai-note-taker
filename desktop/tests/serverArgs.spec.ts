import { test, expect } from '@playwright/test'
import { buildServerArgs, LIVE_AUDIO_CTX, AUDIO_CTX_FULL, AUDIO_CTX_SECONDS } from '../src/whisperServer'
import { DEFAULT_STREAM_CONFIG } from '../src/streamingTranscript'

// BUG-65 — the live server was spawned with NO streaming flags, so every /inference paid the full
// 30s padded encoder cost and let temperature fallback retry a clipped-boundary segment up to ~6x.
// These lock the flags in, and lock the one invariant that can silently corrupt the live transcript.

test('the live server asks for a reduced encoder context and disables temperature fallback', () => {
  const args = buildServerArgs({ modelPath: '/m/base.en.bin', port: 1234, threads: 2 })

  expect(args).toContain('--audio-ctx')
  expect(args[args.indexOf('--audio-ctx') + 1]).toBe(String(LIVE_AUDIO_CTX))
  expect(args).toContain('--no-fallback')
})

test('the model, host, port and thread arguments are still passed correctly', () => {
  const args = buildServerArgs({ modelPath: '/m/base.en.bin', port: 1234, threads: 3 })

  expect(args[args.indexOf('-m') + 1]).toBe('/m/base.en.bin')
  expect(args[args.indexOf('--port') + 1]).toBe('1234')
  expect(args[args.indexOf('--host') + 1]).toBe('127.0.0.1')
  expect(args[args.indexOf('-t') + 1]).toBe('3')
})

// --flash-attn is NOT passed: the pinned v1.9.1 server already defaults flash_attn to true, so
// passing it is a no-op — and every extra argument is a chance to hit the parser's exit-on-unknown
// path, which is exactly how BUG-56 killed the live transcript.
test('no unnecessary flags are passed', () => {
  const args = buildServerArgs({ modelPath: '/m/base.en.bin', port: 1234, threads: 2 })

  expect(args).not.toContain('--flash-attn')
  expect(args).not.toContain('--beam-size') // already greedy by default (beam_size = -1)
})

// The invariant that can bite silently: --audio-ctx caps how much audio the encoder can see. If the
// sliding window is ever allowed to grow past that, the tail is truncated inside whisper and the
// live transcript quietly loses its most recent words — no error anywhere. Same class as the ready
// deadline that sat above the start timeout: two constants in different modules that must be ordered.
test('the hard window fits inside the encoder context we ask for', () => {
  const encoderCapacityMs = AUDIO_CTX_SECONDS(LIVE_AUDIO_CTX) * 1000

  expect(DEFAULT_STREAM_CONFIG.hardWindowMs).toBeLessThan(encoderCapacityMs)
  expect(DEFAULT_STREAM_CONFIG.maxWindowMs).toBeLessThan(DEFAULT_STREAM_CONFIG.hardWindowMs)
})

test('AUDIO_CTX_SECONDS maps the encoder context onto whisper\'s 30s frame', () => {
  expect(AUDIO_CTX_SECONDS(AUDIO_CTX_FULL)).toBe(30)
  expect(AUDIO_CTX_SECONDS(AUDIO_CTX_FULL / 2)).toBe(15)
})
