# Phase 27 — Split the API Lambda: CQRS write/read split + async projectors

**Goal:** Reshape the deployment to match the event-sourced design ([ADR 0009](../adr/0009-split-lambdas-cqrs-async-projectors.md) **Stage 1**). Today one `ApiFunction` Lambda serves every route and updates all read models **inline, synchronously, in the command handler** (`NoteCommandHandler.UpdateProjectionAsync`) before the HTTP response returns — so projection-building is welded to the write request, one IAM role grants read/write across ~13 tables, and read/write traffic share one cold-start profile. This phase moves projection-building **off the request path onto a DynamoDB Stream** (a **Projector Lambda**), splits the HTTP surface into a **Command Lambda** (append-only, event-store IAM) and a **Query Lambda** (reads, projection-read-only IAM), and accepts the headline trade-off: **read-after-write becomes eventually consistent**. Graduated from the "Split the single API Lambda (CQRS + async projectors)" item in `technical-improvements.md`. **Stage 2** (per-context command Lambdas) is explicitly **out of scope** — see Constraints.

## Summary

| Slice | Summary | Status | Depends on |
|-------|---------|--------|------------|
| 27-A | **Extract a shared, idempotent projection updater (no behaviour change).** Lift the per-event inline projection logic out of all 5 command handlers into one `ProjectionUpdater` they still call inline. Made-idempotent only where cheap and apply-once-equivalent (card tag/action-item add-if-absent); the increment-based feedback counters' redelivery guard is deferred to 27-B (needs a processed-event marker 27-A excludes). Pure refactor behind existing specs. | Done | — |
| 27-B | **DynamoDB Stream + Projector Lambda, in shadow.** Enable a stream on `notetaker-events`; add a Projector Lambda (event-source mapping, DLQ, bisect-on-error, max-retry/record-age) that drives the 27-A `ProjectionUpdater` from stream records. **Inline updates stay** — the projector is redundant-but-idempotent, so reads are unchanged. Banks Streams/idempotency/DLQ/replay + observability with **zero** consistency change. | Done _(stream trigger disabled after the 27-C revert — projector deployed but dormant; re-enable in 27-RYW)_ | 27-A |
| 27-C | **Cut over to async (remove inline updates).** ⚠️ **Attempted (PR #250) + frontend follow-up (#251), then REVERTED.** The backend cutover + projector were correct, but the frontend was built for immediate consistency — it reads server truth after navigation and reconciles via refetch, which under async raced the lagging projector → read-after-write broke across navigation, and patching it reactively became whack-a-mole (multiple distinct races across `keys.noteCards`/`keys.note`/`keys.actions`, plus a regression). Reverted to inline immediate-consistency. **Blocked on a read-your-writes foundation** (27-RYW) before re-attempting. | Reverted → blocked | 27-RYW |
| 27-RYW | **Read-your-writes foundation (NEW — the real prerequisite the cutover exposed).** A command returns the stream position it wrote; a read can request "consistent as of position N" and the query side waits/polls the projection until it reaches N. Gives the client read-after-write without per-mutation optimism or magic timers — the proper CQRS answer. **Re-enable the projector ESM (disabled in the revert) as step 1.** | Not Started | 27-B |
| 27-D | **Split the HTTP Lambda into Command + Query functions.** Two functions with per-method/path API Gateway routing; Command IAM = event store (+ draft store + write-path side services); Query IAM = projection tables **read-only**. Completes the 3-Lambda Stage-1 shape; tightens blast radius per deploy. | Not Started | 27-RYW |

> **27-A is a safe, shippable precursor** — the seam the projector needs, no deployment or consistency change. **27-B** banks the entire Streams/async-failure lesson while inline still guarantees correctness (fully reversible: delete the projector). **27-C is the headline trade-off** — the consistency flip, isolated from the function split so it can be reasoned about and rolled back alone. **27-D** is the literal "split the Lambda" deliverable. Each slice is independently shippable and independently reversible.

**Learning surface (primary — this is the largest remaining ES lesson):** DynamoDB Streams as the fan-out transport off the log; projector **idempotency** and replay-safety (stream redelivery, re-fold-from-stream); **eventual consistency** and the read-after-write tests it breaks; **async failure handling** (DLQ + alarm + structured logs vs a synchronous 500); per-function **least-privilege IAM**; per-method API Gateway routing to split integrations.

---

## Background (confirmed in the codebase)

- **One Lambda, inline projections.** `ApiFunction` (256 MB, SnapStart `ON_PUBLISHED_VERSIONS`, `live` alias, `Tracing.ACTIVE`) at `NoteTakerStack.cs:209`; API Gateway proxies `ANY /{proxy+}` to the alias. All 5 handlers (`Note`, `ActionItem`, `Todo`, `Folder`, `Workspace`) append then update read models inline before returning.
- **Two apply paths already diverge.** The **inline** path does incremental per-event apply (`NoteCommandHandler.UpdateProjectionAsync` + peers); the **rebuild** path (`ProjectionRebuildHandler`) folds the full stream through the projection classes (`NoteTitleListProjection`, …). 27-A unifies the inline path behind one seam the projector reuses; the rebuild handler is untouched and keeps working.
- **No stream today.** `notetaker-events` (`PK`=streamId, `SK`=`v{seq:D8}` for events / `META#stream` for the version row) has **no `StreamSpecification`** (`NoteTakerStack.cs:19`). Append is one `TransactWriteItems` writing the event row(s) **and** the META row together — so a stream emits **both** record kinds; the projector must **filter to event rows** (`SK` begins `v`, ignore `META#`).
- **13 projection tables, 1 role.** `eventsTable.GrantReadWriteData` + every `proj*Table.GrantReadWriteData` land on the one `apiFunction` (`NoteTakerStack.cs:330`). The draft-transcription table (`PUT`/`DELETE .../transcription/draft`) is **non-event working state** and stays on the command path.
- **Reads are strongly consistent today** (`ConsistentRead=true`) and tests rely on it: `ApiIntegrationTests.GetNotes_ReturnsItemsContainingCreatedNote`, `ActionItemCompleteReopenTests.GetActions_AfterComplete_…`, and the `Browser.E2E` journeys all append then immediately read a projection.

---

## Slices

### Slice 27-A — Extract a shared, idempotent `ProjectionUpdater`

**User value:** None directly — a single, tested apply seam so the projector and the write path can never drift, and a precondition for everything downstream.

**Scenarios (GWT):**
- Given any command that today updates projections inline, when it runs, then the read models end in **byte-identical** state to before the refactor (every existing spec stays green).
- Given the same event batch is applied **twice**, when `ProjectionUpdater` runs again, then the **naturally-idempotent** read models are unchanged: re-fold-from-history projections (title/detail/search), full-PUT projections (todo/tagindex/calendarlink/folder/workspace), set-based card mutations (complete/reopen/file/unfile), and the made-idempotent card append paths (tag/action-item add-if-absent). **The increment-based feedback counters are explicitly NOT made redelivery-idempotent here** — that needs a processed-event/position guard, which is the projector's job in **27-B** (see note below).
- Given a `NoteDeleted` event, when applied, then every projection drops the note's rows exactly as the inline delete path does today.
- Given a META-row change (no event payload), when handed to the updater, then it is a no-op.

**Acceptance criteria:**
- One `ProjectionUpdater.Apply(EventEnvelope)` (or per-stream batch) replaces the bespoke `UpdateProjectionAsync`/inline blocks in all 5 command handlers; handlers call it inline (behaviour unchanged).
- **Naturally-idempotent paths** stay so (re-fold-from-history, full PUT, set-based card mutations). The two cheap non-idempotent card paths are **made idempotent, behaviour-equivalent for apply-once**: card tag append → append-if-absent; card action-item add → add-if-absent.
- **Increment-based feedback counters** (`RecordSuggestionAsync` `ADD SuggestedCount`; `TryRecordCompletion/Deletion` `ADD …Count` without removing provenance) are left increment-on-apply — full redelivery-idempotency for them is **deferred to 27-B**'s processed-event/position guard (a new table/marker is excluded from 27-A; reworking the counter model is scope creep). Apply-once behaviour is byte-identical to today.
- No event-model, aggregate, API, CDK, or frontend change; **no new table**. `ProjectionUpdater` registered as a scoped service; depends on the same stores + `ICurrentUser`/`ICurrentWorkspace` the handlers use today (27-B later sources user/workspace from event metadata).
- Tests: a `ProjectionUpdater` spec asserting apply-twice == apply-once for the naturally-idempotent + made-idempotent families (NOT the feedback counters); the full existing suite green proves no behaviour change.

### Slice 27-B — DynamoDB Stream + Projector Lambda (shadow mode)

**User value:** None directly — the async pipeline runs and is observable in prod while inline updates still guarantee correctness (reversible de-risk).

**Scenarios (GWT):**
- Given the stream is enabled, when an event is appended, then the Projector Lambda is invoked with the new event record and applies it via the 27-A `ProjectionUpdater`.
- Given the projector receives a `META#stream` record, then it is filtered out (only `SK`-`v…` event rows are applied).
- Given a stream record is redelivered, when the projector reprocesses it, then read-model state is unchanged — the naturally-idempotent paths (27-A) plus a **per-stream processed-position guard** that skips already-applied sequence numbers, which is what makes the increment-based feedback counters (deferred from 27-A) redelivery-safe.
- Given a projector apply throws on one record, when the batch retries to exhaustion, then the failed record goes to the **DLQ** and the alarm fires (it does **not** silently vanish or wedge the shard forever).
- Given inline updates are still active, when the projector also writes, then reads are unaffected (both converge to the same state; projector is redundant in shadow).

**Acceptance criteria:**
- `StreamSpecification` (`NEW_IMAGE`) enabled on `notetaker-events`; a `ProjectorFunction` Lambda with a DynamoDB event-source mapping (batch size, **bisect-on-function-error**, `maxRetryAttempts`, `maxRecordAge`, on-failure **DLQ** SQS).
- Projector filters to event rows, applies via `ProjectionUpdater`, and is granted **projection tables only** (read/write) + event-store **read** (to re-fold a stream if needed) — not a copy of the monolith role.
- **Per-stream processed-position guard** (the redelivery-idempotency mechanism deferred from 27-A): track the highest applied sequence per stream and skip records at or below it, so the increment-based feedback counters cannot double-count on stream redelivery. Decide its home (a marker attribute / small guard table) in this slice.
- **Observability wired in this slice (non-negotiable per ADR 0009):** structured logs (stream id/version, correlation id), an EMF **projector-lag** metric (`now − OccurredAt` at apply), failure-count metric, **DLQ-depth alarm** + projector-error alarm on `notetaker-ops`.
- Inline `ProjectionUpdater` calls **remain** in the command handlers (shadow).
- `tests/Infrastructure.Assertions`: stream enabled, ESM present with DLQ + bisect + retry caps, projector role is least-privilege (no event-store write).
- Tests: projector integration spec (DynamoDB Local + stream/Testcontainers, or a handler-level invoke) covering apply, META-filter, redelivery idempotency, and DLQ-on-poison.

### Slice 27-C — Cut over to async (remove inline updates)

**User value:** The deployment now behaves as an event-sourced system — writes append and return faster; read models rebuild from the log. The cost: a small, optimistic-UI-masked read lag.

**Scenarios (GWT):**
- Given a command is issued, when it returns `2xx`, then **no** projection write happened on the request path (the handler appended only).
- Given an append, when the projector lags, then the projection reflects the change **eventually** (bounded, typically <1s) — and the frontend already shows it immediately via optimistic update.
- Given a server-side read-after-append test, when it reads a projection just after a write, then it **polls with a bounded timeout** rather than asserting immediate presence.
- Given the projector falls behind or fails, then the lag/DLQ alarms from 27-B surface it (a stale read is visible, not silent).

**Acceptance criteria:**
- Remove every inline `ProjectionUpdater` call from the 5 command handlers; command handlers are append-only (draft-store `PUT`/`DELETE` stays — it is non-event working state).
- Server-side read-after-write moves to retry/polling with a bounded timeout in `tests/Api.Integration`, `tests/Api.Smoke`, and `tests/Browser.E2E` (an explicit AC of this slice per ADR 0009).
- `docs/architecture.md` and the [ADR 0001](../adr/0001-event-sourcing.md) "no eventual-consistency delay" note are updated to reflect async projectors; record the cutover in ADR 0009 (status note).
- `ProjectionRebuildHandler` continues to work unchanged (direct full-stream fold) — rebuild is **not** broken by the cutover; stream-replay rebuild is out of scope (Constraints).
- Still a **single** HTTP Lambda — the function split is 27-D, kept separate from the consistency flip.
- Tests: an integration test that appends, asserts the read is initially absent/stale **and** becomes present within the bound, proving the async path end-to-end.

### Slice 27-D — Split the HTTP Lambda into Command + Query functions

**User value:** None directly — deploy/scaling isolation and least-privilege IAM; a write deploy can no longer touch read-path permissions and vice-versa.

**Scenarios (GWT):**
- Given a write route (`POST`/`PATCH`/`PUT`/`DELETE`), when it is called, then the **Command Lambda** serves it; its role grants the **event store** (+ draft store + write-path side services: Bedrock, STS, Calendar, image bucket) and **no projection-table reads/writes**.
- Given a read route (`GET`), when it is called, then the **Query Lambda** serves it; its role grants the **projection tables read-only** and **no event-store write**.
- Given the projector from 27-B, then the deployed shape is exactly **three** Lambdas (Command, Query, Projector), each with its own role, log group, and alarms.
- Given a request to either function, when it runs, then auth/JWT/`ICurrentUser`/`ICurrentWorkspace` resolve identically to today (shared plumbing, not duplicated divergently).

**Acceptance criteria:**
- Two Lambda functions (separate hosts, or one binary selecting its route set by config); API Gateway routes by method/path to the two integrations instead of one `ANY /{proxy+}`.
- Command role: event store read/write + `TransactWriteItems` + draft store + side services. Query role: projection tables **read-only**. Neither holds the other's grants (resource-`GrantX` path per CLAUDE.md, not bare `AddToRolePolicy`).
- Both functions keep SnapStart + `live` alias + active tracing; `/health` and `/admin/projections/rebuild` placement decided and documented (rebuild reads events + writes projections → Command side or its own admin grant).
- `tests/Infrastructure.Assertions`: two functions exist, per-method routes resolve to the right integration, and each role is least-privilege (Query has **no** event-store write; Command has **no** projection grant).
- Smoke + E2E green against the split shape.

---

## Observability

Driven by the `observability-brief` skill — async projection failure is invisible by construction, so this is the load-bearing section.

| Risk | Symptom | What to make visible | Slice |
|---|---|---|---|
| Projector throws and the record is dropped/wedged | Read models silently stale or one note never updates | On-failure **DLQ** + DLQ-depth alarm; bisect-on-error so one poison record can't wedge the shard | 27-B |
| Projector falls behind under load | Read-after-write lag grows past "optimistic UI masks it" | EMF **projector-lag** metric (`now − OccurredAt`) + alarm; iterator-age CloudWatch metric on the ESM | 27-B/27-C |
| Idempotency/dedup bug | Double-applied events corrupt feedback counters | apply-once==apply-twice tests (27-A) + a "duplicate skipped" metric | 27-A/27-B |
| Cutover regresses a read path | A view returns stale/empty after the flip | Smoke/E2E moved to bounded polling; lag alarm; per-projection counts via the rebuild endpoint as a spot-check | 27-C |
| Split IAM too tight | Command or Query Lambda 500s on a denied action | Per-function error-rate alarm + structured `AccessDenied` logs; least-privilege assertion tests | 27-D |
| Meta-row not filtered | Projector errors on `META#stream` records | META-filter test + projector error alarm | 27-B |

---

## Sequencing

- **Start after Phase 23's backend tail (23-F + 23-G) is merged.** Not a hard dependency, a deliberate ordering choice (confirmed 2026-06-11). 23-F (move-note) and 23-G (cleanup/backfill) both mutate the inline-projection surface (`NoteCommandHandler` re-bucket, routing, `ProjectionRebuildHandler`) that 27-A extracts and 27-C retires — running them concurrently with 27-A forces a large rebase and re-ports inline logic into the projector. Let Workspaces finish, then 27-A lands on a stable handler/projection surface.
- **Parallelises freely with Phase 19** (frontend-only — disjoint file set) and with **23-E** (frontend switcher). The only constraint is 27 vs the 23 *backend* slices.
- The single deploy pipeline serialises merges regardless; expect merge-gate contention, not file conflicts, against 19/23-E.

## Constraints

- **Stage 1 only.** Per-context command Lambdas (Stage 2 of ADR 0009 — Note/Folder/Calendar/Transcription/Todo split) are **out of scope**; adopt incrementally later, only where a context earns it. This phase stops at the 3-Lambda Command/Query/Projector shape.
- **Stream-replay rebuild is out of scope.** `ProjectionRebuildHandler`'s direct full-stream fold keeps working after cutover; "rebuild = re-drive the projector from position 0" + a runbook is a documented future enhancement, not a slice here.
- **Transport is DynamoDB Streams, not EventBridge** (ADR 0009 decision: proximity to the log, natural per-key ordering, zero extra write). Revisit only if multi-consumer routing grows.
- **Eventual consistency is the deliberate trade-off** — do not try to preserve immediate read-after-write. The frontend's optimistic updates already insulate the user; server-side callers move to polling.
- **Reversibility:** 27-A is behaviour-neutral; 27-B is shadow (delete the projector to revert); 27-C is the only one-way-ish flip (re-add inline calls to revert); 27-D is a deployment-topology change behind the same routes.

## Downstream payoff

- Banks the **largest remaining event-sourcing lesson** for the project (Streams, idempotency, replay, eventual consistency, async failure handling).
- **Shrinks the write path** — the Command Lambda drops all projection-handler code and ~13 table grants; smaller blast radius per write deploy.
- Sets up **Stage 2** (per-context command Lambdas) and **stream-replay rebuild** as clean follow-ons.
