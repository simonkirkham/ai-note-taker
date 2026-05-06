# Phase 2-C Learnings — Event Versioning

## What we built

Introduced `ContentEditedV2` (adds `CharacterCount: int`) while keeping `ContentEdited` v1 readable. The key design decision: the domain aggregate continues to *emit* `ContentEdited`; `NoteCommandHandler.ToEnvelopes` upgrades it to v2 wire format at the infrastructure boundary. `EventDeserializer` routes on `(EventType, EventVersion)` tuple pattern matching.

## What worked well

**Infrastructure-boundary upgrade pattern** avoided touching any existing domain specs. All 28 BDD specs stayed green without modification — the aggregate remained oblivious to the wire format change. This validates the "aggregates are pure" invariant from CLAUDE.md.

**Tuple pattern matching on `(EventType, EventVersion)`** is a clean, exhaustive routing mechanism. Adding a v3 in future is one line: `(nameof(ContentEdited), 3) => ...`. The wildcard arm (`_`) for events without versioning (`NoteCreated`, `NoteRenamed`) avoids redundant version columns.

**Three-test coverage strategy for versioning specs:**
1. v1 backward compatibility (content still updates)
2. v2 forward (content updates via new path)
3. Explicit type assertion (`Assert.IsType<ContentEditedV2>`) — critical because STJ silently ignores unknown fields, so tests 1 and 2 would pass even with a broken deserializer; test 3 catches the routing failure specifically.

## What was surprising or non-obvious

**The aggregate needs `ContentEditedV2` in `Apply`** even though it never emits it. When rebuilding from history, the deserializer returns `ContentEditedV2` for v2 envelopes, so the aggregate must handle that type to correctly restore `_content`. The comment "aggregate is unaware of wire format" is inaccurate — it's better stated as "the aggregate does not *emit* v2; the infrastructure layer upgrades on write." Hawk caught this and it was fixed before merge.

**STJ's silent field-ignoring is a testing hazard.** Without the explicit type assertion test, the deserializer routing bug (returning `ContentEdited` instead of `ContentEditedV2` for v2 envelopes) would be invisible — both content-update tests would pass because STJ deserializes `ContentEditedV2` JSON into `ContentEdited` by ignoring `CharacterCount`. Always add a type assertion when versioned deserialization is introduced.

**`CharacterCount` is not surfaced in the read projection.** The `NoteDetailView` doesn't expose `CharacterCount`; it lives only in the event stream payload. This is intentional for this slice (learning versioning mechanics, not adding a feature) but future slices may want to expose it in a stats view.

## Workflow notes

- This was a backend-only slice — Stylist was correctly skipped.
- Hawk found the comment inaccuracy on first review; Pip applied the fix before merge. One round, clean.
- Feature branch `slice/2-c-event-versioning` was used correctly; PR #10 merged via squash.
