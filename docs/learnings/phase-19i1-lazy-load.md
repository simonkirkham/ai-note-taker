# 19-I1 — Lazy-load the editor + transcribe SDK

**Shipped:** PR #300, deploy #602, 2026-06-18. Frontend-only; deploy-time neutral.

## What shipped

| Change | File |
|--------|------|
| `LazyNoteEditor` = `React.lazy(() => import('./NoteEditor'))` in `Suspense` (reserved-height fallback) + `ErrorBoundary` (localised fallback + `lazyChunkError` RUM event) | `components/LazyNoteEditor.tsx` |
| Transcribe SDK `import()`-ed at recording-start, not statically | `hooks/useTranscription.ts` |
| `ErrorBoundary` extended with optional `fallback` + `onError` (defaults unchanged) | `components/ErrorBoundary.tsx` |
| Chunk-reload guard clears after a stability delay, not synchronously at boot | `lib/chunkReload.ts`, `main.tsx` |

Build proof: entry chunk has **zero** `@aws-sdk`/`smithy` tokens; SDK → 161 kB lazy chunk, editor → 532 kB lazy chunk.

## Non-obvious lessons

1. **The first `React.lazy` chunk silently re-arms the chunk-reload loop guard.** `main.tsx` cleared the `chunk-reload-attempted` flag synchronously once the entry chunk evaluated — fine when nothing else was code-split. With a lazy chunk, entry-loaded no longer proves *every* chunk loaded: a genuinely-missing lazy chunk fails → reload → entry re-evaluates → flag cleared → next navigation fails again → reload → **loop**. Fix: `clearChunkReloadFlagAfterStable()` defers the clear behind a delay (10 s), so a chunk that is truly gone fails a *second* time while the flag is still set and falls through to the `ErrorBoundary` instead of reloading. The original `main.tsx` comment had predicted this exact caveat (phase-26 26-B) — it was a real trap, not a hypothetical.

2. **Verify a chunk split by library-internal tokens, not class names.** Grepping the entry bundle for `TranscribeStreamingClient`/`StartStreamTranscriptionCommand` gives false positives — those identifiers live in `useTranscription.ts`'s own source (`new StartStreamTranscriptionCommand(...)`, `response.TranscriptResultStream`), which stays in the entry chunk. The SDK *body* is only proven absent by tokens the library alone contains (`@aws-sdk`, `smithy`, `@smithy`) → 0 in entry, dozens in the lazy chunk.

3. **Reuse the existing `ErrorBoundary` for lazy-chunk failures — don't fork a new class.** Adding optional `fallback` + `onError` (guarded on `fallback !== undefined`, not truthiness) kept one boundary implementation. `onError` is the hook that turns a previously-invisible failed import into a `recordRumEvent('lazyChunkError', …)`.

4. **Isolate Suspense from unrelated tests.** `NoteView.test.tsx` mocked `NoteEditor` directly; switching the mock target to `LazyNoteEditor` (synchronous textarea stand-in) kept those tests free of Suspense timing, while the real lazy/fallback/error behaviour is covered in `LazyNoteEditor.test.tsx` (the rejection case uses `vi.resetModules()` + `vi.doMock` to get a fresh `lazy()` per test).

## Follow-ups (Hawk nits, non-blocking)

- **Confirm CLS via RUM.** The fallback `min-height: calc(100vh - 360px)` is an approximation of the editor's editable area, not a measured match. Check RUM CLS after real traffic; tune if > 0.1.
- **`lazyChunkError` is `recordEvent`, not `recordError`** — lands in RUM logs (like the `deadNoteLink` precedent) but does **not** increment `JsErrorCount` or fire the error-rate alarm. Deliberate (meets spec). Revisit only if a failed editor load should be alarmable. → filed as TI-45.
