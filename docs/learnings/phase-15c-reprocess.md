# Phase 15-C — Regenerate Final notes on demand (Re-process)

**Shipped:** 2026-06-03 (PR #153, deploy #437 green). **Completes Phase 15.**

## What shipped

A **Re-process** control on `FinalNotesView`'s populated state (the empty state already had Generate from 15-A), so the user can re-run analysis after editing the transcript/notes. Both Generate and Re-process show an optimistic pending state on click; the populated view keeps the existing summary/discussion/decisions visible while re-processing (no content flash). Failures surface via the app-root `ToastProvider`'s `useToast().showError` — no silent failure; prior content stays intact on failure.

## What went well

- **Reused the new toast primitive.** Phase 14-V's `ToastProvider`/`useToast` (which didn't exist when Phase 15 was planned) was the right home for re-process failure surfacing — a clean case of a concurrently-built primitive paying off. The phase doc had said "reuse Phase 14's toast/inline-error primitive if present"; it was present.
- **Conflict-free this time.** Unlike 15-B, 15-C touches only `FinalNotesView` (a 15-A component Phase 14 never touches) + its co-located module + tests — **no `App.css`** — so it rebased/merged with zero contention despite the ongoing Phase 14 merge train. Confirms the learning: slices that stay inside their own module are immune to the shared-stylesheet churn.
- **Smallest vertical slice.** Pure UI affordance on top of an existing path (`onGenerate` → `analyseNote` → refresh); no backend, no new event.

## Process learnings

- **Hawk's should-fix items were test-coverage gaps tied to acceptance criteria, not defects.** The "Re-processing never alters Quick notes" and "success-refresh shows the regenerated summary (latest wins)" assertions were in the slice's own acceptance list but unwritten. **Apply:** when a slice's acceptance criteria name a specific invariant ("never alters X", "latest wins"), write the assertion even when the architecture makes the risk structurally unlikely — the test ties the suite to the stated contract and documents intent.
- **Optimistic UI for a server-driven action = immediate pending + visible failure, not local-state rollback.** Re-process has nothing to optimistically mutate locally (the summary is server-owned), so "optimistic" here meant instant pending feedback + keep-prior-content + toast-on-failure. Worth distinguishing from the list-mutation optimistic pattern.

## Phase 15 retrospective (all three slices)

The dominant cross-slice lesson — captured in [[phase-15a-final-notes-artifact]] and [[phase-15b-three-tab-view]] — was **concurrent-phase contention**: running Phase 15 (which restructures `NoteView`/`App.css`) alongside Phase 14's CSS-Modules migration of the same files caused a red-main blocker, repeated rebase livelock, a malformed LCS CSS auto-merge, and a semantic collision (14-O migrate vs 15-B delete `TranscriptionPanel`, resolved by dropping 14-O). 15-C was painless precisely because it stayed inside its own module. **The standing recommendation: don't run two phases concurrently that rewrite the same hot files; sequence them or assign file ownership + a merge order up front.**
