# Phase 1 — Walking Skeleton with Event Sourcing

**Goal:** event sourcing plumbing works end-to-end and is covered by event-model-driven specs. By the end of this phase you can create a note, give it a title, and see it in a list — deployed, pipeline green, specs covering every layer.

**Scope note:** The roadmap lists `NoteCreated` + `ContentAppended` as the two Phase 1 events. The event model has since resolved `ContentAppended` → `ContentEdited` (full snapshot). This phase uses `NoteCreated` + `NoteRenamed` instead — you need a title to have a meaningful list. `ContentEdited` lands in Phase 2 alongside the note detail view.

Status key: `Done` · `In Progress` · `Not Started`

---

## Slice 1-A — Note aggregate: CreateNote + RenameNote
**Status:** Not Started

**Objective:** Implement the `Note` aggregate as a pure C# type in `src/Domain/`. No I/O, no database. Exercises the core event-sourcing pattern: command in, events out, state rebuilt by folding prior events.

**Commands in scope:** `CreateNote`, `RenameNote`  
**Events in scope:** `NoteCreated`, `NoteRenamed`

**Acceptance criteria:**
- [ ] `NoteId` is a strongly-typed record struct wrapping `Guid` (per event-schemas.md)
- [ ] `NoteCreated` and `NoteRenamed` C# records match the shapes in `event-schemas.md`
- [ ] `Note` aggregate is pure: no constructor dependencies, no I/O, no clock
- [ ] BDD spec — `CreateNote` happy path: `Given()` no prior events `.When(CreateNote)` `.Then(NoteCreated)`
- [ ] BDD spec — `CreateNote` guard: `.ThenThrows<InvalidOperationException>()` when note already exists
- [ ] BDD spec — `RenameNote` happy path: `Given(NoteCreated)` `.When(RenameNote)` `.Then(NoteRenamed)`
- [ ] BDD spec — `RenameNote` guard: `.ThenThrows<InvalidOperationException>()` when note does not exist
- [ ] BDD spec — `RenameNote` no-op: no event emitted when new title equals current title
- [ ] `dotnet test` passes green; `dotnet build` 0 warnings

---

## Slice 1-B — DynamoDB event store
**Status:** Not Started

**Objective:** Implement `IEventStore` in `src/EventStore/` with a DynamoDB backend. This is the core infrastructure learning moment: append-with-optimistic-concurrency using a conditional write.

**Acceptance criteria:**
- [ ] `IEventStore` interface defined with `AppendAsync(streamId, expectedVersion, events)` and `ReadAsync(streamId)`
- [ ] `EventEnvelope` C# record matches `event-schemas.md`
- [ ] DynamoDB implementation appends events using the row shape in `event-schemas.md` (PK `note#<id>`, SK `v00000001`, META row for current version)
- [ ] Optimistic concurrency: append fails with a typed exception (`ConcurrencyException`) if the stream's current version does not match `expectedVersion`
- [ ] BDD spec — append to empty stream succeeds, sequence numbers start at 1
- [ ] BDD spec — append with correct expected version succeeds
- [ ] BDD spec — append with stale expected version throws `ConcurrencyException`
- [ ] BDD spec — read returns events in sequence order
- [ ] CDK stack updated: `notetaker-events` DynamoDB table added (PK `PK` String, SK `SK` String, `PAY_PER_REQUEST`)
- [ ] `cdk synth` exits 0; `dotnet test` passes green

---

## Slice 1-C — Create Note API endpoint
**Status:** Not Started

**Objective:** Wire the first end-to-end slice: `POST /notes` accepts a command, appends `NoteCreated` to DynamoDB, returns 201 with the new `noteId`. Proves the aggregate + event store + API layer work together.

**Acceptance criteria:**
- [ ] `POST /notes` returns `201 Created` with body `{ "noteId": "<guid>" }`
- [ ] `NoteCreated` event is appended to the `notetaker-events` table
- [ ] Calling `POST /notes` twice with the same `noteId` returns `409 Conflict`
- [ ] BDD acceptance spec: `Given` the Lambda is deployed, `When` `POST /notes` is called, `Then` `201` with a `noteId`
- [ ] Acceptance spec runs in the deploy pipeline (gated by `API_BASE_URL`)
- [ ] `dotnet test` passes green; deploy pipeline green

---

## Slice 1-D — RenameNote endpoint + NoteTitleList projection + GET /notes
**Status:** Not Started

**Objective:** Add the rename command, build the `NoteTitleList` projection, and expose `GET /notes`. First time the full read-side of event sourcing is exercised: event appended → projection updated → query returns result.

**Acceptance criteria:**
- [ ] `PATCH /notes/{id}/title` with body `{ "title": "..." }` appends `NoteRenamed`, returns `200`
- [ ] `PATCH /notes/{id}/title` with the same title as current is a no-op: returns `200`, no event appended
- [ ] `PATCH /notes/{id}/title` for a non-existent note returns `404`
- [ ] `NoteTitleList` projection subscribes to `NoteCreated` and `NoteRenamed` and matches the shape in `view-schemas.md`
- [ ] Projection stored in a dedicated DynamoDB table (`notetaker-proj-notetitlelist`)
- [ ] `GET /notes` returns `NoteTitleListView` JSON matching `view-schemas.md`, ordered by `lastModifiedAt` descending
- [ ] BDD spec for the `NoteTitleList` projection fold (unit — no DynamoDB)
- [ ] BDD acceptance specs for `PATCH /notes/{id}/title` and `GET /notes` (gated by `API_BASE_URL`)
- [ ] CDK stack updated: projection table provisioned
- [ ] `cdk synth` exits 0; `dotnet test` passes green; deploy pipeline green

---

## Slice 1-E — React scaffold + create/list notes UI
**Status:** Not Started

**Objective:** Scaffold the frontend and deploy it to AWS. By the end, a user can open the app, create a note, name it, and see it in the list — the full walking skeleton is walkable.

**Acceptance criteria:**
- [ ] Vite + React + TypeScript app in `web/` with `npm run dev` serving on `localhost:5173`
- [ ] `npm run build` produces a `dist/` folder with no errors
- [ ] UI: "New Note" button calls `POST /notes` and navigates to a rename input
- [ ] UI: typing in the rename input and blurring calls `PATCH /notes/{id}/title`
- [ ] UI: note list on home page calls `GET /notes` and renders titles
- [ ] CDK stack updated: S3 bucket + CloudFront distribution serving `web/dist/`
- [ ] Deployed app reachable at the CloudFront URL
- [ ] PR workflow extended: `npm ci && npm run build` added to the checks
- [ ] Deploy workflow extended: `npm ci && npm run build` runs before CDK deploy
- [ ] CORS configured on the API Gateway so the React app can call the Lambda
