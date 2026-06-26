# Phase 39-A — Edit an action item's text

**Shipped:** PR #349 + fast-follow #354, live in prod 2026-06-25. Feature itself was routine (a documented-but-unimplemented `EditActionItem`/`ActionItemEdited`). The durable lessons are in how it nearly didn't ship.

## 1. An E2E must never act on optimistic temp-id state — the bug only the deploy gate could catch

**Symptom:** `ActionEditJourney` failed the deploy E2E gate **deterministically** (2 consecutive attempts) — `Edited …` never appeared after reload. Green everywhere else: Domain.Specs, Api.Integration, vitest, local build.

**Root cause:** the journey added an action then *immediately* edited it. The optimistic add renders the row with a **temp id** (`temp-…`); the real server id arrives only on the `onSettled` refetch. In the slow deploy env that refetch lagged, so `commitEdit` PUT `/notes/{id}/actions/temp-…` → **404** → optimistic edit rolled back → the new text never persisted.

**Why no lower test caught it:**

| Layer | Why it missed |
|---|---|
| vitest (`ActionsSection`) | Seeds the actions list with a **real** id (`a-1`) via a mocked GET — never exercises the optimistic-add→edit reconcile window |
| Api.Integration | Calls the API directly with a real `actionId` — no client optimistic state at all |
| Domain.Specs | Pure aggregate — no ids-over-the-wire |

Only a real browser doing add-then-edit faster than the refetch reproduces it, and only the **slow** (deploy) env makes the window wide enough to be deterministic.

**Fix (#354):** reconcile to the real id *before* editing — `AssertActionVisibleAfterReloadAsync(original)` (a gated reload re-sources the row from the server) then edit. The CLAUDE.md guardrail already says it: *drive a post-write action through a gated read, not optimistic state.*

**Latent product edge (left as-is):** a real user editing within the sub-second add-reconcile window would also 404-and-lose the edit. Complete/delete share this (they map by the row's current id too) and aren't guarded, so behaviour stays consistent — not worth a guard for a single-user app, but noted.

**Takeaway:** when an E2E interacts with a just-created optimistic entity, it must first let the entity reconcile to its server identity (gated read / reload). A temp-id mutation is invisible to every test layer below E2E and only deterministic in the slow gate.

## 2. "Fold the new event into the projection" means **all four** projection paths, not one

A new action event that affects home cards + search must be folded in **four** places, easy to under-count:

| Path | File | Role |
|---|---|---|
| Async (live) | `ProjectionUpdater.ApplyActionItemEventsAsync` | the Projector Lambda's fold (card rollup + search updated via helpers) |
| Rebuild — note actions | `NoteActionsProjection` | `GET /notes/{id}/actions` rebuild |
| Rebuild — home cards | `NoteCardListProjection` | the card's `ActionItems` rebuild |
| Rebuild — search | `NoteSearchViewProjection` | `ActionItemsText` rebuild |

I folded the async path + the first two; **Hawk caught the missing `NoteCardListProjection` + `NoteSearchViewProjection`** rebuild folds. Without them, `POST /admin/projections/rebuild` would silently revert every edited action's text on cards and in search — the classic **rebuild ≠ async** divergence. The async path updates cards/search through `ProjectionUpdater` helpers, which *hides* that there are two more **dedicated rebuild projections** for the same read models.

**Takeaway:** for any new action/note event, grep for *every* projection class that already handles a sibling event (`ActionItemCompleted`) and fold the new one into each — the rebuild projections are separate classes from the async updater's helper methods.

## 3. Parallel-session coordination cost more than the feature

Three distinct hazards from another session working the shared repo concurrently:

1. **Phase-number collision** — Phase 36/37/38 were claimed mid-flight; this work renumbered 36→39. *Always `git fetch` + `ls docs/phases/` before claiming a number; branch off `origin/main`, not local `main`.*
2. **Shared `main` mass-delete** — a parallel session pushed a "scribe docs" commit that deleted 1054/1056 files (a `git add -A` over a near-empty tree). `git merge origin/main` reported every source file as "deleted in origin/main" — **abort, don't resolve**. Recovered by a forward `git revert` (no history rewrite). *A merge that wants to delete your whole source tree is an incident, not a conflict.*
3. **Deploy-queue thrash** — concurrent merges kept main's deploy non-quiescent; the merge gate must wait for a no-deploy-in-progress window (quiescence), and roll-forward-the-fix is the exception when main's last deploy is red *because of* the very PR you're merging.

**Takeaway:** carry doc registration (roadmap/future-features) **in the slice branch** or defer it until the other session's WIP lands — never stage the shared dirty `main` checkout's files.

## 4. The deploy gate gave zero diagnostic — filed BUG-38

A concurrent unrelated `TagsJourney` cold-start flake (app `tag-input` never loaded in 30 s; passed on rerun) co-failed the run. Both failures produced **only bare Playwright timeouts** — the journeys' `Console.WriteLine` browser logs are **swallowed by xUnit** and never reached the gh run log. Per the CLAUDE.md E2E guardrail, route evidence through the **thrown exception message**. Tracked as [BUG-38](../phases/phase-bugs.md#bug-38) (fast-follow: add thrown-message diagnostics to the reload-tolerant assert helpers).
