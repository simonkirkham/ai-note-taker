# Phase 10-I — Record AI tag suggestions (`TagsSuggested`)

**Shipped:** 2026-06-02 · PR #122 · deploy #407 green

## What landed

A provenance-only `RecordTagSuggestions` command + `TagsSuggested` event on the `Note` aggregate. The analyse handler records the post-dedup applied tag set as `TagsSuggested` immediately before the per-tag `TagNote`/`NoteTagged` calls, so a later untag can be classified as a rejected AI suggestion (consumed by 10-J). `Apply(TagsSuggested)` is a no-op — the event changes no aggregate state.

## Learnings

### 1. First domain event with a collection payload → record equality must be overridden (reusable for 10-K)

`TagsSuggested(NoteId, IReadOnlyList<string> Tags)` is the first event in the codebase carrying a collection. The compiler-generated record `Equals` compares the `Tags` list **by reference**, so `new TagsSuggested(id, ["a"]) != new TagsSuggested(id, ["a"])`. The BDD spec harness asserts with `Assert.Equal(expectedEvents, actual)`, which (via `object.Equals` → the record's `IEquatable`) would fail on every collection event.

**Fix:** override `Equals(TagsSuggested?)` with `SequenceEqual` on the collection and a matching order-sensitive `GetHashCode`. Keep the one-line comment explaining *why* (non-obvious — this is exactly the WHY-warrants-a-comment case).

**Applies directly to 10-K:** `ActionItemsSuggested(NoteId, IReadOnlyList<Guid>)` is the same shape — give it the identical structural-equality override from day one, don't rediscover the failing spec.

### 2. A no-op provenance event still needs (de)serialiser registration

Every projection's `Handle` calls `EventDeserializer.Deserialize(envelope)`, whose `default` arm **throws** on an unknown type. Even though no projection reacts to `TagsSuggested` (all use `default: break`), the event still flows through `NoteCommandHandler`'s inline projection rebuild on every append, so an unregistered event would throw the moment a note with a suggestion is touched. Registration in `EventDeserializer` is mandatory for *any* new event, reactive or not.

### 3. Event ordering across separate handler calls is guaranteed by call order

`RecordTagSuggestions` and each `TagNote` are separate `NoteCommandHandler.HandleAsync` round-trips (each its own append). Issuing `RecordTagSuggestions` before the `TagNote` loop is sufficient to guarantee `TagsSuggested` gets a lower sequence number than the `NoteTagged` events — asserted directly in the integration test via `SequenceNumber` comparison rather than mere presence.

## Process notes

- **Parallel merge on main:** PR #121 (minor-9) merged on top of this slice's #122 during the run. The Scribe worktree off `origin/main` correctly included both; no action needed, but worth remembering that the merge-gate check for the *next* slice must read the genuinely latest deploy.
- **Pre-existing doc gap (not actioned):** `event-model.md` / `event-schemas.md` still lack the Phase 10 transcription events (`CompleteTranscription`/`TranscriptionCompleted`) from slices 10-C/D/H. Out of scope for 10-I; flagged here so a future doc-sync slice can backfill.

## Done actions applied

- None requiring config/guardrail changes — the slice ran clean (no new permission prompts, no failing gates). The equality-override insight is captured above for reuse in 10-K rather than as a code change.
