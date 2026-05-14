---
name: Phase 5-M — Note date defaults to today
type: project
date: 2026-05-14
---
# Slice 5-M — Note date defaults to today

## What we built

When a user creates a new note, the app automatically calls `PATCH /notes/{noteId}/date` with today's ISO date (`YYYY-MM-DD`) immediately after the note is created and before navigating to the note screen. The redundant formatted date label (`note-date-display` span and `formatDateDisplay` helper) was removed; the native `<input type="date">` renders the selected value without an additional text label.

## Key learnings

- **Sequencing matters for optimistic UX.** The date PATCH must await before `setView` so the NoteView's `useEffect` fetch sees the date already stored — otherwise the detail fetch races the PATCH and may return the note with no date set. Wrapping the PATCH in its own try/catch makes it non-fatal without swallowing the outer create error.
- **Removing a `data-testid` breaks existing E2E tests.** Deleting `note-date-display` invalidated the `AssertNoteDateVisibleAsync` assertion in `NoteDateJourney`. When removing a UI element, always grep test files for that testid and update affected journeys in the same commit.
- **Obsolete "default empty" tests must be replaced, not just deleted.** `New_note_has_no_date_by_default` became the new `New_note_defaults_to_today` — a direct replacement that documents the new contract rather than leaving a gap in coverage.
