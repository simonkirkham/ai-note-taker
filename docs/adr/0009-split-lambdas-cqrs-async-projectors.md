# ADR 0009 — Split the single API Lambda into CQRS write/read Lambdas with async projectors

**Status:** Accepted · **Stage 1 async-projector cutover COMPLETE (2026-06-13) via Phase 27-RYW; Stage 2 (per-context split) deferred**

> **Implementation status (2026-06-13).** **Stage 1 is done.** **27-A** (shared `ProjectionUpdater` seam) and **27-B** (DynamoDB stream + async Projector Lambda) shipped, then **27-C** (the atomic remove-all-inline-writes cutover) was **attempted and reverted** — the projector was correct, but the frontend was built for immediate consistency and flipping every flow at once raced the ~1s projector lag across navigation; per-mutation optimistic patching was whack-a-mole. The fix was a **read-your-writes (RYW) foundation** built **incrementally, flow-by-flow** rather than as a big-bang flip — **[Phase 27-RYW](../phases/phase-27-ryw.md)**:
> - **RYW-1** proved the loop on one call (async add-a-to-do, token-gated); **RYW-2** scaled to the note flows; **RYW-3a/3b** to actions, then folders + workspaces; **RYW-3c** confirmed analysis was already migrated (it rides on `note#`/`action#`) and pinned the feedback-counter close with a guard test; **RYW-4** completed the cutover docs (this update).
> - The result: **every command handler is append-only and the async projector (Projector Lambda in prod) is the sole writer of every read model.** Read-after-write is delivered by **consistency tokens**: a write returns `stream@version`; a read presenting it in `If-Consistent-With` waits (bounded ~2s) on the projector's processed-position store, then answers — else flags `X-Consistency: stale`. This is **session consistency** (cf. Cosmos session tokens / Mongo `afterClusterTime` / Postgres `WAIT FOR LSN`). Frontend optimism is now **feel-only**, not load-bearing for correctness.
>
> **The lesson that held:** the async projectors were the easy part — the read-after-write *contract* was the work, and the way to land it was incremental (prove one call, strangle the rest flow-by-flow), never a big-bang flip. See [the 27-C learnings](../learnings/phase-27c-async-cutover-reverted.md). **Stage 2** (per-context Command/Query Lambda split, 27-D) is the remaining, optional follow-up.

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

- **Read-after-write becomes session-consistent (landed via Phase 27-RYW).** The projector lags the write by stream latency (typically <1s, real and unbounded under backpressure), so it gives up ADR 0001's immediate-consistency property — but read-after-write is preserved by **consistency tokens**, not lost. A write returns `stream@version`; a read presenting it waits (bounded ~2s) on the `proj-position` store until the projector catches up, then answers (else `X-Consistency: stale`). The cutover was done **incrementally, flow-by-flow** (not the reverted big-bang 27-C).
  - **Frontend optimism is now feel-only**, not the correctness mechanism (see `architecture.md` → *Frontend state management*); the server owns read-after-write.
  - **Server-side read-after-write resolved:** the `ConsistencyGate` provides the bounded wait; `tests/Browser.E2E` RYW journeys **reload then assert** to prove the server read. ✅ done.
  - `architecture.md` updated (RYW-4); ADR 0001's "no eventual consistency delay" note is now superseded by the token-gated session-consistency model.
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
