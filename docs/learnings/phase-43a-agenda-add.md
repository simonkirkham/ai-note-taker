# Phase 43-A — Add a meeting agenda item

**Slice:** add an agenda item to a note (the first slice of the Phase 43 meeting-agenda feature). PR #368, deploy #671 (run 28468842329), live.

## What shipped

- `AgendaItemAdded` event on the Note stream + `AddAgendaItem` command (`Note.HandleAddAgendaItem`: exists/deleted guard, trim, blank → `ArgumentException`, position = capture order).
- Read model **composed onto `NoteDetailView`** (new `Agenda` field of `AgendaItemView{itemId,text,discussed,position}`, folded in `NoteDetailProjection`), mapped in `DynamoDbNoteDetailStore`, surfaced on `GET /notes/{id}`. New route `POST /notes/{id}/agenda-items`.
- Frontend: optimistic `useAddAgendaItem` + `AgendaSection` in the note header.

## The decision worth remembering: compose onto an existing view vs. a dedicated store

The phase doc tentatively sketched a dedicated `AgendaView` projection + `IAgendaStore` + DynamoDB table (mirroring `TagIndexProjection`), but **delegated the decision to 43-A**. The right call was to **compose the agenda onto `NoteDetailView`** instead. Decision rule that generalises:

| Build a dedicated `*Projection` + `I*Store` + table | Compose a field onto an existing `*View` |
|---|---|
| Data is queried **independently / across entities** (e.g. the global tag index: "all notes with tag X") | Data is **sub-entity-scoped** and **always read with its parent**, never queried across parents |
| Tags → `TagIndexStore` (GET /tags lists across notes) | **Agenda → `NoteDetailView.Agenda`** (only ever read as part of the note) |

Composing won three guardrails for free:
1. **No "new projection ships empty → backfill" step** (the Phase 22 trap) — there's no new table; existing notes correctly read an empty agenda, and there are no historical `AgendaItemAdded` events to backfill.
2. **Deploy-time neutral** — no new CDK resource.
3. **No async-projection authz/lag pitfalls** (BUG-30) — nothing new to authorize against; the agenda rides the note's own read.

Cost of composing: the "new field on an existing `*View` must be mapped in `DynamoDb*Store` too" guardrail (33-B2/OwnerName) applies — handled by mapping `Agenda` in both `UpsertAsync` and `MapItemToNoteDetailView`/`ReadAgenda` and adding an `EventStore.Integration` round-trip test (the in-memory double keeps the field by reference and can't catch a missing mapping). Structured list stored as DynamoDB `L`-of-`M`, mirroring `InstructionResponses`.

**Lesson:** a phase doc that says "dedicated projection" is a default, not a mandate — when the new data is only ever read with its parent entity, compose it onto the parent's view. It's less code, no backfill, neutral deploy, and dodges the async-projection authz traps.

## Stale architecture fact corrected

The recalled memory + CLAUDE.md text said projections update **inline in command handlers** (`NoteCommandHandler.UpdateProjectionAsync`). That is **outdated**: since RYW-2 the handler is **append-only** (returns the new stream version as the write token), and a separate **projector** (`src/Api/Projections/ProjectionUpdater.cs`, run by the `SyncProjectingEventStore` decorator in-process / the Projector Lambda in prod) is the sole writer of read models. The `[[project_projections_update_inline]]` memory was rewritten to reflect this. New fold logic goes in the relevant `*Projection.Handle` (used by both the live projector and `ProjectionRebuildHandler`) — never an `IDomainEventHandler` (that seam was deleted, PR #171).

## Process note

User flagged repeated permission prompts again and rejected the `Monitor` tool ("stop forcing permissions"). For CI/deploy polling, prefer the read-only helper scripts (`scripts/deploy-status.sh`, `scripts/merge-gate.sh`) as **single** Bash calls, or a `run_in_background` Bash with an `until` loop (one completion notification) — not the `Monitor` tool, which requires a per-launch approval. See the human-input-log row for 43-A.
