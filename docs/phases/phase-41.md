# Phase 41 — MCP write tools (Claude can create & update notes and to-dos) _(Done — 2026-06-26)_

**Goal:** from a connected Claude session the owner can say "save this as a note", "add a to-do to that meeting", "tick that action off", or "append this to the note" — and Claude writes it back through the connector, not just reads.

## Summary

| Slice | What the user gets | Status | Depends on |
|-------|--------------------|--------|------------|
| 41-A | Claude saves a new note into a workspace you own; everything Claude could already read keeps working | Done _(PR #362, deploy #665)_ | — |
| 41-B | Claude adds a to-do to a note, and ticks open ones off or reopens them | Done _(PR #364, deploy #667)_ | 41-A |
| 41-C | Claude rewrites a note's body | Done _(PR #365, deploy #668)_ | 41-A |

**41-A is the proving slice** — the hard part is the cross-cutting contract (letting the connector write at all, without breaking any of the reads it already served), not any one tool. Saving a note is the smallest write that proves it; 41-B/C then scale the proven pattern.

**Owner manual gate — PENDING for all three slices.** The pipeline cannot self-confirm the round-trip; a real Claude session must exercise each write tool against the live connector.

## Slices

### 41-A — Claude saves a note

**User value:** you tell Claude "save this transcript as a note in OGI" and the note is there when you next open the app.

**How it works:**
- You ask Claude to save some text as a note in a named workspace.
- Claude creates it and tells you it landed; the note is owned by you, in that workspace.
- Asking for a workspace that isn't yours is refused outright — nothing is created.
- A blank note is refused rather than silently created empty.
- Everything Claude could already do (list, open, search notes, list your to-dos and workspaces) keeps working exactly as before.

**Scenarios (GWT):**
```
Scenario: Create a note in a workspace I own
  Given I am connected and own a workspace
  When  I ask Claude to save a title and some content as a note there
  Then  the note is created in that workspace, owned by me
  And   Claude tells me which note it created

Scenario: Create a note in a workspace I do not own
  Given a workspace that is not mine
  When  I ask Claude to save a note there
  Then  the request is refused and no note is created

Scenario: Everything Claude could already read still works
  Given the connector now supports writing
  When  I ask Claude to list, open, or search my notes, to-dos, or workspaces
  Then  each returns the same result it did before writing was added

Scenario: An empty note is refused
  Given I ask Claude to save a note with no title and no content
  When  Claude tries to create it
  Then  the request is refused rather than creating an empty note
```

### 41-B — Claude manages your to-dos

**User value:** you can run your action list through Claude — "add a to-do to that meeting note", "tick that one off" — without opening the app.

**How it works:**
- You ask Claude to add a to-do against a note; it appears as an open item on that note.
- You ask Claude to tick an open item off, or to reopen one you closed by mistake.
- Any to-do or note that isn't yours is refused, and nothing is changed.

**Scenarios (GWT):**
```
Scenario: Add a to-do to a note I own
  Given a note in a workspace I own
  When  I ask Claude to add a to-do to it
  Then  an open to-do is added to that note

Scenario: Tick an open to-do off
  Given an open to-do on a note I own
  When  I ask Claude to complete it
  Then  it is marked complete

Scenario: Reopen a completed to-do
  Given a completed to-do on a note I own
  When  I ask Claude to reopen it
  Then  it is open again

Scenario: A to-do that is not mine is refused
  Given a to-do or note that does not belong to me
  When  I ask Claude to add to, complete, or reopen it
  Then  the request is refused and nothing is changed
```

### 41-C — Claude rewrites a note

**User value:** you can hand Claude a note and have it rewrite or extend the body in place.

**How it works:**
- You ask Claude to rewrite or append to a note's body; the note's content is replaced with the new text.
- A note that isn't yours is refused and left untouched.
- Blank content is refused rather than wiping the note.

**Scenarios (GWT):**
```
Scenario: Rewrite a note I own
  Given a note in a workspace I own
  When  I ask Claude to replace its body with new content
  Then  the note's body is updated

Scenario: Rewrite a note I do not own
  Given a note that does not belong to me
  When  I ask Claude to edit it
  Then  the request is refused and the note is unchanged

Scenario: Blank content is refused
  Given I ask Claude to edit a note with empty content
  When  Claude tries to save it
  Then  the request is refused and the existing body is kept
```

---

## Build notes _(implementation — skip when reviewing)_

Phase 35 shipped a **read-only** connector (locked decision #2 explicitly deferred writes to "a future phase"). This is that phase. No new aggregates or events — every write reuses an **existing** command (`CreateNote`, `AddActionItem`, `Complete`/`ReopenActionItem`, `ContentEdited`). The single cross-cutting change is infra: the `/mcp` endpoint moves from the **Query** Lambda to the **Command** Lambda (only Command has event-store access), and 41-A proves that move keeps all five read tools green while landing the first write.

### Locked decisions

1. **`/mcp` POST moves Query → Command.** Every `tools/call` hits one POST path, so tools cannot be split per-Lambda by routing; any write tool forces the whole endpoint onto Command. Command already holds read-write on every projection table the read tools use (`NoteDetail`, `NoteActions`, `TodoList`, `NoteCardList`, `NoteSearchView`, `WorkspaceList`) plus the event store and the MCP JWT secret — so the read tools keep working and writes are unlocked. (Verified against `NoteTakerStack.cs` grants.)
2. **No event-model changes.** All four writes reuse existing commands/events. The connector gains write *tools*, the domain gains nothing.
3. **Writes go through the command handlers, never the store directly.** MCP tools inject `INoteCommandHandler` / `IActionItemCommandHandler` and call the **identity-explicit overloads** (pass the token `sub` as `userId`), exactly as the non-HTTP analysis re-run does (33-B2) — never relying on the HTTP-scoped `ICurrentUser`.
4. **Per-call authorization extends to writes, and a write must prove ownership of what it mutates.** `create_note` checks workspace ownership (existing). Note-scoped writes (`add_action_item`, `edit_note`, `complete`/`reopen`) must verify the target note/action belongs to `(sub, workspaceId)` against a **strongly-consistent** source before mutating — authorize on the Command Lambda's event stream, never on an async projection (BUG-30 guardrail). Reject → MCP error, never a silent no-op and never a 500.
5. **Phase 35's ≤5-tool guideline is relaxed to ≤10** (the four write tools land on top of the five reads + `list_workspaces`). Write tools are net-new capability, not context bloat — each description stays one terse line. `ReadOnly = true` is dropped on write tools so the client renders the right consent affordance.

### Routing & Lambda split (infra note)

- 41-A re-points the `/mcp` route's integration from `queryIntegration` to `commandIntegration` in `NoteTakerStack.cs`. This is a **backend** artifact — it reaches prod only via a `cdk deploy` (`detect-changes backend=true`); a frontend-only deploy would leave `/mcp` falling through to `/{proxy+}` → 404 (route-contract guardrail). Probe the prod route (`aws apigatewayv2 get-routes --profile prod`) confirms the integration after deploy.
- The Query Lambda's `mcpJwtSecret.GrantRead` is **left in place** (harmless once `/mcp` leaves Query; removing it risks reshuffling DefaultPolicy bytes and breaking unrelated grant assertions — 33-B1 guardrail).
- The OAuth AS endpoints (`/oauth/*`, `.well-known`) already live on Command — unchanged.

### Deploy-time impact

**Neutral.** One route-integration swap + injecting existing command handlers into an existing tool class. No new tables, no new always-on compute, no bake/canary. State the delta (neutral) in each PR.

### Read-your-writes note

Command handlers are append-only; read models are built by the async projector and reads are gated on its cursor. After a write tool returns, a *subsequent* read tool (`list_notes`, `get_note`) may briefly miss the new state if it reads a lagging projection. The write tools return the new stream **version** (the RYW token) in their result so Claude — and the specs — can reason about it; the specs assert the write event was appended, not that an immediate read reflects it.

### Slice 41-A — Move `/mcp` to Command + `create_note`

**Acceptance criteria:**
- `/mcp` POST route integration changed Query → Command in `NoteTakerStack.cs`; asserted in `Infrastructure.Assertions`.
- `Infrastructure.Assertions` MCP-on-Query test flipped to expect Command (the 35-A assertion).
- `create_note(workspaceId, title, content)` tool: not `ReadOnly`; authorizes workspace ownership; calls `INoteCommandHandler.HandleAsync(CreateNote, userId: sub, workspaceId)`; returns `{ noteId, version }`.
- Blank title **and** content → `McpException`, no append.
- `NoteMcpTools` gains `INoteCommandHandler` (and an id/clock source) via DI; reads unchanged.
- Tests: `Api.Integration` MCP write test (create → assert event appended + note readable via `get_note`); ownership-rejection test; the existing read-tool MCP tests stay green.
- Deploy-time delta: neutral. Confirm prod `/mcp` route integration = Command via `get-routes` after deploy.
- Owner manual gate: a real Claude session round-trips `create_note` against the deployed connector.

**Commands/events reused:** `CreateNote` → `NoteCreated` (+ analysis events as today). No new event types. No new projection → no backfill.

**Observability:** structured log per write tool (tool, workspaceId, sub, result, latency); metric on write-tool error rate; a cross-workspace write rejection is logged for audit (a write leak mutates, not just leaks — higher severity than the read case).

**Done — PR #362, deploy #665, 2026-06-26.** `create_note(workspaceId, title?, content?)` is the first MCP write tool: authorizes workspace ownership (existing per-call check, fail-closed), then `CreateNote → RenameNote → EditContent` via the command handler's identity-explicit overload (token `sub` = owner); returns `{ noteId, version }`. `/mcp` POST route moved Query → **Command** Lambda (every `tools/call` hits one POST path, so the whole endpoint had to move; Command holds the projection read grants, so the five read tools keep working). Hawk APPROVE (re-confirmed after adding the committed write-tool observability — `mcp_write` success log + `mcp_write_rejected` cross-workspace audit log, no note content logged). Api.Integration 579 / Infra 159 green. **Prod verified:** `POST /mcp` → 401 (alive), route integration URI = `NoteTakerStack-CommandFunction…` (move is live). No new projection → no backfill.

### Slice 41-B — action-item writes

**Acceptance criteria:**
- `add_action_item(workspaceId, noteId, description)` → `IActionItemCommandHandler.HandleAsync(AddActionItem, userId: sub)`; verify note ownership against the **event stream** (Command Lambda) before adding (BUG-30: never authorize on an async projection).
- `complete_action_item(actionId)` / `reopen_action_item(actionId)` → `CompleteActionItem` / `ReopenActionItem`. These handlers currently take only the HTTP overload (read `ICurrentUser`); add identity-explicit overloads passing `sub`, mirroring `AddActionItem` (33-B2).
- Resolve the action's owning note → workspace ownership before mutating.

**Done — PR #364, deploy #667, 2026-06-26.** Three note/action write tools: `add_action_item(noteId, description)`, `complete_action_item(actionId)`, `reopen_action_item(actionId)`. **Design refinement vs the original sketch:** complete/reopen take **only `actionId`** (not a `noteId`) and authorize the **action's own owner** via a new `IActionItemAuthorizer.OwnsActionAsync` (event-stream, BUG-30-safe) — Hawk's first round caught that authorizing a caller-supplied `noteId` left the action↔note binding unchecked (an IDOR: own any note + know any actionId → mutate it). `add_action_item` stays note-scoped (`OwnsNoteAsync`). Complete/Reopen gained identity-explicit handler overloads (token `sub` = owner). Domain failures → clean MCP errors, not 500s. Hawk: REQUEST CHANGES → fixed → APPROVE. Api.Integration 586 / Domain.Specs 272 green. Deploy #667 flaked once at the E2E gate on the unrelated `CreateAndListNoteJourney` ([BUG-42]); green on rerun, `deploy-production` success. **The same object-level gap existed on the pre-existing HTTP action endpoints — filed as [BUG-41]** and since fixed (PR #370, deploy #674) using this slice's `IActionItemAuthorizer`.

### Slice 41-C — `edit_note`

**Acceptance criteria:**
- `edit_note(workspaceId, noteId, content)` → the `ContentEdited` path (`ContentEditedV2` per the versioning pattern). Verify note ownership against the event stream first.
- Decide append-vs-replace semantics in the spec (default: replace body; a separate `mode` arg is out of scope unless the owner asks).

**Done — PR #365, deploy #668, 2026-06-26. Phase 41 complete.** `edit_note(noteId, content)` replaces a note's body via `EditContent` (note-ownership auth, the shared `AuthorizeOwnedNoteAsync` helper refactored out of `add_action_item`). Passes **null** workspace to the handler — `ContentEdited` never carries workspace and all three note projections (`NoteDetail`/`NoteCardList`/`NoteSearchView`) preserve the existing view's `WorkspaceId` on the fold (Hawk verified against the projection code; a named-workspace test proves scoping survives). Blank content rejected; contention/TOCTOU mapped to clean MCP errors (`RunNoteWriteAsync`). Hawk APPROVE (two Low fixes folded in). Api.Integration 592 green. **Connector now exposes 10 tools** (5 read + `create_note` + `add_action_item` + `complete_action_item` + `reopen_action_item` + `edit_note`).
