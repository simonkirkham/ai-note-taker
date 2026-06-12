# Phase 27-RYW — Read-your-writes consistency (the async prerequisite)

**Goal:** Give the client a **read-your-writes (RYW)** guarantee so the async-projector cutover (the reverted 27-C) becomes safe and the frontend stays simple. A command returns the **stream position it just wrote**; a read can present that token, and the query side **waits (bounded) until the projection has caught up** before answering — so you always see your own writes without per-mutation optimistic cache surgery. This is the application-layer equivalent of Azure Cosmos DB *Session* consistency, MongoDB *causal consistency* (`afterClusterTime`), and PostgreSQL `WAIT FOR LSN` — see **[Prior art](#prior-art--chosen-approach-family-2)**. Unblocks re-attempting the cutover that 27-C could not land (the frontend was built for immediate consistency, and reactive optimism was whack-a-mole — see [the learnings doc](../learnings/phase-27c-async-cutover-reverted.md)). Re-enables the dormant Projector Lambda (27-B) as the sole writer at cutover.

## Summary

| Slice | Summary | Status | Depends on |
|-------|---------|--------|------------|
| RYW-A | **Write-token + query-side bounded wait (backend machinery).** Mutating commands return `{stream, version}`; a read carrying `If-Consistent-With: s@N` makes the query poll the `proj-position` store (bounded ~2s) until caught up, then serve — else serve current + a `stale` header. Behaviour-neutral for clients that don't send the header; projector stays dormant (tested with a controllable position store). | Not Started | — |
| RYW-B | **Client session-token plumbing (frontend).** A session-level layer over the api client captures write tokens from mutation responses and attaches the relevant token(s) to subsequent reads (mirrors the Cosmos/Mongo driver session), clearing on confirmation; handles the `stale` fallback. Behaviour-neutral while inline (the gate is a no-op). | Not Started | RYW-A |
| RYW-C | **The async cutover, now safe (the keystone re-do of 27-C).** Atomically remove inline projection writes (append-only handlers) and re-enable the projector ESM as the **sole** writer; reads rely on RYW for read-after-write; re-add the `FolderDeleted`/`WorkspaceDeleted` projector arms; drop optimism-for-correctness on the frontend. | Not Started | RYW-A, RYW-B |
| RYW-D | **(Optional UX) Real-time "poke" channel (SSE).** The projector/command pokes the client when a stream it's viewing updates; the client refetches — shrinking visible waits. Polish, not core. | Not Started | RYW-C |

> **Sequencing:** RYW-A + RYW-B are built **behaviour-neutral while inline is still authoritative** — the wait is a no-op because projections are already current, but the token contract and the gate are fully testable (inject a lagging position store). RYW-C is the **one-way flip** to async, now safe because reads can wait for their own writes; it is the re-do of the reverted 27-C and the cutover is **atomic** (inline removed + projector re-enabled together → no shadow double-write window for the feedback counters). 27-D (Command/Query split) follows RYW-C.

**Learning surface:** implementing **session / causal consistency** (Cosmos session token · MongoDB `afterClusterTime` · Postgres `WAIT FOR LSN`) at the *application/projection* layer instead of the storage layer — the proper read-after-write contract for an async event-sourced system, and the missing half that the 27-C incident exposed.

---

## Design decisions (locked)

| # | Decision | Choice & rationale |
|---|----------|--------------------|
| 1 | **Token shape** | **Per-stream version** — the events table already versions per stream and `AppendAsync` returns the new version. Not a global sequence (DynamoDB Streams give no clean global counter). |
| 2 | **Catch-up signal** | The **existing `notetaker-proj-position` store** (PK=streamId, `LastSeq`) the projector advances after applying. RYW reuses it — the hard "has the projection caught up?" signal already exists (built in 27-B). |
| 3 | **Which reads carry the token** | **Session high-water**, like the Cosmos/Mongo drivers: the client attaches tokens for streams it has unconfirmed writes to; the query waits only on (streams the read touches) ∩ (pending tokens). The per-stream position check makes the wait a **no-op unless that read's data is actually behind** — so "tag broadly, wait only when stale" rather than hunting for "affected" reads. |
| 4 | **Wait bound + fallback** | **Bounded poll (~2s)**, exactly like Postgres `WAIT FOR LSN ... TIMEOUT '2s'`; on timeout serve current data + `X-Consistency: stale` so the client retries or keeps its optimistic value. Never block a read indefinitely. |
| 5 | **Cutover atomicity** | Re-enable the projector as **sole** writer and remove inline in the **same** slice (RYW-C) — no shadow window where inline + projector both increment the feedback counters. |
| 6 | **Optimism** | **Optional, for instant feel only** — no longer load-bearing for *correctness* (the server guarantees RYW). This is the crucial contrast with the reverted 27-C2, where a single missed optimistic path was a stale-data bug. |
| 7 | **Lists / cross-aggregate reads** | A list read depends on many streams but the client only holds a token for the stream it just wrote → the query waits on **that one** stream's contribution (e.g. the just-edited note's card), which is what the user is checking for. |

---

## Slices

### RYW-A — Write-token + query-side bounded wait (backend)

**User value:** none client-visible yet — the machinery that makes read-after-write a server guarantee.

**Scenarios (GWT):**
- Given any mutating command succeeds, then the response carries the stream + new version it wrote (`{stream, version}` body field and/or `X-Write-Token` header).
- Given a read with `If-Consistent-With: s@N`, when `proj-position[s].LastSeq ≥ N`, then it returns immediately (zero wait).
- Given a read with `If-Consistent-With: s@N`, when the position is behind, then the query polls `proj-position` until `≥ N` (bounded), then returns fresh.
- Given the wait exceeds the bound, then it returns current data + `X-Consistency: stale`.
- Given a read with no token, then behaviour is unchanged (no wait, no overhead).

**Acceptance criteria:**
- `AppendAsync`'s resulting per-stream version is surfaced in every mutating endpoint's response (the write token).
- A `ConsistencyGate` wraps read endpoints: parses `If-Consistent-With`, bounded-polls `IProcessedPositionStore`, applies the `stale` fallback; timeout configurable.
- Behaviour-neutral for clients not sending the header; the projector remains **dormant** (the gate is unit/integration-tested against a controllable in-memory position store that simulates lag — no real projector needed yet).
- Tests: returns-immediately-when-caught-up; waits-then-releases-on-advance; times-out→stale; no-token→no-wait.

### RYW-B — Client session-token plumbing (frontend)

**User value:** the client reads its own writes once async lands — no per-mutation optimism required for correctness.

**Scenarios (GWT):**
- Given a mutation succeeds with token `s@N`, when the client later reads anything depending on `s`, then the read carries `If-Consistent-With: s@N`.
- Given a read returns data confirmed at `≥ N`, then the pending token for `s` is cleared.
- Given a read returns `X-Consistency: stale`, then the client retries (bounded) or keeps the optimistic value.

**Acceptance criteria:**
- A session-level layer in the api client holds `pending[stream]=version` (high-water), captured from mutation responses; attaches the relevant token(s) to reads; clears on confirmation — **one wrapper, no per-mutation bookkeeping** (mirrors the Cosmos/Mongo driver session).
- The `stale` response drives a bounded client retry; optimistic display optional.
- Behaviour-neutral while inline (the gate no-ops); tested with a mocked `stale` → retry path and a token-round-trip.

### RYW-C — The async cutover, now safe (re-do of 27-C)

**User value:** the deployment finally matches the event-sourced design (async projectors) **and** read-after-write still works.

**Scenarios (GWT):**
- Given a command, when it returns, then no projection write happened on the request path (handlers append-only).
- Given the projector re-enabled as sole writer, when a client writes then reads (carrying its token), then it sees its write (the gate waits out the lag, typically <1s).
- Given a `FolderDeleted`/`WorkspaceDeleted` event, then the projector deletes the projection row (re-added arms).

**Acceptance criteria:**
- Remove inline `ProjectionUpdater` calls from the 5 handlers (append-only) **and** set the projector ESM `Enabled = true` — in the same slice (no shadow double-write).
- Re-add the `FolderDeleted`/`WorkspaceDeleted` arms to `ProjectionUpdater` (removed in the revert).
- Frontend drops optimism-for-correctness; reads rely on RYW (keep optimism only for instant feel where chosen).
- Server-side read-after-write paths (Api.Smoke, Browser.E2E) rely on the gate / a bounded readback; E2E green against the deployed async system.
- `architecture.md` + ADR 0009 updated: async is live; RYW is the read-after-write contract.

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
- The token/position-wait mechanism is **identical across Cosmos, MongoDB, and Postgres** — write returns a position (session token / `operationTime` / WAL LSN); the read blocks until the replica reaches it. RYW-A is that, with `proj-position.LastSeq` as the position.
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

- **RYW only bites under async.** RYW-A/B are behaviour-neutral while inline; only RYW-C flips to async — so the phase is mostly safe, reversible groundwork plus one keystone flip.
- **Reuse `proj-position`** as the catch-up signal; **per-stream version** as the token. No global sequence.
- **Bounded wait + `stale` fallback** — a read must never block indefinitely.
- Stays within the **single HTTP Lambda** until 27-D (the Command/Query split, which follows).
- **Out of scope:** a local-first sync engine (Family 3); conflict-resolution/rebase; global-ordering tokens; multi-user real-time collaboration (the `poke` channel RYW-D is single-user refresh only).

## Downstream

RYW-C **completes the async cutover** the reverted 27-C could not, on a correct read-after-write foundation. After it, **27-D** (split into Command + Query Lambdas) is unblocked, finishing ADR 0009 Stage 1.
