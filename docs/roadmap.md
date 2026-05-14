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

## Phase 1.5 - Testing Foundation — Layers 2–5 _(Done)_

Implement the remaining test layers from [ADR 0008](adr/0008-testing-strategy.md). Layer 1 (domain BDD specs) is already in place; this phase adds the other four.

- **Layer 2** — `tests/EventStore.Integration/`: spin up DynamoDB Local via Testcontainers; cover append + read, OCC conflict, empty stream, multi-event batch, schema correctness
- **Layer 3** — `tests/Api.Integration/`: in-process `WebApplicationFactory` tests; cover all endpoints, status codes, response shapes, error-to-status mapping
- **Layer 4** — `tests/Api.Smoke/`: harden existing suite (self-contained arrange per fact, remove cross-test ordering dependencies)
- **Layer 5** — `tests/Infrastructure.Assertions/`: CDK template assertions; cover Lambda env vars, IAM grants, DynamoDB deletion policies, CloudFront SPA routing

**Goal:** every PR is fully validated without an AWS account; the acceptance suite becomes a thin post-deploy smoke check.

## Phase 2 — Richer note lifecycle _(Done)_

- `ContentEdited` (done), `NoteDeleted`, event versioning, projection rebuild
- Event versioning learned by needing it
- Projection rebuild logic exercised

**Goal:** you've changed your mind about an event's shape at least once and survived.

Slices and acceptance criteria: [docs/phases/phase-2.md](phases/phase-2.md)

## Phase 3 — Cross-aggregate projection (todo list) _(Done)_

- `ActionItemAdded`, `ActionItemCompleted`, `ActionItemReopened`, `ActionItemDeleted`
- Projection aggregates action items across all notes into a single todo list
- Complete and delete todos from the home screen

**Goal:** the "power of projections" moment — same events, new read model.

Slices and acceptance criteria: [docs/phases/phase-3.md](phases/phase-3.md)

## Phase 4 — UX redesign (wireframe alignment) _(Done)_

Bring the app in line with the wireframes in `docs/wireframes/`.

- **4-A:** Settable note date (`NoteDateSet` event; date shown in note header and cards)
- **4-B:** Two-column note layout (content left, actions right panel, bordered content area)
- **4-C:** Implicit action add (Enter or blur submits; no Add button)
- **4-D:** Persistent note list sidebar (visible on home and note screens)
- **4-E:** Note summary cards on home screen (new `NoteCard` projection; title, date, snippet, action count)
- **4-F:** Expandable completed todos (new `GET /todos/completed` endpoint; collapse/expand toggle)

**Goal:** the app matches the design intent; projection evolution is demonstrated by `NoteCard` aggregating across multiple event types.

Slices and acceptance criteria: [docs/phases/phase-4.md](phases/phase-4.md)

## Phase 5 — Tags and folders

- Tag notes with free-text labels; tags appear as pills on note cards and the note screen
- `TagIndex` projection powers a filter bar on the home screen (AND/OR multi-select)
- `Folder` aggregate with full hierarchy (create, rename, delete, reparent, cascade delete)
- `FolderTree` projection; drag notes between folders; Unfiled Notes view; folder preview panel
- Note date defaults to today on creation; date input shown without redundant label
- Replaces all `localStorage`-backed prototype state with real API calls

**Goal:** second projection axis (`TagIndex`) alongside an entirely new aggregate (`Folder`); client-side filter state wired to a server projection; hierarchical read models.

Slices and acceptance criteria: [docs/phases/phase-5.md](phases/phase-5.md)

## Phase 6 — Upgrade to .NET 10 _(Done)_

- LTS → LTS upgrade from .NET 8 to .NET 10 across all 10 projects in the solution
- Package compatibility audit; fix any BCL or framework-layer breaking changes
- Update Lambda runtime constant in CDK stack (`Runtime.DOTNET_8` → `Runtime.DOTNET_10`)
- Redeploy and verify with acceptance tests and E2E browser journeys
- Measure cold start baseline; enable Lambda SnapStart; verify Init Duration eliminated

**Goal:** stay on a supported Lambda runtime; learn the .NET release cadence, AWS Lambda managed runtime lifecycle, and how to run a framework upgrade safely behind a full test suite. SnapStart teaches the Lambda version/alias deployment model and how AWS eliminates cold starts via execution environment snapshots.

Slices and acceptance criteria: [docs/phases/phase-6.md](phases/phase-6.md)

## Phase 6.5 — Frontend Component Tests

- Rename all six test projects to scope-descriptive names (`Domain.Specs`, `EventStore.Integration`, `Api.Integration`, `Infrastructure.Assertions`, `Api.Smoke`, `Browser.E2E`)
- Scaffold Vitest + React Testing Library + MSW as Layer 7 of the testing strategy
- Write component tests for every home screen UI behaviour; delete 4 redundant E2E journeys
- Write component tests for every note view UI behaviour; delete 8 redundant E2E journeys; trim Browser.E2E to exactly 5 kept journeys

**Goal:** replace slow Playwright tests as the primary UI regression net with fast, deterministic component tests; learn Vitest, RTL, MSW, and where in the pyramid each test layer earns its cost. 6.5-A done; 6.5-B, C, D in progress.

Slices and acceptance criteria: [docs/phases/phase-6.5.md](phases/phase-6.5.md)

## Phase 7 — Rich note content

- Replace plain textarea with TipTap WYSIWYG editor
- Headings, bold, bullet lists, and checkboxes via keyboard shortcuts
- Heading = discussion topic; one click marks it as discussed (strikethrough)
- Checkboxes for inline agenda items; Action Items panel untouched
- Content stored as markdown string in existing `ContentEditedV2` event — no new events

**Goal:** learn how to integrate a ProseMirror-based editor into a React frontend; understand markdown as a storage format and the tradeoffs of serialising structured editor state to plain text.

Slices and acceptance criteria: [docs/phases/phase-7.md](phases/phase-7.md)

## Phase 8 — Google Calendar integration + meeting notes

- Today's meetings surfaced on the home screen (Google Calendar pass-through, single-user refresh token)
- One-click note creation linked to a calendar event (`NoteLinkedToCalendarEvent`)
- Meeting-time browser reminder via `setTimeout` + Notifications API
- Recurring meetings: one-click note for the next scheduled occurrence
- `CalendarLinkIndex` projection keyed by external calendar event ID
- `EventMetadata.UserId` populated for the first time (groundwork for Phase 10)

**Goal:** first outbound HTTP from Lambda; Google OAuth2 refresh-token flow; SSM Parameter Store for secrets; extending an aggregate with a new event without touching the immutable original; a projection keyed by an external system ID.

Slices and acceptance criteria: [docs/phases/phase-8.md](phases/phase-8.md)

## Phase 9 — Transcription

- Capture meeting audio
- Transcribe and merge into the note

## Phase 10 — Multi-user auth (Google Sign-In)

- Convert single-user to multi-user
- Reuse OAuth scaffolding from Phase 7

**Goal:** auth lands here deliberately so earlier phases stay focused on event sourcing learning.

## Future Ideas

- Workspaces - Switching between collections of notes
- Search across notes

## CI / Dev Experience Backlog

- **Investigate whether CDK synth needs real AWS credentials in `validate.yml`.** If the CDK app does no context lookups (SSM, VPC resolution, etc.), `cdk synth` can run without credentials. If confirmed, remove the `Configure AWS credentials` step and `environment: Test` from `validate.yml` — validate becomes a pure code-quality gate with no AWS dependency.
