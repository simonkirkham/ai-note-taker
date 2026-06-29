# 41-A — MCP write tools: the whole endpoint moves, not the tool

**Slice:** 41-A (PR #362, deploy #665, 2026-06-26) — first MCP write tool (`create_note`) + `/mcp` move Query → Command.

## The non-obvious why

**A single MCP server endpoint cannot be split per-Lambda by routing, so adding *one* write tool moves *every* tool to the Command Lambda.** Every `tools/call` — read or write — is JSON-RPC over the same `POST /mcp` path; API Gateway routes by path+method, not by tool name. So the moment any tool needs event-store access, the whole endpoint must sit on the Command Lambda. The read tools come along for the ride; they keep working only because the Command Lambda already holds read grants on every projection table they use (verified in `NoteTakerStack.cs` before flipping the route). This reversed the 35-A/35-F pin to Query.

**Generalises to 41-B/C and any future MCP tool:** there is no incremental "this tool on Query, that tool on Command" — the endpoint's Lambda is decided by the *most-privileged* tool on it. Once 41-A moved it to Command, B and C add zero routing cost.

## What made it a clean, low-risk first slice

- **`create_note` reuses the existing per-call workspace-ownership auth** (`UserOwnsWorkspaceAsync`) — no new note-level authorization to get wrong. That is why it was the right *first* write (B/C introduce note-scoped write auth).
- **Writes go through `INoteCommandHandler`'s identity-explicit overload** (`HandleAsync(cmd, userId, workspaceId, ct)` — the 33-B2 pattern), passing the token `sub`, never the HTTP-scoped `ICurrentUser`. The owner is stamped on the event stream (non-spoofable), and the follow-up `RenameNote`/`EditContent` (`MustExist=true`) re-authorize against that stamped owner on the strongly-consistent stream — so the async-projection auth trap (BUG-30) does not apply.
- **The async-projection auth concern is benign for create specifically:** a lagging `WorkspaceList` causes a *false denial* (fail-closed), never an unowned write landing.
- **RYW token** surfaced via `GetCurrentVersionAsync` (the Phase 38 multi-append pattern) rather than the last command's version — a create is three appends.

## Observability is committed scope for a mutating tool, not a nicety

Hawk's only substantive findings were the missing write-tool logs the phase doc's Observability section had already committed to. A *write* leak mutates, not just leaks — so the cross-workspace **rejection** gets an audit `LogWarning` (`mcp_write_rejected`, with `sub` + attempted `workspaceId`, **no** note content — meeting notes are sensitive), and success gets `mcp_write` with latency. Lesson: when the Scout phase doc names an Observability requirement for a slice, treat it as acceptance criteria, not a follow-up — Hawk will (correctly) hold it.

## Verifying a backend route move actually shipped

A route-integration swap is a backend artifact: confirm the **shipping** deploy was `backend=true` and probe prod — `POST /mcp` → 401 (alive, not 404) **and** the `POST /mcp` route's integration URI resolves to `…CommandFunction…`. "A green deploy exists" is not enough (route-contract guardrail).
