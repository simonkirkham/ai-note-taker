# Phase 44-A — Change a note's linked meeting (re-link)

Re-link = move an already-linked note to a different meeting. Shipped #367, deploy #672, 2026-06-30.

## What shipped
- New event `NoteUnlinkedFromCalendarEvent` (one new type). Re-link = unlink(old)+link(new) in one append; **no-op when re-linking to the same meeting**. Reused the existing `NoteLinkedToCalendarEvent` rather than a bespoke `NoteCalendarLinkChanged`.
- Reused `POST /notes/{noteId}/calendar-link`, made idempotent (dropped the already-linked 409), instead of a new `PUT`.
- UI: a "Change" button on the linked-meeting badge reopens `MeetingPicker` (new optional `initialDate`) and swaps via the existing optimistic `useLinkNoteToCalendar` hook — no new hook needed.

## Non-obvious learnings

1. **An unconditional projection delete is unsafe under an at-least-once projector — gate it on ownership.** The first cut deleted the freed meeting's `CalendarLinkView` row by key (`DeleteAsync(previousCalendarEventId)`). Hawk caught that a redelivered/reordered stale `NoteUnlinkedFromCalendarEvent` would then clobber a link **another note** had since made to that freed meeting (silent projection data loss; only a rebuild self-heals). Fix: `DeleteForNoteAsync(eventId, noteId)` with a DynamoDB `ConditionExpression "NoteId = :noteId"`, swallowing `ConditionalCheckFailedException`. DynamoDB's absent-attribute-is-false semantics collapse *wrong-owner* and *absent* into one correct no-op path — no existence read, no TOCTOU. Generalises to **every** projector delete keyed by a value another entity can later own: condition the delete on the current owner, don't delete by key alone. The same guard is mirrored in the rebuild projection (correct under ordered replay, and now reorder-robust too).

2. **The in-memory store double cannot prove a DynamoDB `ConditionExpression` — it needs an `EventStore.Integration` (DynamoDB-Local) test.** The in-memory `DeleteForNoteAsync` is a plain `if owner matches` and passes trivially; the load-bearing behaviour is the DynamoDB conditional. Added `DynamoDbCalendarLinkIndexStoreTests` (owned→deletes, other-owner→intact, absent→no-op). Same lesson as the `*View` field-mapping guardrail: DynamoDB-boundary behaviour the double can't express gets a DynamoDB-Local test.

3. **`npm run lint` gave a false green locally while CI failed on `import-x/order`.** A new import (`./meetingDay` placed after `./MeetingPicker`) violated `import-x/order`; local `eslint .` exited 0, CI failed deterministically. On this WSL/`/mnt/c` box local eslint is unreliable (also times out at 2 min on single files). **Don't trust a local lint green here for import-order/ordering rules — CI is authoritative.** Keep imports alphabetised (case-insensitive) when adding one, rather than relying on the local linter to catch it.

4. **Calendar UI flows can't be E2E'd in the deploy gate** — the picker needs Google OAuth absent from the E2E env (why no calendar journey exists). For a re-link that only swaps client-optimistic state and touches a *pre-existing* projector read, Api.Integration + vitest is the right coverage; skipping E2E was a conscious, recorded decision, not an omission.

See [[feedback_phase_doc_review_surface]] for the phase-doc structure and [[project_projections_update_inline]] (now stale — projections are written by the async `ProjectionUpdater`/Projector, **not** inline in the command handler since RYW).
