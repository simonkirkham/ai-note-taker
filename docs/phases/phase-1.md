# Phase 1 — Walking Skeleton with Event Sourcing

**Goal:** event sourcing plumbing works end-to-end and is covered by event-model-driven specs. By the end of this phase you can create a note, give it a title, and see it in a list — deployed, pipeline green, specs covering every layer.

**Scope note:** The roadmap lists `NoteCreated` + `ContentAppended` as the two Phase 1 events. The event model has since resolved `ContentAppended` → `ContentEdited` (full snapshot). This phase uses `NoteCreated` + `NoteRenamed` instead — you need a title to have a meaningful list. `ContentEdited` lands in Phase 2 alongside the note detail view.

Status key: `Done` · `In Progress` · `Not Started`

---

## Slice 1-A — Note aggregate: CreateNote + RenameNote
**Status:** Done

**Objective:** Implement the `Note` aggregate as a pure C# type in `src/Domain/`. No I/O, no database. Exercises the core event-sourcing pattern: command in, events out, state rebuilt by folding prior events.

**Commands in scope:** `CreateNote`, `RenameNote`  
**Events in scope:** `NoteCreated`, `NoteRenamed`

**Acceptance criteria:**
- [x] `NoteId` is a strongly-typed record struct wrapping `Guid` (per event-schemas.md)
- [x] `NoteCreated` and `NoteRenamed` C# records match the shapes in `event-schemas.md`
- [x] `Note` aggregate is pure: no constructor dependencies, no I/O, no clock
- [x] BDD spec — `CreateNote` happy path: `Given()` no prior events `.When(CreateNote)` `.Then(NoteCreated)`
- [x] BDD spec — `CreateNote` guard: `.ThenThrows<InvalidOperationException>()` when note already exists
- [x] BDD spec — `RenameNote` happy path: `Given(NoteCreated)` `.When(RenameNote)` `.Then(NoteRenamed)`
- [x] BDD spec — `RenameNote` guard: `.ThenThrows<InvalidOperationException>()` when note does not exist
- [x] BDD spec — `RenameNote` no-op: no event emitted when new title equals current title
- [x] `dotnet test` passes green; `dotnet build` 0 warnings

---

## Slice 1-B — DynamoDB event store
**Status:** Done

**Objective:** Implement `IEventStore` in `src/EventStore/` with a DynamoDB backend. This is the core infrastructure learning moment: append-with-optimistic-concurrency using a conditional write.

**Acceptance criteria:**
- [x] `IEventStore` interface defined with `AppendAsync(streamId, expectedVersion, events)` and `ReadAsync(streamId)`
- [x] `EventEnvelope` C# record matches `event-schemas.md`
- [x] DynamoDB implementation appends events using the row shape in `event-schemas.md` (PK `note#<id>`, SK `v00000001`, META row for current version)
- [x] Optimistic concurrency: append fails with a typed exception (`ConcurrencyException`) if the stream's current version does not match `expectedVersion`
- [x] BDD spec — append to empty stream succeeds, sequence numbers start at 1
- [x] BDD spec — append with correct expected version succeeds
- [x] BDD spec — append with stale expected version throws `ConcurrencyException`
- [x] BDD spec — read returns events in sequence order
- [x] CDK stack updated: `notetaker-events` DynamoDB table added (PK `PK` String, SK `SK` String, `PAY_PER_REQUEST`)
- [x] `cdk synth` exits 0 (verified in CI — not runnable locally without publish); `dotnet test` passes green

---

## Slice 1-C — Create Note API endpoint
**Status:** Done

**Objective:** Wire the first end-to-end slice: `POST /notes` accepts a command, appends `NoteCreated` to DynamoDB, returns 201 with the new `noteId`. Proves the aggregate + event store + API layer work together.

**Acceptance criteria:**
- [x] `POST /notes` returns `201 Created` with body `{ "noteId": "<guid>" }`
- [x] `NoteCreated` event is appended to the `notetaker-events` table
- [x] Calling `POST /notes` twice with the same `noteId` returns `409 Conflict`
- [x] BDD acceptance spec: `Given` the Lambda is deployed, `When` `POST /notes` is called, `Then` `201` with a `noteId`
- [x] Acceptance spec runs in the deploy pipeline (gated by `API_BASE_URL`)
- [x] `dotnet test` passes green; deploy pipeline green

---

## Slice 1-D — RenameNote endpoint + NoteTitleList projection + GET /notes
**Status:** Done

**Objective:** Add the rename command, build the `NoteTitleList` projection, and expose `GET /notes`. First time the full read-side of event sourcing is exercised: event appended → projection updated → query returns result.

**Acceptance criteria:**
- [x] `PATCH /notes/{id}/title` with body `{ "title": "..." }` appends `NoteRenamed`, returns `200`
- [x] `PATCH /notes/{id}/title` with the same title as current is a no-op: returns `200`, no event appended
- [x] `PATCH /notes/{id}/title` for a non-existent note returns `404`
- [x] `NoteTitleList` projection subscribes to `NoteCreated` and `NoteRenamed` and matches the shape in `view-schemas.md`
- [x] Projection stored in a dedicated DynamoDB table (`notetaker-proj-notetitlelist`)
- [ ] `GET /notes` returns `NoteTitleListView` JSON ordered by `lastModifiedAt` descending — **gap: items returned in DynamoDB scan order; `lastModifiedAt` not included in wire response** (carry to 1-E or a follow-up)
- [x] BDD spec for the `NoteTitleList` projection fold (unit — no DynamoDB)
- [x] BDD acceptance specs for `PATCH /notes/{id}/title` and `GET /notes` (gated by `API_BASE_URL`)
- [x] CDK stack updated: projection table provisioned
- [x] `cdk synth` exits 0 (verified in CI); `dotnet test` passes green; deploy pipeline green

---

## Slice 1-E — React scaffold + create/list notes UI
**Status:** In Progress

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
