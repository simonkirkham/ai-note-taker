# Event Schemas

Canonical shapes for every event in the system. Two layers:

- **Envelope** — what the event store wraps around every event. Aggregates do not produce this.
- **Payload** — the typed event the aggregate emits. This is what `Decide` returns and `Apply` folds.

Companion to [`event-model.md`](./event-model.md), which describes *which* events exist and *when* they fire. This document describes *what they look like on the wire*.

---

## Envelope

Added by the event store layer (`src/EventStore/`) on append; aggregates never see it.

```csharp
public record EventEnvelope(
    string StreamId,        // e.g. "note#7f3a..." or "action#9c1d..."
    long SequenceNumber,    // per-stream version, 1-based
    string EventType,       // e.g. "NoteCreated"
    int EventVersion,       // 1 initially; bump on shape change
    DateTimeOffset OccurredAt,
    string Payload,         // JSON of the typed event below
    EventMetadata Metadata
);

public record EventMetadata(
    Guid CommandId,         // for idempotency / dedup
    string? UserId,         // null until Phase 7 auth lands
    string? CorrelationId,  // trace id from the API request
    string? CausationId     // event id of the event that caused this one (if any)
);
```

**Why timestamp lives only on the envelope:** keeps aggregates pure — no `IClock` dependency in `Decide`. The API layer stamps `OccurredAt` when it appends.

---

## Strongly-typed IDs

```csharp
public readonly record struct NoteId(Guid Value);
public readonly record struct ActionId(Guid Value);
```

Cheap to do, prevents passing a `NoteId` where an `ActionId` is expected. Serialise as the underlying `Guid`.

---

## Note events

```csharp
public abstract record NoteEvent;

public record NoteCreated(NoteId NoteId)                       : NoteEvent;
public record NoteRenamed(NoteId NoteId, string NewTitle)      : NoteEvent;
public record ContentEdited(NoteId NoteId, string Content)     : NoteEvent;  // full snapshot
public record NoteTagged(NoteId NoteId, string Tag)            : NoteEvent;
public record NoteUntagged(NoteId NoteId, string Tag)          : NoteEvent;
public record NoteDateSet(NoteId NoteId, DateOnly Date)        : NoteEvent;
public record NoteDeleted(NoteId NoteId)                       : NoteEvent;
```

### Serialised payload examples

`NoteCreated`:
```json
{ "noteId": "7f3a9c2b-1e4d-4a8f-9c0d-2b1f3a4e5c6d" }
```

`NoteRenamed`:
```json
{ "noteId": "7f3a9c2b-1e4d-4a8f-9c0d-2b1f3a4e5c6d", "newTitle": "Bill 1:1" }
```

`ContentEdited` (full snapshot of the captured-notes area):
```json
{
  "noteId": "7f3a9c2b-1e4d-4a8f-9c0d-2b1f3a4e5c6d",
  "content": "Met with Bill re: API integration. He'll send specs Friday."
}
```

`NoteTagged`:
```json
{ "noteId": "7f3a9c2b-1e4d-4a8f-9c0d-2b1f3a4e5c6d", "tag": "1:1s" }
```

`NoteDateSet`:
```json
{ "noteId": "7f3a9c2b-1e4d-4a8f-9c0d-2b1f3a4e5c6d", "date": "2026-04-29" }
```

*`date` serialises as an ISO 8601 date string (`yyyy-MM-dd`). No time component, no timezone — `DateOnly` maps directly.*

---

## ActionItem events

```csharp
public abstract record ActionItemEvent;

public record ActionItemAdded(
    ActionId ActionId,
    NoteId NoteId,
    string Description) : ActionItemEvent;

public record ActionItemCompleted(ActionId ActionId)                       : ActionItemEvent;
public record ActionItemReopened(ActionId ActionId)                        : ActionItemEvent;
public record ActionItemEdited(ActionId ActionId, string NewDescription)   : ActionItemEvent;
public record ActionItemRemoved(ActionId ActionId)                         : ActionItemEvent;
```

`ActionItemAdded` carries `NoteId` because that's the parent reference the `TodoList` and `NoteCardList` projections need to join on. Subsequent action-item events don't repeat `NoteId` — projections look it up from the `ActionItemAdded` they already saw.

### Serialised payload examples

`ActionItemAdded`:
```json
{
  "actionId": "9c1d4e2a-7b8f-4c3d-a1e6-5f9b2c8d3e7a",
  "noteId": "7f3a9c2b-1e4d-4a8f-9c0d-2b1f3a4e5c6d",
  "description": "Fill out the form"
}
```

`ActionItemCompleted`:
```json
{ "actionId": "9c1d4e2a-7b8f-4c3d-a1e6-5f9b2c8d3e7a" }
```

---

## DynamoDB row shape

What actually lands in the single-table store (see [`dynamodb-event-append`](../dot-claude/skills/dynamodb-event-append/SKILL.md) skill for the append algorithm).

| PK              | SK            | EventType      | EventVersion | Payload (JSON)                          | OccurredAt           | Metadata (JSON) |
|-----------------|---------------|----------------|--------------|-----------------------------------------|----------------------|-----------------|
| `note#7f3a...`  | `v00000001`   | `NoteCreated`  | 1            | `{"noteId":"7f3a..."}`                  | 2026-04-23T09:14:22Z | `{...}`         |
| `note#7f3a...`  | `v00000002`   | `NoteRenamed`  | 1            | `{"noteId":"...","newTitle":"Bill 1:1"}`| 2026-04-23T09:14:38Z | `{...}`         |
| `note#7f3a...`  | `v00000003`   | `ContentEdited`| 1            | `{"noteId":"...","content":"..."}`      | 2026-04-23T09:15:01Z | `{...}`         |
| `note#7f3a...`  | `META#stream` | —              | —            | —                                       | —                    | `currentVersion: 3` |

ActionItem streams use PK `action#<actionId>` with the same SK convention.

---

## Conventions

- **Past-tense names.** `ContentEdited`, not `EditContent`. Events are facts about something that happened.
- **Never edit a published event's shape.** If `ContentEdited` needs a new field, ship `ContentEditedV2` and write an upcaster from V1 → V2 at read time. The old `ContentEdited` records in the store stay valid forever.
- **No nullable fields in V1 events** unless the absence is itself meaningful. Easier to evolve by adding a new event type than by adding a maybe-present field.
- **Strings, not enums, for tags and content.** Validation lives on the aggregate (`Decide`), not in the event shape — the event records what *did* happen, not what's *allowed*.
- **One stream per aggregate instance.** `note#<NoteId>` and `action#<ActionId>` are separate streams; no event spans both. Cross-aggregate views are projection-side joins.
- **Keep payloads small.** `ContentEdited` snapshots are the one place this could grow. Acceptable for now; revisit if a single note routinely exceeds ~100 KB (DynamoDB item limit is 400 KB hard).

---

## Versioning a published event — worked example

Say in Phase 4 we add a `Color` field to `NoteTagged` so tags can be coloured pills.

**Wrong:** edit the existing record. Old events in the store deserialise to `Color = null`, projections silently regress, and you can't tell V1 from V2 without sniffing.

**Right:**

1. Keep the existing `NoteTagged` record untouched.
2. Add `NoteTaggedV2(NoteId NoteId, string Tag, string Color) : NoteEvent`.
3. New `TagNote` commands emit `NoteTaggedV2` (envelope `EventVersion = 2`).
4. Old `NoteTagged` events still deserialise normally.
5. Add an upcaster: when reading, project `NoteTagged` → `NoteTaggedV2(..., Color: "default")` so the rest of the system sees one shape.
6. Aggregate `Apply` and projections handle `NoteTaggedV2` only.

The store contains both V1 and V2 rows forever. That's fine — that's the audit trail.

---

## How to update this document

- Update **at the same time** as `event-model.md` when adding or versioning an event.
- Keep the C# record and the JSON payload example in sync.
- Don't add events here that haven't earned their way into `event-model.md` first.
