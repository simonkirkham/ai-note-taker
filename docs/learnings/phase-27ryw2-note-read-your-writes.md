# RYW-2 — Read-your-writes for the note flows

**Slice:** Phase 27-RYW / RYW-2 · **PRs:** #255 (slice) + #256 (roll-forward) · **Merged:** 2026-06-13

## What shipped

Scaled the RYW-1 loop (token → async projector → gate-wait → client session-token) from todos to the whole **Note** aggregate.

| Layer | Change |
|---|---|
| `NoteCommandHandler` | Append-only — returns the new stream version (write token); no inline `ProjectionUpdater` call. Projector is sole writer of note read models. `note#` joins `MigratedPrefixes`. |
| `NoteHandlers` | Note writes set `X-Consistency-Token`; `GET /notes/{id}` + `GET /notes/cards` gate on `If-Consistent-With` (bounded wait, `X-Consistency: stale` on timeout). |
| Card store | Field-level `UpsertNoteFieldsAsync` / `UpdateActionItemsAsync` (via `UpdateItem`) replace full-item `PutItem` on the live path, so the cross-aggregate card row (note events own note fields, action events own ActionItems) commutes under concurrent writers. Full-item `UpsertAsync` retained for rebuild only. |
| Frontend | `consistencyTokens` generalised to per-stream + per-list "latest write" slots; `notes`/`tags` capture the token and gate their reads (bounded stale retry). |

No new projection (the note card projection already existed) → no backfill.

## The lesson — flipping a read flow to async breaks pre-existing E2E journeys that assert without a reload

**Symptom:** PR #255 passed *every* PR CI check, then **failed the post-deploy E2E gate** — `TagsJourney.AddTag_PillAppearsOnHomeCard`.

**Root cause:** RYW-2 made the cards list projector-built (async). The pre-existing journey asserted a freshly-tagged card with **no reload**, so a cold/slow projector (slower than the gate's ~2 s bound) returned `X-Consistency: stale` and the single read missed the tag. It was **latency, not a missing projection** — the note-*detail* read (same `note#` stream, gated) passed because it ran warmer, and an in-process test proves a gated cards read *does* see the tag.

**Why the new journeys were fine but the old ones broke:** the RYW-1/RYW-2 *new* journeys were written reload-tolerant (reload re-sends the token and re-gates). The *pre-existing* journeys were written for **synchronous inline** projection, where the post-save read was always fresh. The moment the flow went async they became races.

**Generalisable rule:** when a slice flips a read flow from synchronous-inline to async-projector, **every pre-existing E2E journey that asserts server-rendered data immediately after a write+navigate (without a reload) is now a latent race.** Audit and make them reload-tolerant **in the same slice**. PR CI cannot catch this — E2E only runs in the deploy gate, so the cost is a full failed-deploy + roll-forward cycle.

## The fix (#256, test-only)

Centralised, not per-test: a `WaitVisibleWithReloadAsync` helper that reloads to re-gate **only while the locator is not yet visible** (zero cost once the projector is warm). `ClickNoteInListAsync` made reload-tolerant (protects every navigation-after-write journey, not just the one that broke); `AssertCardTagVisibleAfterReloadAsync` replaced the strict assertion. Added `GetNoteCards_WithConsistencyToken_SeesTheNewTag` (Api.Integration) proving the projector builds card tags — so the deployed flow's only variable is latency.

## Smaller notes

- I added the missing `NoteReadYourWritesJourney` E2E during the slice — RYW-1 shipped a Todo journey; RYW-2 lacked the note equivalent. Acceptance criteria called for it.
- The field-level `UpdateExpression` is the one piece Docker couldn't validate locally (DynamoDB Local integration test runs in CI only). Reviewed by hand: every `ExpressionAttributeNames`/`Values` entry is always referenced (else `ValidationException`); `if_not_exists` seeds ActionItems; attribute names/formats match the existing `UpsertAsync`/`GetByNoteAsync`. CI `eventstore` check confirmed green.

## Follow-ups (non-blocking, open)

1. DynamoDB integration test covers the `Date`/`Tags` REMOVE branch but not `FolderId`/`WorkspaceId` (same uniform `AddOptional` path). One-line extension closes the last untested REMOVE arms.
2. `AssertCardTagVisibleAfterReloadAsync` is assert-first (not reload-first like the sibling RYW helpers) — deliberate (the home card list has no optimistic tag state; the in-process test covers the server proof). A one-line comment noting the divergence would stop a future "fix."

Related: [[phase-27ryw1-todo-read-your-writes]] · [[phase-27c-async-cutover-reverted]] · [[phase-23g-rootless-route-removal]] (the same class: green PR CI ≠ safe when the deployed surface/behaviour changes).
