import { test, expect } from '@playwright/test'
import { buildServerArgs, LIVE_AUDIO_CTX, AUDIO_CTX_FULL, audioCtxSeconds } from '../src/whisperServer'
import { MAX_SEND_WINDOW_MS } from '../src/streamingSession'

// BUG-65 — the live server was spawned with no --audio-ctx, so every /inference paid the full 30s
// padded encoder cost regardless of how little audio it was given.

test('the live server asks for a reduced encoder context', () => {
  const args = buildServerArgs({ modelPath: '/m/base.en.bin', port: 1234, threads: 2 })

  expect(args).toContain('--audio-ctx')
  expect(args[args.indexOf('--audio-ctx') + 1]).toBe(String(LIVE_AUDIO_CTX))
})

// --no-fallback is NOT passed: server.cpp parses it and never reads it (cli.cpp and stream.cpp do
// `no_fallback ? 0.0f : …`; the server assigns temperature_inc unconditionally), so it is dead in
// every release through v1.9.1. Passing it would be a no-op that reads as a fix — which is worse
// than not passing it, because a test asserting it would then certify nothing.
test('the dead --no-fallback flag is not passed', () => {
  expect(buildServerArgs({ modelPath: '/m/base.en.bin', port: 1234, threads: 2 })).not.toContain('--no-fallback')
})

test('the model, host, port and thread arguments are still passed correctly', () => {
  const args = buildServerArgs({ modelPath: '/m/base.en.bin', port: 1234, threads: 3 })

  expect(args[args.indexOf('-m') + 1]).toBe('/m/base.en.bin')
  expect(args[args.indexOf('--port') + 1]).toBe('1234')
  expect(args[args.indexOf('--host') + 1]).toBe('127.0.0.1')
  expect(args[args.indexOf('-t') + 1]).toBe('3')
})

// --flash-attn is NOT passed: the pinned v1.9.1 server already defaults flash_attn to true, so
// passing it is a no-op — and every extra argument is a chance to hit the parser's unknown-argument
// path, which calls exit(0), so a mistyped flag looks like a clean shutdown. That is exactly how
// BUG-56 killed the live transcript.
test('no unnecessary flags are passed', () => {
  expect(buildServerArgs({ modelPath: '/m/base.en.bin', port: 1234, threads: 2 })).not.toContain('--flash-attn')
})

// The invariant that bites silently. --audio-ctx caps what the encoder can see, and overshooting is
// worse than "sees less": whisper truncates the mel copy at the context but the seek loop still
// advances a full 30s on a missed timestamp, so audio gets skipped outright.
//
// NOTE this asserts the SEND cap, not hardWindowMs. hardWindowMs does not bound the runtime window
// — finalizedMs advances only after an inference completes while the busy-guard drops ticks, so the
// real window is roughly inferenceMs + stabilityMs + STEP_MS and can exceed 15s on a slow machine
// (/inference alone tolerates 20s). An earlier version of this test asserted hardWindowMs and so
// certified an invariant it did not actually enforce.
test('the send cap fits inside the encoder context we ask for', () => {
  expect(MAX_SEND_WINDOW_MS).toBeLessThan(audioCtxSeconds(LIVE_AUDIO_CTX) * 1000)
})

test('audioCtxSeconds maps the encoder context onto whisper\'s 30s frame', () => {
  expect(audioCtxSeconds(AUDIO_CTX_FULL)).toBe(30)
  expect(audioCtxSeconds(AUDIO_CTX_FULL / 2)).toBe(15)
})
