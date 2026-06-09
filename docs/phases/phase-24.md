# Phase 24 — Projection rebuild robustness

**Goal:** Make `POST /admin/projections/rebuild` reliable on the **first** try and incapable of **silent partial data loss**. Today `ProjectionRebuildHandler.RebuildAsync` (1) **deletes every projection unconditionally**, then (2) re-upserts ~290 rows via one **unbounded `Task.WhenAll`** against a **5s-per-op** DynamoDB client. A cold on-demand table throttles, writes cancel at 5s, the faulted tasks make `Task.WhenAll` throw → **500**, and because delete-all already ran, the read models are left **partially rebuilt** (faulted rows silently missing). It is currently only reliable on the *second* try (warm tables). This phase removes both the burst and the delete-first window. Graduated from the "Make the projection-rebuild endpoint robust" item in `technical-improvements.md`.

## Summary

| Slice | Summary | Status | Depends on |
|-------|---------|--------|------------|
| 24-A | **Bounded, retried writes.** Replace the unbounded `Task.WhenAll` with bounded concurrency (`SemaphoreSlim` cap); retry transient throttles/cancellations with backoff+jitter (subsumes a longer-timeout client). First try succeeds on cold tables. | Done | — |
| 24-B | **Upsert-and-reconcile (kill the delete-first window).** Stop the unconditional delete-all; upsert the full target set, then delete only stale rows (present in table, absent from rebuild). A fault now leaves stale-but-present rows, never missing ones. Folds in the `NoteSearchView` tombstone prune. Feedback stores stay delete-then-rebuild (monotonic). | Done | 24-A |
| 24-C | **Operability: per-projection summary, fault visibility, concurrency guard.** Return a per-projection count map (not one note count); structured logs + EMF metric + alarm on rebuild faults/duration; reject overlapping rebuilds. | Not Started | 24-A |

> **24-A is the immediate de-risk** — smallest change, independently shippable, makes the first try reliable. **24-B removes the silent-data-loss root cause** (delete-before-build). **24-C** makes a partial result observable rather than silent. Backend-only; no event-model change.

**Learning surface (secondary):** DynamoDB on-demand cold-partition throttling and why a write burst self-inflicts cancellations; bounded concurrency (`SemaphoreSlim`/chunking) vs unbounded fan-out; transient-fault retry with backoff+jitter; idempotent **upsert-and-reconcile** as a safer maintenance pattern than delete-then-rebuild; keeping a bulk op inside the 29s HTTP envelope vs moving it async.

---

## Background (confirmed in prod)

- **2026-06-05** (Phase 17 calendar-link backfill): first call → **500**, 2 ops canceled at 5s (X-Ray `1-6a22c000-…`, invocation 17.2s — *not* a Lambda timeout); 2 projection rows dropped. Immediate re-run (tables now warm) → `200 {"rebuilt":11}` in 9.9s.
- **2026-06-08** (Phase 22 `NoteSearchView` backfill): clean `200 {"rebuilt":12}` first try — luck of warm tables; the unbounded-write / 5s-timeout risk was unchanged.
- **Current scale:** ~227 cards → ~290 writes per rebuild, ~10–17s wall time. Comfortably inside the 29s HTTP limit **once the burst is bounded** — so this phase keeps the rebuild on the HTTP path (async off-loading is out of scope; see Constraints).

**Code today** (`src/Api/CommandHandlers/ProjectionRebuildHandler.cs`): lines 20–27 unconditional `DeleteAllAsync` × 8 stores; lines 53–64 build one upsert enumerable across all projections; line 66 `await Task.WhenAll(upsertTasks)`; line 68 returns `titleList.GetView().Items.Count`.

---

## Slices

### Slice 24-A — Bounded, retried writes + admin-path timeout

**User value:** A rebuild/backfill succeeds on the first call against cold on-demand tables (no "run it twice" ritual).

**Scenarios (GWT):**
- Given cold on-demand projection tables, when I `POST /admin/projections/rebuild`, then it completes `200` on the first call (no throttle-induced 500).
- Given a transient throttle/cancellation on a single write, when the rebuild runs, then that write is retried with backoff and the rebuild still completes (one fault does not fail the whole batch).
- Given the rebuild runs, then no more than **N** writes are in flight at once (bounded fan-out).
- Given a transient 5s-timeout cancellation on a rebuild write, then it is retried with backoff (not surfaced); user-request writes are unchanged (still 5s, no retry added there).

**Acceptance criteria:**
- Unbounded `Task.WhenAll(upsertTasks)` replaced with bounded concurrency (`SemaphoreSlim` gate, cap `BoundedWrites.DefaultMaxConcurrency`).
- Per-write transient-fault retry (DynamoDB throttle / `TimeoutException` / per-op cancellation / 5xx-429) with exponential backoff + jitter; non-transient faults surface immediately; a requested outer cancellation is never retried. The delete-all calls are wrapped in the same retry.
- **Retry subsumes a separate longer-timeout client** (decision): a 5s client-timeout cancellation is *recovered* by retry (and retry also covers throttles a longer timeout would not). A parallel longer-timeout store set was rejected — the test architecture injects store doubles via DI, so a second store set would bypass them; retry is strictly more robust. User-request path is untouched.
- Tests: a `BoundedWrites` unit test asserts the in-flight cap, retry-then-succeed, no-retry-on-non-transient, and surface-after-max-attempts; an Api.Integration test arms a store double to throttle one rebuild write and asserts the rebuild still returns 200 with the row present.
- Infrastructure.Assertions unchanged (no new resource).

### Slice 24-B — Upsert-and-reconcile (kill the delete-first window)

**User value:** None directly — a failed rebuild can never leave the app with missing read-model rows.

**Scenarios (GWT):**
- Given a populated projection, when a rebuild faults after upserting some rows, then the previously-present rows are still readable (no empty/partial window — the table is never wiped first).
- Given an entity deleted since the last rebuild, when the rebuild runs, then its stale row is removed (reconcile deletes rows absent from the rebuilt set).
- Given a deleted note, when `NoteSearchView` is rebuilt, then **no `Deleted=true` tombstone** remains (rebuild matches the live hard-delete).
- Given two identical consecutive rebuilds, then the second yields byte-identical projection state (idempotent).

**Acceptance criteria:**
- Remove the unconditional `DeleteAllAsync` calls; rebuild = upsert-all-then-delete-the-diff (rows in the table but not in the rebuilt set).
- **`INoteCardListStore` has no delete capability today** (no `DeleteAllAsync`) — the current rebuild upserts cards over stale rows and never prunes, so a deleted note's card survives a rebuild (found in 24-A Hawk review). 24-B's reconcile must add enumerate+delete-stale to the card store, closing this pre-existing orphan gap.
- `NoteSearchView` rebuild prunes deleted notes instead of writing tombstones (folds in the `technical-improvements.md` tombstone item).
- A fault injected mid-reconcile leaves the prior data intact (test).
- Tests: reconcile removes a since-deleted entity; tombstone-free `NoteSearchView` after rebuild; idempotent re-run.

### Slice 24-C — Operability: per-projection summary, fault visibility, concurrency guard

**User value:** A partial or slow rebuild is visible, not silent; concurrent rebuilds can't corrupt each other.

**Scenarios (GWT):**
- Given a rebuild, when it returns, then the body reports a **per-projection** count map, not a single note count.
- Given a rebuild fault, then an error log + EMF metric is emitted and the dashboard alarm can fire.
- Given a rebuild already running, when a second `POST /admin/projections/rebuild` arrives, then it is rejected (`409`) rather than racing the first.

**Acceptance criteria:**
- Response shape changes from `{"rebuilt":N}` to a per-projection summary (note the breaking shape change for any caller).
- Structured logs + an EMF metric for rebuild duration and fault count; an alarm wired (pairs with the `observability` skill).
- A guard (lock/marker) rejects overlapping rebuilds with `409`.
- Tests: summary shape; second concurrent rebuild → 409.

---

## Observability

| Risk | Symptom | What to make visible |
|---|---|---|
| Partial rebuild still possible (un-retried non-transient fault) | Read models quietly missing rows | Per-projection counts in the response (24-C) + fault metric/alarm. |
| Reconcile deletes too much (diff bug) | Live rows vanish after a rebuild | Idempotency + reconcile tests (24-B); compare per-projection counts pre/post. |
| Rebuild creeps toward 29s as data grows | Intermittent gateway timeouts | Duration metric + alarm (24-C); trips the async-offload escalation (Constraints). |

---

## Downstream payoff

This phase **unblocks** the `technical-improvements.md` item **"Auto-backfill a new projection on deploy"** — that item explicitly depends on a rebuild that cannot partial-fail. With Phase 24 done, a deploy can safely auto-trigger an idempotent rebuild, which is what makes **Phase 23**'s repeated projection backfills (23-B/23-C/23-G) self-healing instead of a manual Scribe step.

## Constraints

- **Stay on the HTTP path.** At current scale a bounded rebuild fits well inside 29s; do **not** build the async Step Functions/SQS version now. If the duration alarm (24-C) trends toward the limit, that is the trigger to escalate to a resumable async job (recorded as the future option, not this phase).
- **Backend-only** — no event-model, aggregate, or frontend change.
- **Response shape change** (24-C) — `{"rebuilt":N}` → per-projection map; update any smoke/admin caller in the same slice.
