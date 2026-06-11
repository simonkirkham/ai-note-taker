# ADR 0009 — Split the single API Lambda into CQRS write/read Lambdas with async projectors

**Status:** Accepted · **Stage 1 in progress (Phase 27)**

> **Implementation status (2026-06-11):** Stage 1 is landing as Phase 27. **27-A** extracted the shared `ProjectionUpdater` seam; **27-B** added the DynamoDB stream + async **Projector Lambda** in shadow (inline still authoritative); **27-C** removed the inline projection writes — the command handlers are now **append-only** and the projector is the sole read-model writer, so **read-after-write is eventually consistent in prod**. In-process hosts (tests + local Kestrel) use `SyncProjectingEventStore` to run the same projector synchronously, so only the deployed system is async. **27-D** (split the HTTP Lambda into Command + Query functions) is the remaining Stage-1 step. Stage 2 (per-context command Lambdas) remains deferred.

## Context

The backend today is one `ApiFunction` Lambda: an ASP.NET minimal API behind an HTTP API Gateway proxy that handles every route (Note, Folder, Calendar, Transcription, Todo, Auth). On a write it loads the aggregate's event stream, runs `Decide`, appends events, then updates the affected read-model projections **inline in the command handler, synchronously, in-process, before the HTTP response returns** (e.g. `NoteCommandHandler.UpdateProjectionAsync`). Reads are served from the same Lambda by querying projection tables.

That synchronous, inline projection update gives the system one valuable property — **immediate read-after-write consistency** (see ADR 0001 and `docs/architecture.md`): a projection is up to date the instant the command returns. But it also means the deployment shape does not reflect the event-sourced design it sits on top of. The defining trait of an event-sourced system at deployment scale is an append-only log with **decoupled, independently replayable async consumers** building read models — and we don't have that. Projection-building is welded to the write request; the one Lambda's IAM role grants read/write across ~10 tables; read and write traffic share one function's concurrency and one cold-start profile.

This project optimises for **event-sourcing learning surface**, not shipping velocity (see `docs/goals.md`). The async-projector decoupling is the single largest remaining ES lesson the codebase hasn't exercised: DynamoDB Streams wiring, projector idempotency, replay/rebuild, eventual consistency, and async failure handling (DLQs, alarms).

Three target shapes were weighed (see *Alternatives considered*). The choice splits on two independent axes: **(a) async projectors** — the actual event-sourcing trait — and **(b) per-context command Lambdas** — a deployment-isolation concern that is mostly an *ops* lesson, not an *ES* lesson, and that multiplies .NET cold starts for a single-user app.

## Decision

Adopt **CQRS at the deployment level with async projectors driven off the event log**, and roll it out in **two stages** so the consistency-model lesson is banked before taking on fan-out breadth.

### Stage 1 — CQRS write/read split + async projectors *(do first)*

```
API GW ─POST/PATCH─▶  Command Lambda ──append──▶  Event store ──(DynamoDB Stream)──▶  Projector Lambda ──▶ Read models
                      (load → Decide →                                                (idempotent,             ▲
                       append only)                                                    replayable)             │
API GW ─GET────────▶  Query Lambda ───────────────────────────read──────────────────────────────────────────┘
```

- **Command Lambda** — loads the stream, runs `Decide`, appends events with optimistic concurrency. It no longer updates projections inline. Its IAM grants the event store only.
- **Projector Lambda** — triggered by the **DynamoDB Stream** on the event store table. Folds events into read models. Must be **idempotent** (stream records can be redelivered) and tolerant of per-shard reordering. Its IAM grants the projection tables only.
- **Query Lambda** — serves `GET` routes from projections. Read-only IAM.

The projection-fold logic currently inline in the command handlers (e.g. `NoteCommandHandler.UpdateProjectionAsync`) is extracted into the projector — this stage formalises into a stream consumer the projection-building the write path does inline today. (An earlier dispatcher-based seam, `IDomainEventDispatcher`/`IDomainEventHandler`, was removed as dead code once projections were inlined; the projector reuses the *fold logic*, not those deleted classes.)

### Stage 2 — per-context command Lambdas *(when ready to take it on)*

Once Stage 1 is stable, split the command surface by bounded context (Note / Folder / Calendar / Transcription / Todo) into separate Lambdas. Adopt this **incrementally, only where a context earns it** — e.g. Transcription's long-running, different-memory profile justifies isolation before, say, Folder does. Routing moves to per-path API Gateway integrations; shared command-handler/auth/DI plumbing is extracted into a shared layer.

This is deliberately deferred, not skipped: it adds deploy/scaling isolation and tighter per-context IAM, but on .NET it multiplies cold starts and operational surface, so it should follow demand rather than lead it.

## Consequences

- **Read-after-write becomes eventually consistent.** The projector lags the write by stream latency (typically <1s, but real and unbounded under backpressure). This is the headline trade-off — it gives up the immediate-consistency property ADR 0001 and `architecture.md` currently advertise.
  - The **frontend already insulates the user** via optimistic updates (see `architecture.md` → *Frontend state management*), so the UX impact is small.
  - **Server-side read-after-write must change:** `tests/Api.Smoke`, `tests/Browser.E2E`, and any flow that appends then immediately reads a projection must move to **retry/polling** with a bounded timeout. This must be an explicit acceptance criterion in the migration slice's BDD spec.
  - `architecture.md` and ADR 0001's "no eventual consistency delay" note must be updated when this lands.
- **Projectors must be idempotent and replay-safe.** Stream redelivery and cross-shard reordering are now the projector's problem. Each handler needs a dedup/version guard, leaning on the existing event versioning and stream-position data. This is the core new ES skill the change teaches.
- **Projection failures become asynchronous and invisible.** Today a failing handler surfaces as a synchronous 500 to the caller. Behind the Stream it's a silent async failure that needs a **dead-letter queue + CloudWatch alarm** and structured logging. The `observability` skill must be applied **in the same slice** — non-negotiable, not a follow-up.
- **Write path shrinks and tightens.** The Command Lambda drops all projection-handler code and ~9 table grants; blast radius per write deploy falls. Read and write scale and cold-start independently.
- **More moving parts.** Stage 1 goes from 1 Lambda to 3 (3 cold-start profiles, 3 roles, 3 log groups). The CDK stack (`src/Infrastructure/NoteTakerStack.cs`) gains the Stream, projector function + event-source mapping, DLQ, and split IAM. `tests/Infrastructure.Assertions` must assert the new wiring (stream enabled, DLQ attached, least-privilege roles).
- **Rebuild becomes a first-class operation.** A projection rebuild is now "re-drive the stream / re-run the projector from position 0" rather than redeploying the monolith — a capability worth an explicit runbook.
- **Staging limits risk.** Stage 1 delivers the entire ES lesson with the smallest function count; Stage 2's ops complexity is opt-in per context. The two stages are independently shippable and independently reversible.

## Alternatives considered

- **Option 2 up front — per-context command Lambdas *and* async projectors in one move.** Same async-projector benefit as Stage 1 plus per-context isolation, but ~7+ Lambdas to wire and observe from day one and N cold starts on .NET (rarely-hit contexts like Calendar cold more often). Most of the extra is an ops lesson, not an ES lesson. Rejected as the *starting* point; retained as **Stage 2**, adopted incrementally where a context earns it.
- **Option 3 — split the HTTP surface by context but keep projections synchronous in-process.** Preserves immediate consistency and needs no test/Stream changes, but it is the one option that does **not** add the defining event-sourcing trait (decoupled async consumers). Projection handlers and their table grants get duplicated across command Lambdas, keeping the very coupling we want to remove, while still paying the multi-Lambda cold-start/routing cost. Worst cost-to-learning ratio for this project's goals. Rejected.
- **Status quo — single Lambda, synchronous dispatch.** Simplest and immediately consistent, but leaves the largest ES learning surface unexercised and the deployment shape misaligned with the design. Rejected for a project whose explicit goal is event-sourcing learning.
- **EventBridge instead of DynamoDB Streams as the fan-out transport.** Richer routing/filtering and easier multi-consumer fan-out, but adds a publish step and at-least-once semantics without the natural ordering-per-key and zero-extra-write that Streams give directly off the event table. Streams chosen for Stage 1 for proximity to the log; EventBridge revisitable if multi-consumer routing grows.
