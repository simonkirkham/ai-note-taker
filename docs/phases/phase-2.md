# Phase 2 — Richer Note Lifecycle

**Goal:** you've changed your mind about an event's shape at least once and survived. By the end of this phase a user can write content into a note, delete notes they no longer need, and the projection can be rebuilt from scratch — covering event versioning, soft delete, and projection rebuild as deliberate learning targets.

**Scope note:** The roadmap lists `NoteDeleted`, `NoteContentReplaced`, and event versioning as Phase 2 work. `NoteContentReplaced` was resolved to `ContentEdited` (full snapshot) in the event model. Phase 2 delivers five slices: NoteDetail projection, EditContent, event versioning, DeleteNote, and projection rebuild.

Status key: `Done` · `In Progress` · `Not Started`

---

## Slice 2-A — NoteDetail projection + GET /notes/{id}
**Status:** Done

**Value:** Users can open a note and read its full content — the app graduates from "a list of titles" to "something you can actually use for meeting notes."

**Commands in scope:** none (read-side only)
**Events subscribed:** `NoteCreated`, `NoteRenamed`, `ContentEdited`

**Acceptance criteria:**
- [x] `NoteDetailView` record defined: `NoteId`, `Title`, `Content`, `CreatedAt`, `LastModifiedAt`
- [x] `INoteDetailStore` interface with `UpsertAsync` and `GetAsync`
- [x] `NoteDetailProjection` in-memory fold handles:
  - `NoteCreated` → blank title and content; `CreatedAt` and `LastModifiedAt` set from envelope timestamp
  - `NoteRenamed` → updates `Title` and `LastModifiedAt`
  - `ContentEdited` → updates `Content` and `LastModifiedAt`
- [x] `DynamoDbNoteDetailStore` persists and retrieves `NoteDetailView` rows in the detail table
- [x] `NoteCommandHandler` updates `NoteDetailProjection` alongside `NoteTitleListProjection` on every command
- [x] `GET /notes/{id}` returns `200` with body `{ noteId, title, content, createdAt, lastModifiedAt }`
- [x] `GET /notes/{id}` returns `404` for a non-existent `noteId`
- [x] BDD projection specs: `NoteCreated`, `NoteRenamed`, unknown note — all covering timestamps
- [x] API integration tests: `200` with all five fields, `404`
- [x] Acceptance specs: `200` with all five fields, `404`
- [x] CDK stack updated: `notetaker-proj-notedetail` table provisioned, IAM grants, env var wired
- [x] `dotnet test` passes green; `cdk synth` exits 0

---

## Slice 2-B — EditContent command + ContentEdited event
**Status:** Done

**Value:** Users can write and save meeting notes content — the core use case of the app, replacing the blank content area with actual captured notes.

**Commands in scope:** `EditContent`
**Events in scope:** `ContentEdited`

**Acceptance criteria:**
- [x] `ContentEdited(NoteId, NewContent)` event record added; `EventDeserializer` handles it
- [x] `EditContent(NoteId, Content)` command record added
- [x] `Note` aggregate handles `EditContent`: guards note exists, no-op if content unchanged, emits `ContentEdited`
- [x] `Note` aggregate `Apply` handles `ContentEdited`: tracks internal `_content` state
- [x] `NoteDetailProjection` handles `ContentEdited`: updates `Content` and `LastModifiedAt`
- [x] BDD spec — happy path: `Given(NoteCreated)` `.When(EditContent)` `.Then(ContentEdited)`
- [x] BDD spec — guard: `.ThenThrows<InvalidOperationException>()` when note does not exist
- [x] BDD spec — no-op: no event emitted when content is unchanged
- [x] BDD projection spec: `ContentEdited` updates `Content` and `LastModifiedAt`; `CreatedAt` is unchanged
- [x] `PUT /notes/{id}/content` with body `{ "content": "..." }` returns `204 No Content`
- [x] `PUT /notes/{id}/content` for a non-existent note returns `404`
- [x] After `PUT`, `GET /notes/{id}` returns updated content and a bumped `lastModifiedAt`
- [x] API integration tests: `204`, `404`, content + `lastModifiedAt` round-trip
- [x] Acceptance tests: same three
- [x] `dotnet test` passes green

---

## Slice 2-C — Event versioning
**Status:** Not Started

**Value:** The project survives its first event shape change without losing history — the defining "trust the event log" moment of event sourcing, showing that old events and new events can coexist in the same stream.

**Design:** `ContentEdited` v2 adds a `CharacterCount: int` field (auto-computed from `Content.Length`). Existing v1 events in the stream have no `CharacterCount`. `EventDeserializer` routes by `EventVersion` and maps v1 events to a zero-character-count representation. `NoteDetailProjection` handles both gracefully.

**Events in scope:** `ContentEdited` v2 (new shape); v1 remains readable

**Acceptance criteria:**
- [ ] `ContentEdited` v2 C# record adds `CharacterCount: int`; old `ContentEdited` v1 record is preserved as a versioned type
- [ ] `EventDeserializer` routes `ContentEdited` by `EventVersion`: version 1 → v1 record, version 2 → v2 record
- [ ] New `EditContent` commands write `ContentEdited` events with `EventVersion = 2` and `CharacterCount` computed from content length
- [ ] `NoteDetailProjection` handles both v1 (no `CharacterCount`) and v2 (with `CharacterCount`) without throwing
- [ ] Replaying a v1 event does not corrupt the projection state — content is updated correctly
- [ ] BDD spec — replay v1 `ContentEdited`: projection updates `Content`; no exception thrown
- [ ] BDD spec — replay v2 `ContentEdited`: projection updates `Content`; `CharacterCount` is correct
- [ ] BDD spec — stream with mixed v1 and v2 events: projection folds correctly in sequence order
- [ ] `EventStoreIntegration` spec: v1 event written directly to DynamoDB is read back and deserialized without error
- [ ] `dotnet test` passes green; `cdk synth` exits 0

---

## Slice 2-D — DeleteNote
**Status:** Not Started

**Value:** Users can remove notes they no longer need — keeps the list clean and demonstrates soft delete in an event-sourced system (event stays in the log; projections prune their rows).

**Design:** prune-on-event — both `NoteTitleListProjection` and `NoteDetailProjection` hard-delete their DynamoDB rows when `NoteDeleted` fires. The event stream retains the full history. Rebuild is correct because `NoteDeleted` is replayed and triggers the prune again.

**Commands in scope:** `DeleteNote`
**Events in scope:** `NoteDeleted`

**Acceptance criteria:**
- [ ] `NoteDeleted(NoteId)` event record added; `EventDeserializer` handles it
- [ ] `DeleteNote(NoteId)` command record added
- [ ] `Note` aggregate handles `DeleteNote`: guards note exists and is not already deleted, emits `NoteDeleted`
- [ ] `Note` aggregate `Apply` handles `NoteDeleted`: sets internal `_deleted` flag
- [ ] `RenameNote` and `EditContent` throw `InvalidOperationException` on a deleted note
- [ ] `NoteTitleListProjection` handles `NoteDeleted`: hard-deletes the projection row
- [ ] `NoteDetailProjection` handles `NoteDeleted`: hard-deletes the projection row
- [ ] BDD spec — happy path: `Given(NoteCreated)` `.When(DeleteNote)` `.Then(NoteDeleted)`
- [ ] BDD spec — guard: `.ThenThrows<InvalidOperationException>()` when note does not exist
- [ ] BDD spec — double-delete guard: `.ThenThrows<InvalidOperationException>()` when already deleted
- [ ] BDD spec — `RenameNote` rejects a deleted note
- [ ] BDD spec — `EditContent` rejects a deleted note
- [ ] BDD projection spec — `NoteTitleList`: note absent from list after `NoteDeleted`
- [ ] BDD projection spec — `NoteDetail`: `GetDetail` returns `null` after `NoteDeleted`
- [ ] `DELETE /notes/{id}` returns `204 No Content`
- [ ] `DELETE /notes/{id}` for a non-existent note returns `404`
- [ ] After `DELETE`, `GET /notes/{id}` returns `404`
- [ ] After `DELETE`, `GET /notes` no longer includes the deleted note
- [ ] API integration tests: all four HTTP assertions above
- [ ] Acceptance tests: same four
- [ ] `dotnet test` passes green; `cdk synth` exits 0

---

## Slice 2-E — Projection rebuild
**Status:** Not Started

**Value:** The read side can be fully recovered by replaying the event log — proves the durability promise of event sourcing and closes the gap where notes created before a projection table existed are invisible.

**Design:** `IEventStore` gains `ReadAllStreamsAsync()` returning all events across all streams ordered by stream then sequence. Each projection gains a `ResetAsync()` that wipes its DynamoDB table. An admin endpoint triggers the rebuild loop: reset → fold all events → projections are current.

**Acceptance criteria:**
- [ ] `IEventStore` extended with `ReadAllStreamsAsync(CancellationToken)` returning `IAsyncEnumerable<EventEnvelope>`
- [ ] `DynamoDbEventStore` implements `ReadAllStreamsAsync` with DynamoDB `Scan` + pagination (handles tables larger than one page)
- [ ] `InMemoryEventStore` implements `ReadAllStreamsAsync` for API integration tests
- [ ] `NoteTitleListProjection` and `NoteDetailProjection` each gain a `Reset()` method that clears in-memory state; `NoteTitleListStore` and `NoteDetailStore` each gain `DeleteAllAsync()` that wipes the DynamoDB table
- [ ] A `POST /admin/rebuild-projections` endpoint: calls `DeleteAllAsync` on both stores, folds `ReadAllStreamsAsync` through both projections, upserts results — returns `200` when complete
- [ ] After rebuild, `GET /notes` reflects the full event history including notes created before the projection table existed
- [ ] `EventStoreIntegration` spec: `ReadAllStreamsAsync` returns events from multiple streams in correct order
- [ ] API integration spec: `POST /admin/rebuild-projections` returns `200`; subsequent `GET /notes` includes a note that was not in the initial projection
- [ ] Acceptance spec: rebuild endpoint returns `200`; `GET /notes` afterwards is consistent with the event log
- [ ] `dotnet test` passes green; `cdk synth` exits 0
