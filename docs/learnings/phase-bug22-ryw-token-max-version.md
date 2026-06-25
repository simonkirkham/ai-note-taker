# BUG-22 — consistency-token slot must keep the highest per-stream version

**Slice:** BUG-22 (PR #262, deploy #551, 2026-06-13). Fixes the reopened [TI-19](../technical-improvements.md) flaky `TagsJourney` E2E.

## One-line

An async-read cutover (RYW-2) silently reintroduced a tag-pill drop that the inline-era fix (BUG-17) had "resolved" — because the frontend per-stream consistency-token slot was last-writer-wins, and concurrent same-stream writes can leave the older token.

## What happened

1. Deploy #546 (PR #255, RYW-2) made the **whole Note aggregate async**: the projector became the sole writer of note read models, note writes return `X-Consistency-Token` (`<stream>@<version>`), and `GET /notes/{id}` gates on it.
2. #546 failed the `deploy-test` E2E gate twice (passed only on attempt 3) — both the _dropped-add_ signature where a pill from `AddTagAsync("1:1s Bill")` never renders.
3. Root cause: a space-separated multi-tag add fans out into **two concurrent same-stream POSTs** returning `note#id@N` and `note#id@N+1`. `captureNoteToken` → `setStreamToken` was last-writer-wins with no version compare, so whichever HTTP response resolved **last** won the single slot — ~half the time the older `@N`. The next gated `GET /notes/{id}` (fired by `useTagMutations.onSettled`'s fresh-note reconcile) then released as soon as the projector folded only the first tag, omitting the second and clobbering its optimistic pill.

## Why the existing machinery didn't save it

- **`gatedRead`'s stale-retry loop can't help.** The server answers **fresh**, not `stale`, because the token it was handed (`@N`) _is_ satisfied. It has no idea the client also needed `@N+1`. The bug is the wrong (too-low) token in the slot, not an under-tuned retry — fix the captured token, not the retry loop.
- **BUG-17's backend retry was real but orthogonal.** It stopped the second concurrent append being _lost_ (so two distinct versions `@N`, `@N+1` now exist) — which is exactly the setup the token-slot race needs. The two fixes are at different layers.

## The fix

`web/src/api/consistencyTokens.ts` — keep the **highest** version:
- `setStreamToken` keeps the higher version. The slot key already pins the stream and versions are monotonic, so a bare version compare is strictly correct.
- `setLatestToken` keeps max-version **only** when the stored token is the same stream. A write to a _different_ stream still moves the "latest write" pointer regardless of version (design #7 — a list read waits on the stream just written). A naive "always keep max" would break cross-note navigation; the same-stream guard is the subtlety.

## Reusable guardrails

1. **A sync→async read cutover re-exposes every read-after-write assumption — including ones a prior fix "closed" under sync.** TI-19 was marked Done by BUG-17 and held for the entire inline-projection era; it broke the moment reads went async. When flipping a consistency model, re-audit the flows a previous fix touched, not just new code. This is the CLAUDE.md "never big-bang a cross-cutting cutover" guardrail — RYW-2 flipped the whole aggregate at once and the concurrent same-stream multi-write case wasn't in the single-call RYW proof.
2. **A "latest write" token slot needs max-version semantics for same-stream writes but last-write for different streams.** Last-writer-wins is wrong whenever one user action fans out into multiple concurrent same-stream writes. Parse `<stream>@<version>` and branch on whether the stream matches.
3. **"Fresh, not stale" is a real answer — a retry loop only helps when the server admits staleness.** If a gate releases on a token that's satisfied-but-insufficient, no amount of retrying changes the verdict. Carry the correct (highest) token instead.

## Residual follow-up (not in this fix)

`TagsJourney` tag-pill assertions are a plain 15s wait, not reload-tolerant like the RYW pattern's own `AssertTodoVisibleAfterReloadAsync` reload-loop — a still-warming projector hard-times-out instead of re-polling. Logged under BUG-22 / TI-19 as a test-robustness follow-up; the token-slot fix is the actual correctness fix.
