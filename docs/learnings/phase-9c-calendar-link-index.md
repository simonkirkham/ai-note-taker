# Learnings: 9-C — NoteLinkedToCalendarEvent + CalendarLinkIndex

- `Task.WhenAll` over per-item external calls had no per-item error isolation — a single DynamoDB failure in `GetTodaysMeetings` would have 500'd the entire calendar response. **Action:** Added "any `Task.WhenAll` over per-item external calls must wrap each item in a try/catch, returning null on failure" to Pip's Step 1d pre-PR checklist in `agent-roles.md` — Done.

- `LinkNoteToCalendar` handler accepted `CancellationToken ct` but did not forward it to `GetByNoteAsync` or `HandleAsync`. **Action:** Added "every handler that accepts `CancellationToken ct` must pass it to all store and handler calls" to Pip's Step 1d pre-PR checklist in `agent-roles.md` — Done.

## Applied status

| Learning | Status |
|---|---|
| 1. Task.WhenAll per-item try/catch | Applied — added item 5 to Pip's Step 1d checklist in `agent-roles.md` |
| 2. CancellationToken propagation | Applied — added item 6 to Pip's Step 1d checklist in `agent-roles.md` |
