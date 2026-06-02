# Phase 10-J — Tag feedback projection

**Shipped:** 2026-06-02 · PR #124 · deploy #410 green

## What landed

A per-(user, tag) feedback projection (`notetaker-proj-tagfeedback`) counting how many AI-suggested tags were later removed. Single table, two row types: an aggregate counter (`USER#`/`TAG#`) and a per-note provenance row (`NOTE#`/`TAG#`) that lets a later `NoteUntagged` be classified as a rejected AI suggestion vs a manual cleanup. Consumes 10-I's `TagsSuggested`. No read endpoint — queried ad hoc.

## Learnings

### 1. The documented event-handler architecture is dead code (the big one)

`IDomainEventDispatcher.DispatchAsync` is **never called** anywhere in `src`/`tests`. The five `IDomainEventHandler` classes (`TagIndexEventHandler`, `NoteDetailEventHandler`, …) are registered in DI but never invoked. **Live projection updates happen inline inside the command handlers** (`NoteCommandHandler.UpdateTagIndexForNewEventsAsync`, `ActionItemCommandHandler`'s inline upserts).

The phase-10 doc told us to mirror `TagIndexEventHandler` as an `IDomainEventHandler` — which would have shipped a projection that only ever populates on a manual rebuild. Caught it before writing the dead code; wired the projection **inline in `NoteCommandHandler`** instead (confirmed with the maintainer). Recorded as a cleanup item in `docs/technical-improvements.md` ("Remove (or wire up) the dead `IDomainEventDispatcher`…") and as a project memory.

**Applies to 10-L:** wire the action-item feedback projection inline in `ActionItemCommandHandler` (it owns `ActionItemDeleted`/`ActionItemCompleted`) and `NoteCommandHandler` (it owns `ActionItemsSuggested`), NOT as an `IDomainEventHandler`. The suggestion event and the deletion/completion events live on **different aggregates/handlers** — plan the inline wiring across both.

### 2. Live path and rebuild path duplicate the classification rules — keep them in lockstep

This projection has the rules in two places: the inline live update (`NoteCommandHandler`) and the replay (`TagFeedbackProjection`, used by `ProjectionRebuildHandler`). This duplication is consistent with the existing `TagIndex` (inline `UpdateTagIndexForNewEventsAsync` vs `TagIndexProjection`). The risk is they drift. Mitigations used: an integration **rebuild-parity test** (`Rebuild_ReproducesLiveCounts`) asserting live counts == rebuilt counts, plus projection-level specs for each rule.

### 3. Hawk found a real latent parity bug — the delete short-circuit

`NoteCommandHandler.UpdateProjectionAsync` `return`s early when a batch contains `NoteDeleted`, after `DeleteAllProjections`. The tag-feedback classification ran *after* that point, so an untag sharing a batch with a delete would be counted on rebuild (per-event) but not live. Dormant today — every `Note` command emits a single-event batch, so `NoteUntagged` and `NoteDeleted` never co-occur — but rebuild parity is this slice's invariant. Fix: classify before dropping provenance; added an untag-then-delete projection parity spec. **Lesson:** when a handler has an early-return fast path, check every projection update lives on the correct side of it.

### 4. Counter projections want atomic `ADD`, not read-modify-write

`SuggestedCount`/`RejectedCount` use DynamoDB `UpdateItem … ADD :one`, which is atomic and initialises a missing attribute/item from zero — no race on concurrent suggestions for the same (user, tag), and no separate "create row first" step.

## Process notes

- **Heavy parallel merge traffic on main** during this slice (#120, #121, #125 all landed around it). Every Scribe push needed a `git fetch` + `rebase origin/main` before `push origin HEAD:main`. The merge-gate check (latest deploy green, none in progress) held up each time.

## Done actions applied

- Recorded the dead-dispatcher discrepancy in `docs/technical-improvements.md` (shipped in the 10-J PR) and as a project memory — both immediately useful for 10-L.
- Hawk's parity finding fixed in-slice (not deferred).
