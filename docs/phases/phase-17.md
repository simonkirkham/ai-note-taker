# Phase 17 — Link an existing note to a meeting after the fact

**Goal:** Today linkage only flows one way and only at creation time — a meeting on the home screen can *spawn* a note (`Create Note` → `NoteLinkedToCalendarEvent`), but a note that already exists as a standalone cannot be attached to a meeting later. The backend already supports the reverse: the `LinkNoteToCalendarEvent` command, the `POST /notes/{noteId}/calendar-link` endpoint, and the `CalendarLinkIndex` projection all exist and work; **no frontend calls them**. This phase closes that loop. From an open note the user picks a meeting (reusing Phase 16's date-navigable day list) and links it; the note then persistently shows which meeting it belongs to. The note-side display needs a small backend extension — the `CalendarLinkView` projection stores the event ID, series ID and start time but **not the meeting title or end time**, and `GetNote` returns only `recurringSeriesId`/`isRecurring`. The `NoteLinkedToCalendarEvent` event already carries title and end time, so this is a projection-schema extension plus a rebuild (no event versioning), and the rebuild backfills every existing meeting-created note with a visible link badge. Builds on Phase 9 (linkage model) and Phase 16 (date-navigable meeting list).

## Summary

| Slice | Summary | Status | Depends on |
|-------|---------|--------|------------|
| 17-A | **See a note's linked meeting.** `CalendarLinkView` gains `CalendarEventTitle` + `EndTime` (both already on the event); `GetNote` returns a `linkedMeeting` object; the note renders a persistent `Linked to <title> · <date/time>` badge; a projection rebuild backfills every existing meeting-created note. No new user action — independently shippable. | Done | — |
| 17-B | **Link an open note to a meeting.** An unlinked note offers a **Link to meeting** control that opens a date-navigable meeting picker (reusing Phase 16's day list); choosing a meeting POSTs `/notes/{id}/calendar-link`; the badge appears optimistically. The control is hidden once linked. | Done | 17-A |

---

## Slice 17-A — See a note's linked meeting

**Status:** Done

### Scenarios

**Linked note shows its meeting**
- Given a note linked to a calendar event
- When the user opens it
- Then the note shows `Linked to <title> · <date/time>` sourced from `GetNote.linkedMeeting`

**Unlinked note shows no meeting badge**
- Given a note not linked to any calendar event
- When the user opens it
- Then `GetNote.linkedMeeting` is `null` and no badge is shown

**Existing meeting-created note shows its meeting after rebuild**
- Given a note created from a meeting before this slice (link has no stored title)
- When the projection is rebuilt and the note is opened
- Then it shows `Linked to <title> · <date/time>` backfilled from the event

**Recurring linkage keeps the "Next occurrence" affordance**
- Given a note linked to a recurring meeting
- When the user opens it
- Then both the linked-meeting badge and the existing "Next occurrence →" control are shown (derived from `linkedMeeting.recurringSeriesId`)

### Acceptance criteria

1. `CalendarLinkView` stores `CalendarEventTitle` + `EndTime`; the inline write maps both; integration test asserts the attributes are written.
2. `GetNote` returns a `linkedMeeting` object (or `null`); the existing `recurringSeriesId`/`isRecurring` behaviour is preserved (derived from it).
3. A linked note renders a persistent `Linked to <title> · <date/time>` badge that survives reload.
4. The projection rebuild backfills `CalendarEventTitle`/`EndTime` for every existing linked note; `cdk synth` green.

---

## Slice 17-B — Link an open note to a meeting

**Status:** Done

### Scenarios

**Link an unlinked note to a meeting**
- Given a note that is not linked to any calendar event
- When the user opens the meeting picker, navigates to a day, and selects a meeting
- Then `LinkNoteToCalendarEvent` is issued, `NoteLinkedToCalendarEvent` is appended, and the badge appears immediately (optimistic) and after reload

**Already-linked note offers no link control**
- Given a note already linked to a calendar event
- When the user opens it
- Then no "Link to meeting" control is shown (the badge is shown instead)

**Re-link attempt is rejected**
- Given a note already linked to a calendar event
- When a `LinkNoteToCalendarEvent` command reaches the handler for that note
- Then it throws and the endpoint returns `409 Conflict`

**Picker offers a meeting already linked to another note**
- Given a meeting in the picked day is already linked to a different note (`linkedNoteId` set)
- When the user views that day in the picker
- Then that meeting is shown as already-linked (disabled / labelled), not selectable

**Calendar unavailable while picking**
- Given the calendar fetch for the picked day fails
- When the user opens/navigates the picker
- Then an "unavailable / retry" state is shown, not an empty "no meetings" list

### Acceptance criteria

1. From an unlinked note, the user can open a date-navigable meeting picker and link the note to a meeting.
2. The link is applied **optimistically** — the badge appears before the API responds; reconciled/reverted on error (optimistic-UI guardrail).
3. A note already linked shows no link control; the action is unavailable, not merely erroring on submit.
4. A meeting already linked to another note is non-selectable in the picker.
5. A failed calendar fetch in the picker shows a retry/unavailable state, never a false "no meetings".
6. The picker reuses Phase 16's day-navigation semantics (client owns "which day" via `tz` + ISO date).
7. `LinkNoteToCalendarRequest` carries no fields the handler does not read (contract-honesty guardrail).
