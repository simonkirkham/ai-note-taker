# Roadmap

Sequence is learning-optimised: event sourcing plumbing lands in Phase 1 so every subsequent feature is an ES learning moment, not a feature grind.

## Phase 0 — Setup

**Goal:** every tool is wired up, hello world deployed end-to-end, first spec passes.

Slices and acceptance criteria: [docs/phases/phase-0.md](phases/phase-0.md)

## Phase 1 — Walking skeleton with event sourcing

- One aggregate (`Note`), two events (`NoteCreated`, `ContentAppended`)
- Append-with-optimistic-concurrency on DynamoDB
- One read projection (flat list of notes)
- Frontend creates and lists notes

**Goal:** event sourcing plumbing works end-to-end and is covered by event-model-driven specs.

## Phase 2 — Richer note lifecycle

- `NoteRenamed`, `NoteDeleted`, `NoteContentReplaced`
- Event versioning learned by needing it
- Projection rebuild logic exercised

**Goal:** you've changed your mind about an event's shape at least once and survived.

## Phase 3 — Cross-aggregate projection (todo list)

- `ActionItemAdded`, `ActionItemCompleted`
- Projection aggregates action items across all notes into a single todo list

**Goal:** the "power of projections" moment — same events, new read model.

## Phase 4 — Folders and tags

- Another projection axis (organisational view)
- Search built on the projection

## Phase 5 — Google Calendar integration + meeting notes

- Personal Google OAuth credentials (single-user refresh token)
- Calendar read access
- Notes auto-created from calendar events

## Phase 6 — Transcription

- Capture meeting audio
- Transcribe and merge into the note

## Phase 7 — Multi-user auth (Google Sign-In)

- Convert single-user to multi-user
- Reuse OAuth scaffolding from Phase 5

**Goal:** auth lands here deliberately so earlier phases stay focused on event sourcing learning.

## Reflection cadence

End-of-phase reflection in [workflow-log.md](workflow-log.md) is mandatory, not optional.
