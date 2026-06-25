# Phase 37-A — Reorder the home To Do list

**Shipped:** drag + keyboard reorder of the home To Do open-items list, persisted per workspace. PR #350 (feature) + #355 (E2E fix), deploy #655.

## What was built

| Piece | Decision |
| --- | --- |
| Ordering home | Dedicated per-workspace stream `todo-order#<workspaceId>` + near-stateless `TodoOrdering` aggregate. The home list interleaves two aggregates (`Todo` + note `ActionItem`), so ordering is a list-level concern — not a `Position` on either item aggregate (which would leak into the per-note action view). |
| Event | `TodoListReordered(workspaceId, orderedItemIds, reorderedAt)` — full-order snapshot, last-write-wins. |
| Read model | Nullable `Position` on `TodoItem`; sort `Position ?? int.MaxValue`, then `AddedAt`. No backfill (null until first reordered). |
| Auth | None against the projection — records ids only; stale ids ignored (sidesteps the BUG-30 async-projection-auth trap). |
| Projector wiring | New `todo-order#` prefix arm in `StreamProjector` + `SyncProjectingEventStore.MigratedPrefixes` + `ApplyTodoOrderEventsAsync`. |
| UI | Native drag (reused the `FolderTree` pattern, no DnD library) + keyboard Move up/down buttons. |

## Key learning — an E2E reorder journey must establish a deterministic order BEFORE reordering

**The bug (deploy #654 failed):** `TodoReorderJourney` added two to-dos then clicked "Move *second* up". It timed out at 30 s with a `System.TimeoutException` (an **action** timeout, not an assertion `PlaywrightException`).

**Why:** the optimistic add **prepends** the new item (`[item, ...prev]`), so right after adding `first` then `second` the live list shows `[second, first]` — `second` is on **top**. "Move second up" then targets a **disabled** button (already first), and Playwright's `ClickAsync` auto-waits for it to become enabled → hangs to timeout. The gated GET re-sorts to `[first, second]` (AddedAt), but the journey raced it.

**Fix (#355):** reload to the gated AddedAt order `[first, second]` *first* (drops the optimistic prepend), then move `second` up. Generalises: **a reorder E2E must reload to the gated, deterministic order before acting on positions** — the optimistic order and the projector order disagree transiently, and acting on the optimistic order hits disabled controls.

**Corollary:** a `30000ms System.TimeoutException` localises to a `WaitForResponse`/`ClickAsync` *action* (here, click-waiting on a disabled button), distinct from a `PlaywrightException` assertion timeout — read the exception *type* to tell "the action never completed" from "the assertion never became true".

## Process notes (multi-session contention)

- **A phantom whole-repo merge conflict can mean main is mid-incident.** A first `git merge origin/main` reported "deleted in origin/main" for ~every touched file; `cat-file` proved the files were present. Root cause: main was momentarily in a **mass-deletion** state (1056 files) that a parallel session was reverting. The retry, after the revert landed, merged cleanly. Lesson: if a merge claims a broad swath of core files were deleted on main, suspect an in-flight incident on main and re-check after fetching, rather than hand-resolving.
- **Parallel slices touching the same read model conflict even when sliced independently.** 39-A (edit action text) and 37-A both extended `DynamoDbTodoListStore`/`ITodoListStore`/`TodoListProjection` + `DynamoDbTodoListStoreTests`. Auto-merge combined the methods; the test file needed a manual both-sets merge. Sequencing same-file slices avoids this (see the run-pipeline "same file" anti-pattern).
- **The merge gate can deadlock when main's red IS the fix's target.** Deploy #654's red was exactly this slice's E2E journey bug; the fix PR (#355) had to be merged onto that "red" main (quiescent, product code sound) to green it. A literal "main must be green" reading would deadlock — the gate's intent is "no in-flight deploy / no real break", which held.

## TI logged
- **TI-48** — the whole `TodoList` read model is projector-maintained-only (not in `ProjectionRebuildHandler`), so `Position` (and the rest) can't be rebuilt from the stream. Pre-existing; low urgency.
