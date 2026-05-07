# Backlog

Deferred ideas captured during planning. These are not committed to any phase — they exist so good ideas aren't forgotten. Review this list when planning a new phase or looking for the next thin slice.

Each entry records what it is, why it was deferred, and what phase or slice it was raised in.

---

## Action items

### Delete action item from the home screen
**What:** A delete button on each todo item on the home screen, so users can remove an item without navigating to the note.
**Why deferred:** Not essential for 3-E (delete from note screen covers the core need). Adding delete to two surfaces at once increases slice width.
**Raised in:** Phase 3 planning
**Depends on:** Slice 3-E (delete action item) must land first.

---

---

## Infrastructure / CI

### Clear test data before E2E journey tests
**What:** Add a "clear test data" CI step that runs *before* the E2E journey tests, not only after. Currently the post-test cleanup step prevents accumulation for future runs but does not protect the current run from stale data left by a prior failed run.
**Why deferred:** Not blocking — only causes spurious re-runs. Low risk, low effort fix.
**Raised in:** Slice 3-B (two CI re-run cycles caused by stale note titles and duplicate strict-mode matches)
**Depends on:** Nothing.

---

## Notes

_Add entries here whenever an idea is surfaced during Scout planning but explicitly deferred. Format: name, what, why deferred, raised in, any dependencies._
