# Phase 10-K — Record AI action-item suggestions (`ActionItemsSuggested`)

**Shipped:** 2026-06-02 · PR #127 · deploy #412 green

## What landed

A provenance-only `RecordActionItemSuggestions` command + `ActionItemsSuggested` event on the `Note` aggregate, recording (by id) the action items an analysis run created. The analyse handler collects each created `ActionId` in the `AddActionItem` loop and records them after the loop, so a later `ActionItemDeleted`/`ActionItemCompleted` can be attributed to the AI (consumed by 10-L). Symmetric to 10-I (tags).

## Learnings

### 1. The 10-I equality learning paid off immediately

`ActionItemsSuggested(NoteId, IReadOnlyList<Guid>)` is the second collection-bearing event. The [[project_projections_update_inline]]-adjacent learning from 10-I — "collection events need a structural `Equals`/`GetHashCode` override or the spec harness fails on reference equality" — was applied from the first keystroke (the override mirrors `TagsSuggested` exactly). No failing-spec rediscovery. Reusing the prior slice's learning is the cheapest correctness win in the phase.

### 2. The suggestion and the feedback signal live on different aggregates

`ActionItemsSuggested` is recorded on the **Note** stream (the analyse handler already drives `NoteCommandHandler`), but the events that complete the feedback loop — `ActionItemDeleted` / `ActionItemCompleted` — are on the **ActionItem** aggregate/stream. The suggestion references the items by id precisely so the 10-L projection can match across streams without an aggregate reaching into another. **Direct consequence for 10-L:** the live feedback update must be wired in **two** command handlers — `NoteCommandHandler` (suggested++) and `ActionItemCommandHandler` (deleted++/completed++) — not one.

### 3. Handler ordering: record provenance only after the referenced entities exist

The handler issues `RecordActionItemSuggestions` *after* the `AddActionItem` loop, and only collects ids for items that pass the dedup filter and are actually created (guarded by `createdActionIds.Count > 0`). So the provenance event never references an action item that wasn't written.

## Process notes

- Hawk approved first pass, no blocking/should-fix. Its one substantive nit (10-J Scribe docs appearing in the *local* `git diff main...HEAD`) was a stale-local-`main` artifact in the shared checkout — the GitHub PR diff (`gh pr view --json files`) confirmed only the 9 intended 10-K files. **Takeaway:** when reviewing in a worktree off a shared checkout, trust `gh pr view --json files` (computed vs `origin/main`) over a local `main...HEAD` diff.
- Within-run duplicate action descriptions would yield two distinct ids (and two provenance entries); fine for 10-L's per-id delete/complete counting. Noted for the 10-L author.

## Done actions applied

- None requiring config/guardrail changes — clean slice. Learnings captured for 10-L (two-handler wiring; per-id matching).
