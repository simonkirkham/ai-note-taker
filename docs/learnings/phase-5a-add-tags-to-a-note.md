---
name: phase-5a-add-tags-to-a-note
type: project
date: 2026-05-14
---

## What was built

Slice 5-A Batch 1 adds tag support to notes at the domain and API layer. `TagNote` and `UntagNote` commands produce `NoteTagged` and `NoteUntagged` events. The `Note` aggregate tracks a `HashSet<string>` of tags and rejects duplicates or operations on non-existent/deleted notes. Both the detail view and card list projections carry a `Tags` list that the API exposes on `GET /notes/{noteId}` and `GET /notes/cards`. `POST /notes/{noteId}/tags` (204/409/404) and `DELETE /notes/{noteId}/tags/{tag}` (204/404) are wired up.

## Key learnings

**`LastModifiedAt` is easy to miss in projection mutations.** When an event updates an immutable record via `with { ... }`, every property mutation in every case branch must include `LastModifiedAt = envelope.OccurredAt`. Because the projection class, the DynamoDB store, and the command handler's `ApplyNoteEventsToCard` helper all independently apply events to card state, the same omission can occur in three places simultaneously. A checklist item — "does every `with { ... }` include `LastModifiedAt`?" — is worth running against all three files whenever a new event is added.

**Aggregate throws vs. return empty for idempotent-like operations.** For "rename to same title" the aggregate returns `[]` (no event) because the end state is identical — persisting a no-op event would be noise. For "add duplicate tag" the aggregate throws `InvalidOperationException` because the caller likely made a mistake rather than being idempotent — two concurrent POSTs to the same tag is a client error, not a silent success. The distinction determines whether the command handler needs to detect an empty event list or let the exception propagate.

**DynamoDB string sets (`SS`) cannot store empty sets.** The projections only write the `Tags` attribute when `Count > 0`, and read back as `Array.Empty<string>()` when the attribute is absent. The JSON response layer then coalesces `null` to `[]` via `Tags ?? []`. This pattern is consistent with the `Date` attribute and avoids a DynamoDB `ValidationException` on empty sets.

**Route collision risk with path segments that could be route parameters.** `DELETE /notes/{noteId}/tags/{tag}` works cleanly because `tag` is a plain string route param. This would break down if tags could contain `/`. The current design keeps tags as simple alphanumeric-ish strings, so this is acceptable. Worth documenting in view-schemas.md if the tag format ever changes.
