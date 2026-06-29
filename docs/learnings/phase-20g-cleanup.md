# Phase 20-G — Cleanup + network resilience (closes Phase 20)

Folded Phase 19's **19-H** (transient-retry/backoff in `apiFetch`) into the Phase 20 cleanup, removed the last dead read (`listNotes`), and confirmed every domain is on TanStack. Two things are worth keeping.

## 1. Retry safe *reads* (GET/HEAD), not "idempotent" writes

The 19-H wording (and the 20-G scout) said "idempotent requests — GET + PUT/DELETE". As shipped, `apiFetch` retries **GET/HEAD only**.

**Why narrower is correct here**, not just easier:
- The app's writes are **optimistic mutations with immediate rollback**, and the QueryClient sets `mutations: retry:false`. A transport-level retry on a PUT/DELETE would hold the optimistic state on screen for the backoff window (~hundreds of ms) before rolling back — *worse* UX than the immediate revert the user should see.
- A POST retry risks a duplicate create.
- So the only place a transient retry helps is a **read** (a failed GET leaves blank UI with nothing to roll back). HTTP idempotency (which includes PUT/DELETE) is the wrong axis; **safe/read** is the right one.

**Test fallout that surfaced it:** turning on retry for PUT/DELETE broke 6 existing optimistic-rollback tests — they force a single 5xx and assert immediate rollback; the retry fired a second request the gated-promise handlers never resolved, hanging the mutation. That breakage *is* the signal: retrying writes fights the optimistic-rollback contract. Narrowing to GET/HEAD reverted those 6 to unchanged behaviour.

## 2. Make the backoff zeroable for tests

`retryConfig.baseDelayMs` is a mutable export; `src/test/setup.ts` sets it to `0` globally so read-failure tests (calendar/search/MeetingPicker error states) retry instantly instead of paying real wall-clock backoff and tripping `waitFor` timeouts. The real timing is still covered by a dedicated `backoffMs` unit test that snapshots/restores the config in a `finally`. Pure helpers (`parseRetryAfter`, `backoffMs`) are exported and unit-tested directly, so the integration tests only assert *behaviour* (retried/not-retried, attempt cap), never sleep durations.

## Phase 20 retro (7 slices: Gate, 20-A…20-G)

- **The keystone rule recurred every slice:** a query key with a single consumer + optimistic == server needs **no self-invalidate** — patch the cache, don't refetch. It governed todos (20-A), folders (20-B), note cards (20-C), actions/tags (20-D), and was the headline call in note-detail (20-E, see [phase-20e-note-detail](phase-20e-note-detail.md)). Invalidate only for cross-domain consumers or server-computed state (analyse).
- **The draft pattern** (20-E) is the clean answer to "seed editable state from query data without `set-state-in-effect`": `displayed = draft ?? data.field`, clear the draft on save.
- **Two retry layers, kept distinct:** TanStack query-level `retry:1` (kept low) vs the new transport-level read backoff. Low query retry stops them multiplying.
- **Process:** the phase was driven by two sessions in parallel; the [[feedback_fetch_before_planning]] guardrail (sync `origin/main` before reading the plan) came out of a 20-E collision and should keep multi-session phases from re-doing work.
