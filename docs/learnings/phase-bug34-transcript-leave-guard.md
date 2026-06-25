# BUG-34 — Guarding browser-back during recording, and recovering an interrupted draft

**Slice:** BUG-34 (PR #306, deploy #606, 2026-06-22). Frontend-only.

**Problem:** Alt+← (browser back) mid-recording lost the transcript, and a re-record started fresh instead of continuing. Root cause was four compounding defects; the fix has two parts (safe-leave, non-destructive re-record).

## Non-obvious whys (keep these)

| Decision | Why |
|---|---|
| **"Leave & save" navigates to workspace home, not `navigate(-1)`** | The popstate guard pushes a *trap* history entry sharing the note's URL. A relative `navigate(-1)` pops the trap and lands back on the note (same route → no unmount). Only a navigation to a *different* route reliably leaves. Home is deterministic and underflow-safe (no history-depth math, no cold-deep-link edge). Wired as a new `onExit` prop (defaults to `onBack` for non-recording callers/tests). |
| **`pagehide` writes the DRAFT (keepalive PUT), never a commit** | A commit on teardown risks a premature/duplicate `TranscriptionCompleted` and, via the `committedRef` one-shot guard, would *block* the real final commit. A bfcache restore that keeps recording would then be corrupted. The draft is loss-tolerant, overwrite-in-place, and recoverable/continuable on reopen — exactly ADR-0011's crash-buffer role. |
| **`keepalive: true` on the flush, not `navigator.sendBeacon`** | The API authenticates with a Bearer **header**; `sendBeacon` sends cookies only and can't set headers. `keepalive` fetch keeps the `Authorization` header (via the existing `withAuth` path) and still outlives teardown. |
| **Continue is draft-aware** (`hasInitialTranscript = transcriptText \|\| transcriptDraft`; `initialTranscript = displayed ?? draft.text`) | An interrupted recording is a *draft*, not a committed transcript. Keying Continue only off the committed transcript meant a re-record started empty and its commit deleted the note-keyed draft — the destructive path. Folding the draft into the Continue decision makes re-record recover it instead. |

## Accepted trade-offs (documented in code)

1. **Orphaned trap entry after a normal Stop.** The guard pushes a trap entry on record-start but cleanup removes only the *listener*, not the entry. After Stop (recording ends without leaving), the next browser-back lands on the same URL and a second press is needed to leave. Popping it on cleanup was rejected — it would make Stop itself navigate away.
2. **Expired-token pagehide flush can no-op.** If the JWT is already expired, `apiFetch` awaits a silent refresh that won't complete during teardown. The 15 s checkpoint is the floor — worst case loses the last <15 s tail.

## Process lesson

**The popstate guard's full browser-history navigation is unprovable in jsdom** (the app uses `BrowserRouter`, not a data router, so `useBlocker` is unavailable; jsdom doesn't model multi-entry back/forward). Unit tests cover the handler wiring (popstate-while-recording → confirm; pagehide → keepalive draft PUT; draft → Continue), and **data-safety** rests on the unit-tested pagehide flush + unmount commit rather than on the guard's navigation. No E2E was added: the existing Playwright suite can't drive `getUserMedia`/Transcribe streaming, so a recording journey isn't feasible without heavy mocking. Same family as the "no-fetch-is-unprovable-in-jsdom" learning — the navigation behaviour is verified manually; the loss-prevention is verified by tests.
