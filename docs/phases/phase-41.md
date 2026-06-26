# Phase 41 — MCP write tools (Claude can create & update notes and to-dos)

**Goal:** from a connected Claude session the owner can say "save this as a note", "add a to-do to that meeting", "tick that action off", or "append this to the note" — and Claude writes it back through the MCP connector, not just reads.

Phase 35 shipped a **read-only** connector (locked decision #2 explicitly deferred writes to "a future phase"). This is that phase. No new aggregates or events — every write reuses an **existing** command (`CreateNote`, `AddActionItem`, `Complete`/`ReopenActionItem`, `ContentEdited`). The single cross-cutting change is infra: the `/mcp` endpoint moves from the **Query** Lambda to the **Command** Lambda (only Command has event-store access), and 41-A proves that move keeps all five read tools green while landing the first write.

## Summary

| Slice | What the user gets | Status | Depends on |
|-------|--------------------|--------|------------|
| 41-A | **Move `/mcp` to the Command Lambda + `create_note`.** Claude saves a new note into a workspace the owner owns; the five read tools keep working unchanged. Proves the whole write pipe on one real call. | Done — live (2026-06-26) | — |
| 41-B | **`add_action_item` + `complete_action_item` / `reopen_action_item`.** Claude adds a to-do to a note and ticks open ones off (or reopens them). | Not Started | 41-A |
| 41-C | **`edit_note`.** Claude appends to or rewrites a note's body. | Not Started | 41-A |

**41-A is the proving slice** — the hard part is the cross-cutting contract (the `/mcp` integration swap Query→Command without breaking reads + writing through a command handler from inside an MCP tool), not any one tool. `create_note` is the smallest write that proves it: it reuses the *existing* per-call workspace-ownership auth (`UserOwnsWorkspaceAsync`) with no new note-level authorization. 41-B/C then scale the proven pattern, adding note-scoped write authorization.

### Locked decisions

1. **`/mcp` POST moves Query → Command.** Every `tools/call` hits one POST path, so tools cannot be split per-Lambda by routing; any write tool forces the whole endpoint onto Command. Command already holds read-write on every projection table the read tools use (`NoteDetail`, `NoteActions`, `TodoList`, `NoteCardList`, `NoteSearchView`, `WorkspaceList`) plus the event store and the MCP JWT secret — so the read tools keep working and writes are unlocked. (Verified against `NoteTakerStack.cs` grants.)
2. **No event-model changes.** All four writes reuse existing commands/events. The connector gains write *tools*, the domain gains nothing.
3. **Writes go through the command handlers, never the store directly.** MCP tools inject `INoteCommandHandler` / `IActionItemCommandHandler` and call the **identity-explicit overloads** (pass the token `sub` as `userId`), exactly as the non-HTTP analysis re-run does (33-B2) — never relying on the HTTP-scoped `ICurrentUser`.
4. **Per-call authorization extends to writes, and a write must prove ownership of what it mutates.** `create_note` checks workspace ownership (existing). Note-scoped writes (`add_action_item`, `edit_note`, `complete`/`reopen`) must verify the target note/action belongs to `(sub, workspaceId)` against a **strongly-consistent** source before mutating — authorize on the Command Lambda's event stream, never on an async projection (BUG-30 guardrail). Reject → MCP error, never a silent no-op and never a 500.
5. **Phase 35's ≤5-tool guideline is relaxed to ≤9.** Write tools are net-new capability, not context bloat. Descriptions stay terse; `ReadOnly = true` is dropped on write tools (and `Destructive`/`Idempotent` hints set per the SDK) so the client renders the right consent affordance.

### Routing & Lambda split (infra note)

- 41-A re-points the `/mcp` route's integration from `queryIntegration` to `commandIntegration` in `NoteTakerStack.cs`. This is a **backend** artifact — it reaches prod only via a `cdk deploy` (`detect-changes backend=true`); a frontend-only deploy would leave `/mcp` falling through to `/{proxy+}` → 404 (route-contract guardrail). Probe the prod route (`aws apigatewayv2 get-routes --profile prod`) confirms the integration after deploy.
- The Query Lambda's `mcpJwtSecret.GrantRead` is **left in place** (harmless once `/mcp` leaves Query; removing it risks reshuffling DefaultPolicy bytes and breaking unrelated grant assertions — 33-B1 guardrail).
- The OAuth AS endpoints (`/oauth/*`, `.well-known`) already live on Command — unchanged.

### Deploy-time impact

**Neutral.** One route-integration swap + injecting existing command handlers into an existing tool class. No new tables, no new always-on compute, no bake/canary. State the delta (neutral) in each PR.

### Read-your-writes note

Projections are written **inline** by the command handler (same request) today, but reads are gated through the async projector cursor since RYW. After a write tool returns, a *subsequent* read tool (`list_notes`, `get_note`) may briefly miss the new state if it reads a lagging projection. The write tools return the new stream **version** (the RYW token) in their result so Claude — and the specs — can reason about it; the specs assert the write event was appended, not that an immediate read reflects it.

---

## Status log

**41-A — Done (PR #362, deploy #665, 2026-06-26).** `create_note(workspaceId, title?, content?)` is the first MCP write tool: authorizes workspace ownership (existing per-call check, fail-closed), then `CreateNote → RenameNote → EditContent` via the command handler's identity-explicit overload (token `sub` = owner); returns `{ noteId, version }`. `/mcp` POST route moved Query → **Command** Lambda (every `tools/call` hits one POST path, so the whole endpoint had to move; Command holds the projection read grants, so the five read tools keep working). Hawk APPROVE (re-confirmed after adding the committed write-tool observability — `mcp_write` success log + `mcp_write_rejected` cross-workspace audit log, no note content logged). Api.Integration 579 / Infra 159 green. **Prod verified:** `POST /mcp` → 401 (alive), route integration URI = `NoteTakerStack-CommandFunction…` (move is live). No new projection → no backfill.

**Owner manual gate — PENDING:** a real Claude session round-trips `create_note` against the live connector (the human adds nothing — the existing OAuth connector now exposes `create_note` in tools/list). The pipeline cannot self-confirm this.

---

## Build notes _(implementation — skip when reviewing)_

### Slice 41-A — Move `/mcp` to Command + `create_note`

**User value:** Claude saves a new note ("save this transcript as a note in OGI") into a workspace the owner owns.

**How it works:**
- Owner asks Claude to save text as a note; Claude calls `create_note(workspaceId, title, content)`.
- Tool authorizes the workspace (existing `UserOwnsWorkspaceAsync`), creates the note via the command handler, returns the new note id + stream version.
- The five read tools are unchanged and keep working — now served by the Command Lambda.

**Scenarios (GWT):**
```
Scenario: Create a note in an owned workspace
  Given I am connected and own a workspace
  When  Claude calls create_note with a title and content for that workspace
  Then  a note is created in that workspace owned by my sub
  And   the tool returns the new note id

Scenario: Create a note in a workspace I do not own
  Given a workspaceId I do not own (not my WorkspaceList, not the default)
  When  Claude calls create_note with it
  Then  the call is rejected (MCP error) and no note is created

Scenario: Read tools still work after the move
  Given the /mcp endpoint is served by the Command Lambda
  When  Claude calls list_notes / get_note / search_notes / get_action_items / list_workspaces
  Then  each returns the same result it did when served by the Query Lambda

Scenario: Empty content is rejected
  Given a create_note call with blank title and content
  When  Claude calls it
  Then  the call returns an MCP error, not a created empty note
```

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

### Slice 41-B — action-item writes

**User value:** Claude adds a to-do to a note and ticks open ones off / reopens them.

**Scenarios (GWT):**
```
Scenario: Add an action item to an owned note
  Given a note in a workspace I own
  When  Claude calls add_action_item with that noteId and a description
  Then  an open action item is added to that note

Scenario: Complete an open action item
  Given an open action item on a note I own
  When  Claude calls complete_action_item with its id
  Then  the item is marked complete

Scenario: Reopen a completed action item
  Given a completed action item on a note I own
  When  Claude calls reopen_action_item with its id
  Then  the item is open again

Scenario: Write against a note/action I do not own is rejected
  Given a noteId or actionId not owned by my sub
  When  Claude calls any action-item write tool with it
  Then  the call is rejected (MCP error) and nothing is mutated
```

**Build notes:**
- `add_action_item(workspaceId, noteId, description)` → `IActionItemCommandHandler.HandleAsync(AddActionItem, userId: sub)`; verify note ownership against the **event stream** (Command Lambda) before adding (BUG-30: never authorize on an async projection).
- `complete_action_item(actionId)` / `reopen_action_item(actionId)` → `CompleteActionItem` / `ReopenActionItem`. These handlers currently take only the HTTP overload (read `ICurrentUser`); add identity-explicit overloads passing `sub`, mirroring `AddActionItem` (33-B2).
- Resolve the action's owning note → workspace ownership before mutating.

### Slice 41-C — `edit_note`

**User value:** Claude appends to or rewrites a note's body.

**Scenarios (GWT):**
```
Scenario: Append to an owned note
  Given a note in a workspace I own
  When  Claude calls edit_note with new content for that noteId
  Then  the note's body is updated

Scenario: Edit a note I do not own is rejected
  Given a noteId not owned by my sub
  When  Claude calls edit_note with it
  Then  the call is rejected (MCP error) and the note is unchanged
```

**Build notes:**
- `edit_note(workspaceId, noteId, content)` → the `ContentEdited` path (`ContentEditedV2` per the versioning pattern). Verify note ownership against the event stream first.
- Decide append-vs-replace semantics in the spec (default: replace body; a separate `mode` arg is out of scope unless the owner asks).
