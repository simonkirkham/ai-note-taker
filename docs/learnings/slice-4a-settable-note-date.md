# Slice 4-A — Settable note date

## What we built

`SetNoteDate` command + `NoteDateSet` event. `NoteDetailProjection` extended with nullable `DateOnly? Date`. `PATCH /notes/{noteId}/date` endpoint. Date input in note header (fills from detail, PATCHes on blur, renders DD/MM/YYYY display span).

## Key decisions

**`DateOnly?` (nullable) for both command and event.** The event-model.md originally said clearing was "handled client-side, no event for null". But the acceptance criteria require the clear to persist across navigation, so an event is needed. `NoteDateSet(NoteId, null)` is cleaner than a separate `NoteDateCleared` event and keeps the projection handler simple.

**Default-valued record parameter for `NoteDetailView`.** Adding `DateOnly? Date = null` as the last positional parameter in the record made the change fully backward-compatible — all existing construction sites compile without modification, and the new nullable field is available everywhere.

**`[Fact(Skip = "Pip: ...")]` lets Breaker commit before Pip starts.** Stub type definitions (`SetNoteDate`, `NoteDateSet`) make the specs compile; `Skip` makes the pre-commit hook's `dotnet test` pass. Pip then removes `Skip` and provides the implementation. Clean handoff without breaking the hook.

**Separate `data-testid="note-date-display"` span.** Playwright's `ToHaveTextAsync` reads text content, not input values. Since `<input type="date">` exposes a `value` attribute (not text), the E2E assertion `AssertNoteDateVisibleAsync("21/04/2026")` required a dedicated `<span>` showing the DD/MM/YYYY formatted string.

## What went wrong

**`LastModifiedAt` not updated on `NoteDateSet` in the projection.** The Refactor pass missed this; the BDD and API integration specs don't assert `lastModifiedAt` after setting a date, so the gap survived to Hawk. Fix: add "all modifying events must update `LastModifiedAt`" to the Refactor projection checklist.

**Doc/code divergence carried forward from 3-E.** `event-model.md`, `event-schemas.md`, and `view-schemas.md` still referenced `ActionItemRemoved`/`RemoveActionItem` from the original design, while 3-E had implemented `ActionItemDeleted`/`DeleteActionItem`. This required a pre-Breaker doc-fix pass (~2–3k tokens). 3-E Scribe should have caught and fixed this.

**No feature branch → no GitHub PR.** All commits landed directly on main; `gh pr create` failed because there's no divergent branch. Not a workflow blocker, but means no PR-level review trail for this slice.
