---
name: phase-5ab-tags-frontend
type: project
date: 2026-05-14
---

# Slice 5-A/B Batch 2 — Tags Frontend Learnings

## What we built

Wired the tags frontend for Slices 5-A (add tags) and 5-B (remove tags). The backend was fully
complete; this batch added the E2E journey tests and fixed a bug in the frontend implementation.

## Key learnings

### One API call per tag — not one call per input

The spec says: type "1:1s Bill" → fire `tagNote(noteId, "1:1s")` then `tagNote(noteId, "Bill")`.
The existing `handleAddTags` in `NoteView` incorrectly joined tokens with `join(" ")` and sent a
single POST. The fix: iterate `newTokens` and fire one call per token. This is easy to miss when
the UI looks right (optimistic update doesn't care how many API calls fire) but would silently
create multi-word tags on the server.

### data-testid as a first-class citizen

None of the existing `TagsSection` or `NoteCard` tag elements had `data-testid` attributes,
making E2E targeting impossible. Adding testids should be part of the initial component
implementation, not an afterthought. Pattern: `tag-pill-{tag}` on the pill span,
`card-tag-{tag}` on the card pill, `tags-section` on the container, `tag-input` on the input.

### Waiting for all async API calls before moving on

`WaitForResponseAsync` resolves on the first matching response. When the user types
space-separated tags, the frontend fires multiple POSTs. A test that only waits for the first
POST will proceed before the second tag is persisted, causing intermittent failures in remove-tag
or navigation tests. The fix: count tokens and register that many `WaitForResponseAsync`
listeners before pressing Enter, then `await Task.WhenAll(...)`.

### TagsSection architecture choice

The spec described `TagsSection` taking `noteId`, `tags[]`, and `onTagsChanged` props, but the
actual implementation lifts API calls to `NoteView` and passes `onAdd`/`onRemove` handlers down.
This keeps `TagsSection` as a pure controlled component — cleaner, more testable, and consistent
with the `ActionsSection` pattern. The E2E tests target testids rather than props, so the choice
doesn't affect acceptance.

### The `inputRef` in TagsSection

`TagsSection` declares `const inputRef = useRef<HTMLInputElement>(null)` and attaches it to the
input, but never reads it. This is dead code — consider removing in a future refactor unless
programmatic focus is added later (e.g., focus after tag added).
