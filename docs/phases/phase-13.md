# Phase 13 — Feedback capture for AI suggestions

**Goal:** Capture which AI-suggested **tags** and **action items** users keep, remove, or complete — as a permanent, rebuildable signal — without changing any AI behaviour. This lays the data foundation for later prompt/model tuning; using the signal is explicitly out of scope here.

**Learning surface:** Purely *additive* provenance events (no versioning of hot events); projections that maintain **derivation state** (per-note tag provenance, per-action-item provenance) and *classify* events by combining them rather than copying them — the first read models in this codebase that do so; deriving an absence-of-event signal at read time; two contrasting read-model shapes from one idea — a *per-value* index (tags) vs a *per-user rate* (actions); single-table design holding both aggregate and provenance rows.

**Reference:** the `event-modelling`, `aggregate-command`, and `projection` skills are the implementation blueprints for this phase.

---

## The problem

The analyse path (`src/Api/Handlers/TranscriptionHandlers.cs`) makes the AI contribute two kinds of content to a note, and both go through the **same commands a human uses**, so AI-origin is invisible:

| AI contribution | Command → event | Why the correction signal is lost |
|---|---|---|
| Tags | `TagNote` → `NoteTagged` (lines ~73-75) | A later `NoteUntagged` can't be told apart from a human tidying up their own tag. |
| Action items | `AddActionItem` → `ActionItemAdded` (lines ~81-82) | A later `ActionItemDeleted` can't be told apart from a human deleting their own task. |

In both cases the user's *correction* — deleting an AI suggestion — is a signal for improving the AI prompt, and it is currently thrown away. This phase records the provenance so the signal becomes durable, queryable data. The event-sourcing payoff: once the provenance events are in the stream, the derived projections are rebuildable over full history whenever we choose to act on them.

**Two signals, different shapes:**

- **Tags are repeating categorical values** → the tag projection is keyed *per tag value*, so analysis can learn "stop suggesting `q3-planning` for this user." Signal = suggested vs removed.
- **Action items are unique free text** → you cannot blocklist a value. The action projection is a *per-user quality rate*: of the actions the AI extracted, how many were **deleted** (rejected) vs **completed** (confirmed a real task). Actions have a lifecycle tags lack, so completion is a distinct positive signal worth capturing.

---

## New events

| Event | Aggregate | Payload | Notes |
|---|---|---|---|
| `TagsSuggested` | `Note` | `tags: string[]` | AI tags **newly applied** by an analysis run (post-dedup against tags already on the note). `Apply` is a no-op — audit/provenance only. |
| `ActionItemsSuggested` | `Note` | `actionItemIds: Guid[]` | IDs of the action items the analysis run **newly created** (the handler generates these IDs). `Apply` is a no-op. |

Raised by new commands `RecordTagSuggestions(NoteId, Tags)` and `RecordActionItemSuggestions(NoteId, ActionItemIds)`. Pre-conditions: note exists and is not deleted; raise nothing if the list is empty.

> **Deferred to the Phase 10-G eval work:** stamping `modelId` / `promptVersion` onto the `*Suggested` events. That is a deliberate event-versioning exercise for later. Kept out of v1 to avoid speculative fields.

---

## Slice order and dependencies

```
13-A  TagsSuggested event ───────────────▶ 13-B  TagFeedbackProjection (per-tag-value: suggested/rejected)
13-C  ActionItemsSuggested event ────────▶ 13-D  ActionItemFeedbackProjection (per-user: suggested/deleted/completed)
```

13-A/13-B (tags) and 13-C/13-D (actions) are independent tracks; either pair can land first. Within a track, the projection slice depends on its event slice.

---

## Slice 13-A — Record AI tag suggestions

**Status:** Not started

**Value:** Each analysis run records, as a first-class event, exactly which tags the AI contributed — so a later deletion of one is unambiguously a rejected AI tag.

**Commands in scope:** `RecordTagSuggestions` (new)
**Events in scope:** `TagsSuggested` (new)
**CDK changes:** none.

### Design

- `src/Domain/Notes/RecordTagSuggestions.cs` — `record RecordTagSuggestions(NoteId NoteId, IReadOnlyList<string> Tags) : NoteCommand;` (mirror `TagNote.cs`).
- `src/Domain/Notes/TagsSuggested.cs` — `record TagsSuggested(NoteId NoteId, IReadOnlyList<string> Tags) : NoteEvent;` (mirror `NoteTagged.cs`).
- `src/Domain/Notes/Note.cs` — add the `RecordTagSuggestions` case to the `Handle` switch; a `HandleRecordTagSuggestions` method (guard exists + not deleted; return `[]` if `Tags` empty, else one `TagsSuggested`); a no-op `Apply(TagsSuggested)` case so rebuild accepts it.
- `src/Api/Handlers/TranscriptionHandlers.cs` (`AnalyseNote`) — compute the post-dedup applied tag set (the existing `Where(t => !existingTags.Contains(t, …))` list); if non-empty, call `RecordTagSuggestions(noteId, appliedTags)` **before** the per-tag `TagNote` calls, so `TagsSuggested` precedes the `NoteTagged` events in stream order.
- Register the event in `EventDeserializer` / the event-type map.

### Key implementation files

- `src/Domain/Notes/{RecordTagSuggestions,TagsSuggested,Note}.cs`
- `src/Api/Handlers/TranscriptionHandlers.cs`
- event-type registration (`EventDeserializer`)
- `docs/event-model.md` + `docs/event-schemas.md`
- `tests/Domain.Specs/` + `tests/Api.Integration/`

### Scenarios

```
Scenario: Recording suggestions raises TagsSuggested
  Given a Note exists
  When RecordTagSuggestions is handled with ["auth", "backend"]
  Then TagsSuggested is raised with tags ["auth", "backend"]

Scenario: An empty suggestion list raises nothing
  Given a Note exists
  When RecordTagSuggestions is handled with []
  Then no event is raised

Scenario: Recording on a missing note is rejected
  Given no Note exists
  When RecordTagSuggestions is handled
  Then it throws InvalidOperationException

Scenario: Analysis records only the newly-applied AI tags
  Given a Note already tagged "auth" and a transcript about login and auth
  When POST /notes/{id}/analyse runs and the model returns ["auth", "login"]
  Then a TagsSuggested event is appended listing only ["login"]
  And NoteTagged is appended for "login"
```

### Acceptance criteria

- [ ] `RecordTagSuggestions` command + `TagsSuggested` event added; `Note` handles and applies (no-op) them
- [ ] Empty tag list raises no event; missing/deleted note throws
- [ ] `AnalyseNote` records the post-dedup applied tag set as `TagsSuggested` before the `NoteTagged` events
- [ ] Event registered for (de)serialisation; existing streams still rebuild
- [ ] `docs/event-model.md` + `docs/event-schemas.md` updated
- [ ] Domain.Specs + Api.Integration specs green; `cdk synth` succeeds

---

## Slice 13-B — Tag feedback projection

**Status:** Not started

**Value:** Per user, per tag: how many times AI-suggested and how many later removed. Queryable ad hoc (the intended analysis path); rebuildable from history.

**Commands in scope:** none
**Events consumed:** `TagsSuggested`, `NoteUntagged`, `NoteDeleted`
**CDK changes:** one new projection table.

### Design (mirror the TagIndex trio)

- **View:** `TagFeedbackView(string UserId, string Tag, int SuggestedCount, int RejectedCount)` — `Accepted` = `Suggested − Rejected`, derived at read time, not stored.
- **Store:** `ITagFeedbackStore` + `DynamoDbTagFeedbackStore` (`src/EventStore/Projections/`). Single table `notetaker-proj-tagfeedback` holding two row types:
  - *Aggregate* — `PK=USER#{userId}`, `SK=TAG#{tag}` → `SuggestedCount`, `RejectedCount`.
  - *Provenance* — `PK=NOTE#{noteId}`, `SK=TAG#{tag}` (carries `UserId`) → marks a tag AI-suggested on that note; the state needed to classify a later untag.
- **Event handler:** `src/Api/Projections/TagFeedbackEventHandler.cs` (`IDomainEventHandler`), reading `UserId` from `envelope.Metadata.UserId` (exactly as `TagIndexEventHandler.cs`):
  - `TagsSuggested` → per tag: `SuggestedCount++`; write the provenance row.
  - `NoteUntagged` → if provenance `(noteId, tag)` present: `RejectedCount++` and **delete** the provenance row (only a fresh `TagsSuggested` re-arms it — prevents a manual re-add/remove from double-counting).
  - `NoteDeleted` → delete that note's provenance rows; **counts untouched** (deletion is not tag rejection).
  - `NoteTagged` → ignored (acceptance is derived).
- **Rebuild:** `TagFeedbackProjection` (same `Handle`/`GetAll` shape as `TagIndexProjection.cs`); add an instance to `ProjectionRebuildHandler` and upsert its rows.
- **Wiring:** register store + handler in `src/Api/Builder.cs`; read `PROJ_TAGFEEDBACK_TABLE_NAME` in `Program.cs`; create the table in `NoteTakerStack.cs` (mirror `ProjTagIndexTable`, `RemovalPolicy.RETAIN`) and pass the env var into the Lambda `Environment` dict.

**Accepted approximations (documented):** an accepted tag removed during unrelated cleanup months later still counts as rejected (no time-weighting in v1).

### Key implementation files

- `src/EventStore/Projections/{TagFeedbackView,ITagFeedbackStore,DynamoDbTagFeedbackStore,TagFeedbackProjection}.cs`
- `src/Api/Projections/TagFeedbackEventHandler.cs`
- `src/Api/{Builder,Program}.cs`; `src/Api/CommandHandlers/ProjectionRebuildHandler.cs`
- `src/Infrastructure/NoteTakerStack.cs`; `tests/Infrastructure.Assertions/`
- `docs/view-schemas.md`

### Scenarios

```
Scenario: A suggested tag increments the suggested count
  Given an empty TagFeedback projection
  When TagsSuggested for user "alice" lists ["auth"] on note N
  Then feedback for (alice, "auth") has suggested=1, rejected=0

Scenario: Removing a suggested tag increments the rejected count
  Given user "alice" was suggested "auth" on note N
  When "auth" is untagged from note N
  Then feedback for (alice, "auth") has suggested=1, rejected=1

Scenario: Removing a manually-added tag is not a rejection
  Given "auth" was added to note N with no prior suggestion
  When "auth" is untagged from note N
  Then no rejected count is recorded for "auth"

Scenario: A rejection counts once per suggestion
  Given "auth" was suggested then untagged on note N (rejected=1)
  When "auth" is manually re-added to note N and removed again
  Then rejected for (alice, "auth") stays 1

Scenario: Deleting a note clears provenance but not counts
  Given user "alice" was suggested "auth" on note N (suggested=1)
  When note N is deleted
  Then suggested for (alice, "auth") remains 1
  And provenance for (N, "auth") is removed

Scenario: The projection rebuilds from the event stream
  Given a stream with TagsSuggested and NoteUntagged events
  When projections are rebuilt
  Then TagFeedback counts equal the live projection's
```

### Acceptance criteria

- [ ] View, store (single table, two row types), and handler added; `UserId` from `envelope.Metadata`; `NoteTagged` ignored
- [ ] Rejection consumes its provenance row; note deletion clears provenance without altering counts
- [ ] Wired into `ProjectionRebuildHandler`; rebuild reproduces live counts
- [ ] Registered in `Builder.cs`; env var in `Program.cs` + CDK; table created with `RETAIN`
- [ ] `Infrastructure.Assertions` asserts the table; `docs/view-schemas.md` updated
- [ ] All specs green; `cdk synth` succeeds; `cdk diff` reviewed before deploy

---

## Slice 13-C — Record AI action-item suggestions

**Status:** Not started

**Value:** Each analysis run records which action items the AI extracted (by ID), so a later deletion or completion of one is attributable to the AI.

**Commands in scope:** `RecordActionItemSuggestions` (new, on `Note`)
**Events in scope:** `ActionItemsSuggested` (new)
**CDK changes:** none.

### Design

- `src/Domain/Notes/RecordActionItemSuggestions.cs` — `record RecordActionItemSuggestions(NoteId NoteId, IReadOnlyList<Guid> ActionItemIds) : NoteCommand;`.
- `src/Domain/Notes/ActionItemsSuggested.cs` — `record ActionItemsSuggested(NoteId NoteId, IReadOnlyList<Guid> ActionItemIds) : NoteEvent;`.
- `src/Domain/Notes/Note.cs` — `Handle` case + `HandleRecordActionItemSuggestions` (guard exists + not deleted; `[]` if empty) + no-op `Apply(ActionItemsSuggested)`.
- `src/Api/Handlers/TranscriptionHandlers.cs` (`AnalyseNote`) — the loop already generates an `ActionId` per new action. Collect those IDs; if any were created, after the `AddActionItem` calls issue `RecordActionItemSuggestions(noteId, createdIds)`.
- Register the event for (de)serialisation.

> **Why on `Note`, by ID:** symmetric with `TagsSuggested`, keeps the hot `ActionItemAdded` event unversioned, and the deletion/completion events on the `ActionItem` aggregate carry the `ActionId`, so the projection (13-D) matches by ID regardless of which stream the suggestion event sits in.

### Key implementation files

- `src/Domain/Notes/{RecordActionItemSuggestions,ActionItemsSuggested,Note}.cs`
- `src/Api/Handlers/TranscriptionHandlers.cs`
- event-type registration; `docs/event-model.md` + `docs/event-schemas.md`
- `tests/Domain.Specs/` + `tests/Api.Integration/`

### Scenarios

```
Scenario: Recording action suggestions raises ActionItemsSuggested
  Given a Note exists
  When RecordActionItemSuggestions is handled with [id1, id2]
  Then ActionItemsSuggested is raised listing [id1, id2]

Scenario: An empty list raises nothing
  Given a Note exists
  When RecordActionItemSuggestions is handled with []
  Then no event is raised

Scenario: Analysis records the IDs of the action items it created
  Given a Note and a transcript with "Alice will fix the login bug"
  When POST /notes/{id}/analyse extracts one action item for the current user
  Then ActionItemAdded is appended for it
  And ActionItemsSuggested is appended listing that action item's ID
```

### Acceptance criteria

- [ ] `RecordActionItemSuggestions` command + `ActionItemsSuggested` event added; `Note` handles and applies (no-op) them
- [ ] Empty list raises nothing; missing/deleted note throws
- [ ] `AnalyseNote` records the IDs of the action items it created, after creating them
- [ ] Event registered for (de)serialisation; existing streams still rebuild
- [ ] `docs/event-model.md` + `docs/event-schemas.md` updated
- [ ] Domain.Specs + Api.Integration specs green; `cdk synth` succeeds

---

## Slice 13-D — Action-item feedback projection

**Status:** Not started

**Value:** Per user: of the action items the AI extracted, how many were **deleted** (rejected extraction) and how many **completed** (confirmed a real task) — an extraction-precision picture. Queryable ad hoc; rebuildable.

**Commands in scope:** none
**Events consumed:** `ActionItemsSuggested`, `ActionItemDeleted`, `ActionItemCompleted`
**CDK changes:** one new projection table.

### Design

- **View:** `ActionItemFeedbackView(string UserId, int SuggestedCount, int DeletedCount, int CompletedCount)` — keyed **per user only** (free-text descriptions don't aggregate per-value, unlike tags).
- **Store:** `IActionItemFeedbackStore` + `DynamoDbActionItemFeedbackStore`. Single table `notetaker-proj-actionfeedback` holding two row types:
  - *Aggregate* — `PK=USER#{userId}` → `SuggestedCount`, `DeletedCount`, `CompletedCount`.
  - *Provenance* — `PK=ACTION#{actionItemId}` (carries `UserId`) → marks an action item AI-extracted.
- **Event handler:** `src/Api/Projections/ActionItemFeedbackEventHandler.cs` (`IDomainEventHandler`), reading `UserId` from `envelope.Metadata.UserId`:
  - `ActionItemsSuggested` → per ID: `SuggestedCount++`; write provenance `(actionItemId, userId)`.
  - `ActionItemDeleted` → if provenance for that `ActionId` present: `DeletedCount++`.
  - `ActionItemCompleted` → if provenance present: `CompletedCount++`.
  - Provenance is **not** consumed — `ActionId`s are unique and immutable, so there is no double-count risk (an item completed then deleted may increment both, which is acceptable for a quality signal).
- **Rebuild:** `ActionItemFeedbackProjection`; add an instance to `ProjectionRebuildHandler`.
- **Wiring:** register store + handler in `Builder.cs`; read `PROJ_ACTIONFEEDBACK_TABLE_NAME` in `Program.cs`; create the table in `NoteTakerStack.cs` (`RETAIN`) and pass the env var into the Lambda dict.

**Accepted approximations (documented):** completed-then-deleted increments both counts; reopen and edit are ignored in v1.

### Key implementation files

- `src/EventStore/Projections/{ActionItemFeedbackView,IActionItemFeedbackStore,DynamoDbActionItemFeedbackStore,ActionItemFeedbackProjection}.cs`
- `src/Api/Projections/ActionItemFeedbackEventHandler.cs`
- `src/Api/{Builder,Program}.cs`; `src/Api/CommandHandlers/ProjectionRebuildHandler.cs`
- `src/Infrastructure/NoteTakerStack.cs`; `tests/Infrastructure.Assertions/`
- `docs/view-schemas.md`

### Scenarios

```
Scenario: A suggested action increments the suggested count
  Given an empty ActionItemFeedback projection
  When ActionItemsSuggested for user "alice" lists [id1]
  Then feedback for "alice" has suggested=1, deleted=0, completed=0

Scenario: Deleting an AI-suggested action increments the deleted count
  Given action id1 was AI-suggested for user "alice"
  When id1 is deleted
  Then feedback for "alice" has deleted=1

Scenario: Completing an AI-suggested action increments the completed count
  Given action id1 was AI-suggested for user "alice"
  When id1 is completed
  Then feedback for "alice" has completed=1

Scenario: Deleting a manually-added action is not counted
  Given action id2 was added by the user with no prior suggestion
  When id2 is deleted
  Then no deleted count is recorded for "alice"

Scenario: The projection rebuilds from the event stream
  Given a stream with ActionItemsSuggested, ActionItemDeleted, ActionItemCompleted events
  When projections are rebuilt
  Then ActionItemFeedback counts equal the live projection's
```

### Acceptance criteria

- [ ] View (per-user), store (single table, two row types), and handler added; `UserId` from `envelope.Metadata`
- [ ] Deleted/completed counted only for AI-suggested action IDs; manual actions ignored
- [ ] Wired into `ProjectionRebuildHandler`; rebuild reproduces live counts
- [ ] Registered in `Builder.cs`; env var in `Program.cs` + CDK; table created with `RETAIN`
- [ ] `Infrastructure.Assertions` asserts the table; `docs/view-schemas.md` updated
- [ ] All specs green; `cdk synth` succeeds; `cdk diff` reviewed before deploy

---

## Explicitly out of scope (deferred)

- **Using the signals** — negative-example prompting (tags) and tuning the action-extraction prompt for precision. This belongs with the prompt/model-optimisation work, run manually once enough data has accrued. The data is captured and rebuildable, so it can happen any time later.
- **Hard suppression** of strongly-rejected tags before they are applied.
- **Read endpoint / UI** for either feedback model — query DynamoDB directly when analysing.
- **`modelId` / `promptVersion`** on the `*Suggested` events — pairs with the Phase 10-G eval harness (a future event-versioning exercise).
- **Time-weighting** of rejections, action **edits**, and reopen handling.

---

## Verification

- `dotnet test tests/Domain.Specs` — `RecordTagSuggestions`, `RecordActionItemSuggestions`, and both projection-classification specs.
- `dotnet test tests/Api.Integration` — `POST /notes/{id}/analyse` appends `TagsSuggested` (applied tag set) and `ActionItemsSuggested` (created action IDs).
- `dotnet test tests/Infrastructure.Assertions` — both new tables exist.
- `cdk synth` / `cdk diff` before deploy.
- Post-deploy ad-hoc check (the intended analysis path): analyse a note, delete one suggested tag and one suggested action, complete another action, then query the feedback tables and confirm the counts:
  - `aws dynamodb query --table-name notetaker-proj-tagfeedback --key-condition-expression "PK = :u" … --profile prod --region eu-west-2`
  - `aws dynamodb get-item --table-name notetaker-proj-actionfeedback --key '{"PK":{"S":"USER#<id>"}}' --profile prod --region eu-west-2`
