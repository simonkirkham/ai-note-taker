# Roadmap

Sequence is learning-optimised: event sourcing plumbing lands in Phase 1 so every subsequent feature is an ES learning moment, not a feature grind.

## Phase 0 — Setup _(Done)_

**Goal:** every tool is wired up, hello world deployed end-to-end, first spec passes.

Slices and acceptance criteria: [docs/phases/phase-0.md](phases/phase-0.md)

## Phase 1 — Walking skeleton with event sourcing _(Done)_

- One aggregate (`Note`), two events (`NoteCreated`, `NoteRenamed`)
- Append-with-optimistic-concurrency on DynamoDB (`TransactWriteItems` + META row)
- One read projection (`NoteTitleList`) in a dedicated DynamoDB table
- React frontend on S3 + CloudFront; create and list notes end-to-end

**Goal:** event sourcing plumbing works end-to-end and is covered by event-model-driven specs.

Slices and acceptance criteria: [docs/phases/phase-1.md](phases/phase-1.md)

## Phase 1.5 - Testing Foundation — Layers 2–5 _(Next)_

Implement the remaining test layers from [ADR 0008](adr/0008-testing-strategy.md). Layer 1 (domain BDD specs) is already in place; this phase adds the other four.

- **Layer 2** — `tests/EventStoreIntegration/`: spin up DynamoDB Local via Testcontainers; cover append + read, OCC conflict, empty stream, multi-event batch, schema correctness
- **Layer 3** — `tests/ApiIntegration/`: in-process `WebApplicationFactory` tests; cover all endpoints, status codes, response shapes, error-to-status mapping
- **Layer 4** — `tests/Acceptance/`: harden existing suite (self-contained arrange per fact, remove cross-test ordering dependencies)
- **Layer 5** — `tests/InfraAssertions/`: CDK template assertions; cover Lambda env vars, IAM grants, DynamoDB deletion policies, CloudFront SPA routing

**Goal:** every PR is fully validated without an AWS account; the acceptance suite becomes a thin post-deploy smoke check.

## Phase 2 — Richer note lifecycle _(In Progress)_

- `ContentEdited` (done), `NoteDeleted`, event versioning, projection rebuild
- Event versioning learned by needing it
- Projection rebuild logic exercised

**Goal:** you've changed your mind about an event's shape at least once and survived.

Slices and acceptance criteria: [docs/phases/phase-2.md](phases/phase-2.md)

## Phase 3 — Cross-aggregate projection (todo list) _(In Progress)_

- `ActionItemAdded`, `ActionItemCompleted`
- Projection aggregates action items across all notes into a single todo list

**Goal:** the "power of projections" moment — same events, new read model.

Slices and acceptance criteria: [docs/phases/phase-3.md](phases/phase-3.md)

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
