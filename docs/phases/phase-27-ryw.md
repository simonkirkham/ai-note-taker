# Phase 27-RYW — Read-your-writes consistency (the async prerequisite)

**Goal:** Give the client a **read-your-writes (RYW)** guarantee so the async-projector cutover (the reverted 27-C) becomes safe and the frontend stays simple. A command returns the **stream position it just wrote**; a read can present that token, and the query side **waits (bounded) until the projection has caught up** before answering — so you always see your own writes without per-mutation optimistic cache surgery. This is the application-layer equivalent of Azure Cosmos DB *Session* consistency, MongoDB *causal consistency* (`afterClusterTime`), and PostgreSQL `WAIT FOR LSN` — see **[Prior art](#prior-art--chosen-approach-family-2)**. Unblocks re-attempting the cutover that 27-C could not land (the frontend was built for immediate consistency, and reactive optimism was whack-a-mole — see [the learnings doc](../learnings/phase-27c-async-cutover-reverted.md)). Re-enables the dormant Projector Lambda (27-B) as the sole writer at cutover.

## Summary

**Sliced vertically: prove one call end-to-end, then scale outward flow-by-flow.** No big-bang cutover — inline projection writes are removed **one flow at a time**, each flow becoming async + read-your-writes as its slice lands. The projector is enabled from slice 1 and runs for the whole migration; for flows still inline it double-writes idempotently (the only non-idempotent case — the feedback increment counters — is transient and rebuildable, closed when the AI-analysis flow migrates in RYW-3).

| Slice | Summary | Status | Depends on |
|-------|---------|--------|------------|
| RYW-1 | **Prove the whole flow on ONE call — "add a to-do," end to end.** Enable the projector; remove inline projection for `TodoAdded` **only** (so `GET /todos` is genuinely async for a new todo); `POST /todos` returns its write token `{stream, version}`; a minimal `ConsistencyGate` makes `GET /todos` carrying that token wait on `proj-position` until applied (bounded + `stale` fallback); the client captures the token and attaches it to the todos refetch. Proves token → async projector → gate-wait → read-your-writes through every layer. Everything else stays inline + immediate. | Not Started | — |
| RYW-2 | **Scale: the note flows.** Migrate note create / rename / content / date / tags to async + RYW (remove their inline writes; reuse the RYW-1 gate + client session-token; thread the token through `keys.note`/`keys.noteCards` reads). One cohesive flow group; the dominant read-after-write surface. | Not Started | RYW-1 |
| RYW-3 | **Scale: actions, folders, workspaces, analysis.** Migrate the remaining flows; re-add the `FolderDeleted`/`WorkspaceDeleted` arms to `ProjectionUpdater`; migrating the AI-analysis flow closes the transient feedback double-count. | Not Started | RYW-1 |
| RYW-4 | **Complete the cutover + clean up.** Last inline write removed → handlers are append-only, projector is the **sole** writer; delete now-dead inline plumbing; drop optimism-for-correctness on the frontend (keep it only for instant feel); update `architecture.md` + ADR 0009. | Not Started | RYW-2, RYW-3 |
| RYW-D | **(Optional UX) Real-time "poke" channel (SSE).** The server pokes the client when a stream it's viewing updates; the client refetches — shrinking visible waits. Polish, not core. | Not Started | RYW-4 |

> **The shape:** **RYW-1 is the spike** — one user-meaningful call (add a to-do, see it appear) proven read-your-writes against the real async projector, touching every layer thinly. **RYW-2/RYW-3 scale the *same* proven pattern** across the rest of the read-after-write flows, each slice flipping a group of flows to async and shippable on its own. **RYW-4** is reached when the last inline write is gone. 27-D (Command/Query split) follows RYW-4.

**Learning surface:** a vertical spike that exercises **session / causal consistency** (Cosmos session token · MongoDB `afterClusterTime` · Postgres `WAIT FOR LSN`) end-to-end on one call, then an **incremental strangler migration** (inline → async, flow-by-flow) rather than a big-bang flip — the approach the 27-C incident proved is necessary.

---

## Design decisions (locked)

| # | Decision | Choice & rationale |
|---|----------|--------------------|
| 1 | **Token shape** | **Per-stream version** — the events table already versions per stream and `AppendAsync` returns the new version. Not a global sequence (DynamoDB Streams give no clean global counter). |
| 2 | **Catch-up signal** | The **existing `notetaker-proj-position` store** (PK=streamId, `LastSeq`) the projector advances after applying. RYW reuses it — the hard "has the projection caught up?" signal already exists (built in 27-B). |
| 3 | **Which reads carry the token** | **Session high-water**, like the Cosmos/Mongo drivers: the client attaches tokens for streams it has unconfirmed writes to; the query waits only on (streams the read touches) ∩ (pending tokens). The per-stream position check makes the wait a **no-op unless that read's data is actually behind** — so "tag broadly, wait only when stale" rather than hunting for "affected" reads. |
| 4 | **Wait bound + fallback** | **Bounded poll (~2s)**, exactly like Postgres `WAIT FOR LSN ... TIMEOUT '2s'`; on timeout serve current data + `X-Consistency: stale` so the client retries or keeps its optimistic value. Never block a read indefinitely. |
| 5 | **Migration shape** | **Incremental strangler, NOT a big-bang flip.** The projector is enabled for the whole migration; inline writes are removed **one flow at a time** (a flow becomes async + RYW as its slice lands). Tolerates idempotent double-write for still-inline flows; the only non-idempotent case (feedback increment counters) is transient + rebuildable, closed when the analysis flow migrates. This is the deliberate opposite of the reverted 27-C's atomic flip. |
| 6 | **Optimism** | **Optional, for instant feel only** — no longer load-bearing for *correctness* (the server guarantees RYW). This is the crucial contrast with the reverted 27-C2, where a single missed optimistic path was a stale-data bug. |
| 7 | **Lists / cross-aggregate reads** | A list read depends on many streams but the client only holds a token for the stream it just wrote → the query waits on **that one** stream's contribution (e.g. the just-edited note's card), which is what the user is checking for. |

---

## Slices

### RYW-1 — Prove the whole flow on one call: read-your-writes for "add a to-do"

**User value:** add a to-do and see it appear in your list — correctly, against a genuinely async projection. The proof that the token → async projector → gate-wait → client loop works end to end on a real call.

**Why this call:** Todo is the simplest aggregate — standalone, one event (`TodoAdded`), one projection (`TodoList`), one inline write (`todoListStore.PutAsync`). Removing just that inline write is a one-liner, so exactly one flow becomes async while everything else stays inline + immediate. Smallest possible vertical slice that still touches every layer.

**Scenarios (GWT):**
- Given the projector is enabled and `TodoAdded`'s inline write is removed, when I `POST /todos`, then the response carries the write token `{stream: todo#id, version}` **and** the TodoList projection is built only by the async projector (it lags ~<1s).
- Given the add-todo response's token, when the client refetches `GET /todos` carrying `If-Consistent-With: todo#id@N`, then the query waits on `proj-position[todo#id]` until `≥ N`, then returns the list **including the new todo** (read-your-writes honoured).
- Given the same refetch **without** the token, then it may return before the projector applied → the new todo may be missing (demonstrating the gate is what makes it correct).
- Given the wait exceeds the bound (~2s), then it returns the current list + `X-Consistency: stale`; the client retries (bounded) or keeps its optimistic row.
- Given any other write (notes, etc.), then it stays inline + immediate — unchanged.

**Acceptance criteria:**
- Projector ESM `Enabled = true`; inline `todoListStore.PutAsync` removed from `TodoCommandHandler.AddTodo` **only** (other todo ops and all other aggregates stay inline).
- `POST /todos` returns the per-stream version from `AppendAsync` (the write token).
- A minimal `ConsistencyGate` on `GET /todos`: parse `If-Consistent-With`, bounded-poll `IProcessedPositionStore` (~2s), `stale` fallback. Scoped to this one read — not a global middleware yet.
- Frontend: the add-todo mutation captures the token; the todos refetch attaches it; `stale` → bounded retry. Scoped to the todos hook for now.
- Tests: Api.Integration proves wait-then-release for the todo read against the real `StreamProjector` driven synchronously over an in-memory store (and a `stale`-timeout path); an E2E `TodoReadYourWrites` journey (add todo → list shows it) green against the **deployed async** projector. Document the transient feedback double-count (analysis flow still inline + projector enabled).

### RYW-2 — Scale outward: the note flows

**User value:** editing a note (title, content, date, tags) and seeing it reflected after navigation — now correct under async, via the proven RYW pattern.

**Scenarios (GWT):**
- Given the RYW-1 gate + client session-token, when each note flow's inline write is removed and its read carries the token, then create/rename/content/date/tag all read-your-writes across navigation.
- Given a note read (`GET /notes/{id}`) or the cards list, when it carries the token for a just-written note, then it waits on that note's stream position before answering.

**Acceptance criteria:**
- Generalise the gate to the note read endpoints (`GET /notes/{id}`, `GET /notes/cards`) and the client session-token to `keys.note`/`keys.noteCards`.
- Remove the inline projection writes for the note flows (title/content/date/tags) from `NoteCommandHandler`; those projections become projector-built.
- Per-flow E2E read-your-writes journeys (the ones 27-C2 chased reactively — now server-guaranteed); existing journeys green against deployed async.

### RYW-3 — Scale outward: actions, folders, workspaces, analysis

**User value:** the remaining read-after-write flows become correct under async.

**Scenarios (GWT):**
- Given each remaining flow (action add/complete/delete, folder create/rename/move/delete, workspace ops, AI analysis), when its inline write is removed and its read carries the token, then it reads-your-writes.
- Given a `FolderDeleted`/`WorkspaceDeleted` event, then the projector deletes the row (re-added arms).
- Given the AI-analysis flow migrated, then the feedback counters are written **only** by the projector — the transient double-count is closed.

**Acceptance criteria:**
- Migrate the action/folder/workspace/analysis flows; re-add `FolderDeleted`/`WorkspaceDeleted` arms to `ProjectionUpdater`.
- Closing the feedback double-count is an explicit acceptance criterion of the analysis migration.

### RYW-4 — Complete the cutover + clean up

**User value:** the deployment matches the event-sourced design — append-only writes, the projector the sole read-model writer — with read-after-write intact.

**Scenarios (GWT):**
- Given every flow migrated, when a command returns, then no projection write happened on the request path (handlers append-only).
- Given the projector is the sole writer, then no inline `ProjectionUpdater` call remains.

**Acceptance criteria:**
- Remove the last inline `ProjectionUpdater` calls → command handlers append-only; delete now-dead inline plumbing.
- Frontend drops optimism-for-correctness (keep it only for instant feel where chosen).
- `architecture.md` + ADR 0009 updated: async is live; RYW is the read-after-write contract; the projector is sole writer.

### RYW-D — (Optional) Real-time "poke" (SSE)

**User value:** the UI refreshes reactively when projections update, shrinking the moments a read would otherwise wait.

**Scenarios (GWT):**
- Given the projector applies an event for a stream the client is viewing, then the server pokes the client (SSE), which refetches that query.

**Acceptance criteria:**
- A lightweight SSE/"poke" channel (the sync-engine pattern); the client invalidates the relevant query on poke. Deferred — the token gate is the core; this is UX polish.

---

## Prior art — chosen approach (Family 2)

Read-after-write under eventual consistency has three well-trodden families. This phase deliberately picks **Family 2 (consistency tokens / causal-session consistency)** — the database-grade pattern, applied at the projection layer.

| Family | Mechanism | Examples | Fit here |
|---|---|---|---|
| **1. Optimistic UI** | client predicts the result, reconciles on response | Apollo `optimisticResponse`, Relay, TanStack `onMutate` | **What 27-C2 was** — reactive + hand-rolled → whack-a-mole; correctness needs *every* path predicted |
| **2. Consistency tokens / causal session** *(chosen)* | write returns a position; reads wait until the projection reaches it | **Cosmos** `SessionToken`, **MongoDB** `afterClusterTime` (server blocks the read until cluster time advances), **Postgres** `WAIT FOR LSN ... TIMEOUT '2s'` | **= this phase.** Reuses our `proj-position`; server owns correctness; frontend stays simple |
| **3. Local-first sync engine** | local store is the UI source of truth; mutations apply locally + replay + rebase; server **pushes** | Linear, Replicache, Convex, ElectricSQL | the frontier, but a *whole engine* — disproportionate for a single-user notes app |

Key validations from the research:
- The token/position-wait mechanism is **identical across Cosmos, MongoDB, and Postgres** — write returns a position (session token / `operationTime` / WAL LSN); the read blocks until the replica reaches it. The RYW-1 gate is that, with `proj-position.LastSeq` as the position.
- Real drivers attach the session token to **all** reads automatically; the per-partition/per-stream check makes the wait **free unless that read's data is behind** — hence decision #3 ("tag broadly, wait only when stale") rather than identifying "affected" reads.
- The bounded wait + fallback is standard (Postgres's explicit `TIMEOUT '2s'`) — decision #4.

Sources: [Cosmos DB consistency levels](https://learn.microsoft.com/en-us/azure/cosmos-db/consistency-levels) · [Postgres `WAIT FOR LSN` + Mongo causal consistency](https://dev.to/franckpachot/read-your-writes-on-replicas-postgresql-wait-for-lsn-and-mongodb-causal-consistency-4he2) · [MongoDB causal consistency](https://www.mongodb.com/docs/manual/core/causal-consistency-read-write-concerns/) · [CQRS eventual consistency in the UI](https://10consulting.com/2017/10/06/dealing-with-eventual-consistency/) · [Replicache / sync engines](https://dev.to/isaachagoel/are-sync-engines-the-future-of-web-applications-1bbi).

---

## Observability

| Risk | Symptom | What to make visible |
|---|---|---|
| Projector stuck/slow → gate always waits the full bound | reads feel slow; `stale` rate climbs | EMF metrics: gate **wait-duration** histogram + **stale-fallback rate**; alarm when stale-rate or p95 wait crosses a threshold (proxy for projector lag/health) |
| Position store not advancing (projector dead) post-cutover | every RYW read times out → `stale` | the existing projector lag/DLQ alarms (27-B) + the new stale-rate alarm together pinpoint it |
| Token never cleared (client bug) | a stream's reads always wait | per-stream wait counts in logs (no token text); a "tokens outstanding" client metric |

---

## Constraints

- **Incremental, not big-bang.** RYW-1 flips exactly one flow (add-to-do) to async and proves the loop; RYW-2/RYW-3 flip more flows one group at a time; RYW-4 is reached when the last inline write is gone. Each slice ships a working subset, and any slice can be the stopping point.
- **Reuse `proj-position`** as the catch-up signal; **per-stream version** as the token. No global sequence.
- **Bounded wait + `stale` fallback** — a read must never block indefinitely.
- Stays within the **single HTTP Lambda** until 27-D (the Command/Query split, which follows).
- **Out of scope:** a local-first sync engine (Family 3); conflict-resolution/rebase; global-ordering tokens; multi-user real-time collaboration (the `poke` channel RYW-D is single-user refresh only).

## Downstream

RYW-4 **completes the async cutover** the reverted 27-C could not — reached incrementally, on a correct read-after-write foundation proven on the very first call (RYW-1). After it, **27-D** (split into Command + Query Lambdas) is unblocked, finishing ADR 0009 Stage 1.
