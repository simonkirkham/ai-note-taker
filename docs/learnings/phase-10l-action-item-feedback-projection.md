# Phase 10-L — Action-item feedback projection

**Shipped:** 2026-06-02 · PR #128 · deploy #414 green · **closes the Phase 10 feedback track (10-I→10-L)**

## What landed

A per-user action-item feedback projection (`notetaker-proj-actionfeedback`): of the action items the AI extracted, how many were **deleted** (rejected extraction) vs **completed** (confirmed a real task). PK-only table — aggregate `USER#{userId}` + provenance `ACTION#{actionItemId}`. Consumes 10-K's `ActionItemsSuggested`.

## Learnings

### 1. Cross-stream events break single-pass rebuild — defer the computation (the key one)

This is the first projection whose source events span **two aggregates**: the suggestion (`ActionItemsSuggested`) is on the **Note** stream, the outcome (`ActionItemDeleted`/`ActionItemCompleted`) on the **ActionItem** streams. `ProjectionRebuildHandler` replays `ReadAllStreamsAsync`, which orders by stream id — so `action#…` events replay **before** `note#…`. A single-pass projection (like 10-J's `TagFeedbackProjection`, which works because all its events share one note stream) would process a deletion before its suggestion existed and miss the count.

**Fix:** make the rebuild projection **order-independent** — `Handle` only accumulates (provenance map + deleted/completed id *lists*), and `GetAggregates()` computes counts at the end. The live path needs no such trick (a suggestion always precedes its outcome chronologically). Locked with `OrderIndependent_DeletionBeforeSuggestion_StillCounts` + the integration rebuild-parity test.

**General rule for future projections:** if a projection's events come from more than one aggregate/stream, do **not** assume replay order matches causal order. Either defer computation, or sort by `OccurredAt` before replaying.

### 2. Inline wiring spans two command handlers

Following [[project_projections_update_inline]], the live update is inline — and because the suggestion and outcome events live on different aggregates, it lives in **two** handlers: `NoteCommandHandler` (suggested++ + provenance) and `ActionItemCommandHandler` (deleted++/completed++ if provenance). The 10-K learning predicted this exactly. Provenance is **not** consumed (action ids are unique and immutable, so no double-count risk — unlike 10-J's tag rejection which consumes provenance to dedupe re-add/remove).

### 3. Per-user-only key ⇒ counts accumulate ⇒ assert deltas in shared-fixture tests

`ActionItemFeedbackView` is keyed per user (free-text descriptions can't aggregate per-value, unlike tags). In the `IClassFixture`-shared integration tests every test runs as the same user, so counts accumulate. Absolute-count assertions would be order-dependent and brittle; the tests assert **deltas** (capture before, act, assert `before + n`). The rebuild-parity test snapshots the full set before/after a rebuild, which is self-consistent regardless of accumulation.

### 4. Hawk's coverage nudge was worth taking

Hawk approved first pass but flagged that the rebuild-parity test only covered the easy case (delete one item, complete a *different* one). Added a same-item complete-then-delete parity test — the documented approximation where both counters increment — to pin the equivalence the whole slice rests on. Cheap, and it exercises the order-independent path for a single id.

## Phase 10 feedback track — done

10-I (`TagsSuggested`) → 10-J (tag feedback) → 10-K (`ActionItemsSuggested`) → 10-L (action feedback) are all shipped. The correction signal is now durable, queryable, and rebuildable. **Still open in Phase 10:** 10-G (eval harness + versioned prompts) and 10-M (stamp `modelId`/`promptVersion` on the suggestion events) — 10-M was deliberately deferred this run because it depends on 10-G's `PromptCatalog`/`NoteAnalysisResult` changes, which don't exist yet. Roadmap stays _(In Progress)_.

## Done actions applied

- None requiring config/guardrail changes. The cross-stream rebuild-ordering insight (learning 1) is the durable takeaway for any future multi-aggregate projection.
