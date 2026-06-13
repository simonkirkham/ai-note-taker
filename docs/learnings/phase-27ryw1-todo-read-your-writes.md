# RYW-1 — Read-your-writes for "add a to-do" (the vertical spike)

**Slice:** Phase 27-RYW · RYW-1 · PR #253 (squash `992f150`) · deploy #543 green · 2026-06-12.

Proved read-your-writes end-to-end on one user call: add a to-do → it appears, correctly, against a *genuinely async* projection. The Todo flow is now async (the projector builds `TodoList`); `POST /todos` returns a consistency token; `GET /todos` waits (bounded) on `proj-position` until the projector caught up. Everything else stays inline + immediate. This is the application-layer form of Cosmos *Session* / Mongo causal / Postgres `WAIT FOR LSN`, and the first slice of the incremental strangler back toward async.

## The lesson that mattered most: an E2E only proves read-your-writes if it can't pass via the cache

The first frontend cut captured the token and plumbed `If-Consistent-With`, but the add-todo path is optimistic (patches `keys.todos` + swaps temp→real id, **no refetch**) — so the token-gated `GET /todos` never fired on add, and the E2E passed via the **optimistic temp row**. That's the exact 27-C2 trap: a green E2E that proves the cache, not the server. The token was effectively dead code on the happy path.

**The fix that makes it a real proof:** persist the token in **`sessionStorage`** (survives a reload) and make the E2E **reload FIRST** — which drops the optimistic row — then assert via a reload-loop. Post-reload the to-do can *only* reappear via the token-gated server read, so the assertion genuinely proves the deployed projector built the projection and the gate served it. **Rule: a read-after-write E2E must read server truth (drop the cache); if the optimistic UI can satisfy it, it proves nothing about the pipeline.**

## The foundation re-enabling the projector dragged in (all necessary, all reusable by RYW-2/3)

- **In-process writer.** Once Todo is async, nothing writes `TodoList` in the `WebApplicationFactory`/local host (no real stream). So `SyncProjectingEventStore` (the in-process decorator that runs the real `StreamProjector` after each append) had to come back — host-discriminated (`AWS_LAMBDA_FUNCTION_NAME`): **deployed API stays plain (no decorator)**; in-process wraps. That forced moving `StreamProjector` into `src/Api/Projections` to break the cycle (the decorator needs it; `src/Projector` references `src/Api`).
- **`MigratedPrefixes`.** The in-process decorator projecting *every* stream while inline still wrote them caused a **synchronous** feedback-counter double-count (9 test failures — not the transient prod case). Fix: the decorator only projects migrated prefixes (`["todo#"]`); still-inline flows stay inline-only in-process. Each flow joins the set as it migrates. (Prod's real projector still processes everything → the documented transient double-count, which closes when analysis migrates in RYW-3.)
- **Shared position store.** The gate and the decorator's projector must resolve the **same** `IProcessedPositionStore` instance in-process, or the gate never sees the apply. A refinement the reverted 27-C decorator didn't need (it had no gate).
- **Folder/Workspace delete arms.** Re-enabling the projector *requires* re-adding `FolderDeleted`/`WorkspaceDeleted` to `ProjectionUpdater` — otherwise it folds `FolderCreated`, ignores the delete, and **re-creates a folder the inline path deleted**. The Plan caught this; it would have been a silent prod bug.

## Re-enabling a disabled ESM spikes iterator age (don't alarm on the catch-up)

Post-deploy the projector's **IteratorAge maxed at ~3 hours**, then dropped to **~1.3 s within 5 minutes**. That's the one-time catch-up: the ESM was disabled in the 27-C revert (#542) and re-enabled here (#543), so it resumed from its checkpoint and chewed the accumulated backlog. Expected and self-resolving — but a naive iterator-age alarm would page on it. When re-enabling a long-dormant stream consumer, expect a backlog spike; watch that it *drains*, don't treat the peak as a fault.

## Token arithmetic (the off-by-one that would silently break RYW)
`version = history.Count + envelopes.Count` (fresh todo = `0 + 1 = 1`), which lines up with the event store's first `seq = expectedVersion + 1 = 1` and the projector's stored `LastSeq = newEnvelopes[^1].SequenceNumber`. A test pins `@1`. If any link drifted, the gate would compare against the wrong number and either hang or never wait.

## Carried forward
- **RYW-2** generalises the gate to the note read endpoints + the client session-token to `keys.note`/`keys.noteCards` (a per-stream map, not one todo token), and migrates the note flows.
- Gate **observability** (wait-duration histogram + stale-rate EMF metrics) is deferred (phase-level, not RYW-1); wire it before prod RYW reliance grows.
- ADR 0009's "stream trigger disabled" line is now stale — it's owned by RYW-4's acceptance, not this slice.
