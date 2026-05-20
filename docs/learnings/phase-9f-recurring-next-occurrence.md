# Learnings: 9-F Recurring meetings — create note for next occurrence

- `MaxResults=1` on the Google Calendar `Instances` endpoint combined with a client-side `Status != "cancelled"` filter silently returns null when the only fetched instance is cancelled, producing a spurious 404. The fix requires both `ShowDeleted = false` (server-side exclusion) and a small lookahead buffer (`MaxResults ≥ 5`). **Action:** Added guardrail to `CLAUDE.md` — Done.

- `TodayCalendarEventId` was declared in `CreateNoteFromNextOccurrenceRequest`, sent by the frontend, and never read by the handler. This created a contract lie: callers populate a field that has no effect. **Action:** Added guardrail to `CLAUDE.md`: never include request-contract fields that the handler does not use — Done.

- `handleCreateNextOccurrenceNote` applied `setState` only inside the `try` block, after `await`, violating the project's optimistic-UI rule. The rule on line 80 of `CLAUDE.md` is clear; the issue was that the new handler didn't mirror the existing `handleCreateNote` pattern. **Action:** Added reminder to `CLAUDE.md` conventions: when adding a new async mutation handler, check that it follows the optimistic-first pattern of the nearest existing handler — Done.

- `hasNextOccurrenceNote: true` was returned in `GET /calendar/today` without a corresponding `nextOccurrenceNoteId`, so the "Open Note ↗" button navigated to an empty string on page reload. Rule: when a response includes a boolean flag that enables navigation, include the required ID in the same response object so the flag is actionable without a second round-trip. **Action:** Added guardrail to `CLAUDE.md` — Done.

- The `foreach` loop over `seriesIds` issued DynamoDB `GetByRecurringSeriesIdAsync` calls sequentially. All calls were independent and could be parallelised. Rule: any batch of independent `async`/`Task`-returning calls should use `Task.WhenAll`, not a sequential `foreach`. **Action:** Added guardrail to `CLAUDE.md` — Done.

## Applied status

| Learning | Status |
|---|---|
| 1. Google Calendar Instances: ShowDeleted=false + MaxResults≥5 | Applied — guardrail added to CLAUDE.md Guardrails section |
| 2. No unused request-contract fields | Applied — guardrail added to CLAUDE.md Guardrails section |
| 3. Optimistic-UI pattern: mirror nearest existing handler | Applied — note added to CLAUDE.md Conventions section |
| 4. Boolean nav flag needs companion ID in same response | Applied — guardrail added to CLAUDE.md Guardrails section |
| 5. Task.WhenAll for independent async batches | Applied — guardrail added to CLAUDE.md Guardrails section |
