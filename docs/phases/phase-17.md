# Phase 17 — Link an existing note to a meeting after the fact

**Goal:** Today linkage only flows one way and only at creation time — a meeting on the home screen can *spawn* a note (`Create Note` → `NoteLinkedToCalendarEvent`), but a note that already exists as a standalone cannot be attached to a meeting later. The backend already supports the reverse: the `LinkNoteToCalendarEvent` command, the `POST /notes/{noteId}/calendar-link` endpoint, and the `CalendarLinkIndex` projection all exist and work; **no frontend calls them**. This phase closes that loop. From an open note the user picks a meeting (reusing Phase 16's date-navigable day list) and links it; the note then persistently shows which meeting it belongs to. The note-side display needs a small backend extension — the `CalendarLinkView` projection stores the event ID, series ID and start time but **not the meeting title or end time**, and `GetNote` returns only `recurringSeriesId`/`isRecurring`. The `NoteLinkedToCalendarEvent` event already carries title and end time, so this is a projection-schema extension plus a rebuild (no event versioning), and the rebuild backfills every existing meeting-created note with a visible link badge. Builds on Phase 9 (linkage model) and Phase 16 (date-navigable meeting list).

## Summary

| Slice | Summary | Status | Depends on |
|-------|---------|--------|------------|
| 17-A | **See a note's linked meeting.** `CalendarLinkView` gains `CalendarEventTitle` + `EndTime` (both already on the event); `GetNote` returns a `linkedMeeting` object; the note renders a persistent `Linked to <title> · <date/time>` badge; a projection rebuild backfills every existing meeting-created note. No new user action — independently shippable. | Not Started | — |
| 17-B | **Link an open note to a meeting.** An unlinked note offers a **Link to meeting** control that opens a date-navigable meeting picker (reusing Phase 16's day list); choosing a meeting POSTs `/notes/{id}/calendar-link`; the badge appears optimistically. The control is hidden once linked. | Not Started | 17-A |

**Confirmed product decisions (from Scout brief, 2026-06-05):**
- **Entry point:** from the note (a control on the open `NoteView`), not from the meeting card.
- **Meeting set:** a date picker + day list — reuse Phase 16's day-navigation pattern (`getMeetingsForDate(tz, date)`); not search.
- **Cardinality:** link-once only. No unlink, no relink. The backend already rejects a second link with `409`; the UI must hide/disable the action once linked.
- **Note display:** the note persistently shows which meeting it is linked to (survives reload), which is why the projection + `GetNote` extension is in scope.

> **Slice order.** 17-A ships first and stands alone: extending and rebuilding the projection makes every *existing* meeting-created note show its meeting, with no new user action. 17-B then adds the "link after the fact" action and depends on 17-A for the persistent badge and the `linkedMeeting` contract. Prototype skipped — the picker is a modal reuse of Phase 16's day-navigation pattern, not novel UX.

**Learning surface:** extending a read projection's schema and rebuilding it to backfill from already-persisted events (the event carried the data all along — only the projection under-captured it); reusing an existing, never-called command/endpoint/projection from the frontend (the backend was built ahead of the UI in Phase 9); a one-shot mutation guarded server-side by a domain pre-condition (`_calendarEventId is not null` → `409`) and mirrored client-side by hiding the action; reusing a date-navigation UI pattern (Phase 16) inside a modal picker rather than a page section.

---

## Slice 17-A — See a note's linked meeting

**Status:** Not Started

**User value:** A note that belongs to a meeting visibly says so. Opening a note that is linked to a calendar event shows **Linked to \<meeting title\> · \<date, time\>**, and it survives reload. This lights up immediately for every note already created from a meeting — the link data was always in the event stream, just never surfaced on the note.

### Backend — capture and return the link

`CalendarLinkView` gains two fields, both already present on `NoteLinkedToCalendarEvent`:

| Field | Source |
|-------|--------|
| `CalendarEventTitle` (string) | `e.CalendarEventTitle` |
| `EndTime` (`DateTimeOffset`) | `e.EndTime` |

- The inline projection write in `NoteCommandHandler.UpdateCalendarLinkIndexForNewEventsAsync` maps the two new fields.
- `DynamoDbCalendarLinkIndexStore` read/write mapping carries the new attributes.
- `GetNote` returns a `linkedMeeting` object — `{ calendarEventId, title, startTime, endTime, recurringSeriesId, isRecurring }` — or `null` when unlinked (replacing the current bare `recurringSeriesId`/`isRecurring` pair; keep those derivable from `linkedMeeting` for the existing "Next occurrence" button).
- **Projection rebuild** runs on deploy to backfill `CalendarEventTitle`/`EndTime` for every existing linked note.

### Scenarios (Given/When/Then)

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

## Slice 17-B — Link an open note to a meeting

**Status:** Not Started

**Depends on:** 17-A (persistent badge + `linkedMeeting` contract).

**User value:** While looking at a note created on its own, the user can attach it to a meeting they actually had. A **Link to meeting** control opens a picker showing a day's meetings (with **‹ Prev** / **Next ›** and a date-picker jump, exactly like the home meetings list); picking one links the note. The badge from 17-A appears at once, and the meeting card on the home screen flips to **Open Note ↗** — the link is bidirectional. A note already linked does not offer the control.

### Scenarios (Given/When/Then)

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

## Observability

Silent failure modes specific to this slice and what must be visible in production:

| Slice | Failure mode | Why it's silent | Instrumentation |
|-------|--------------|-----------------|-----------------|
| 17-A | Projection rebuild not run / partial after deploy | Existing notes silently keep showing no badge; looks like data loss | Rebuild is an explicit deploy step; log rebuilt-record count for `CalendarLinkIndex` |
| 17-A | Inline projection write drops the new fields | Title/end-time silently null on new links; badge renders blank | Assert the two new attributes are written (integration test); log on null title at write time |
| 17-B | Link POST returns `409` (re-link / race) | Frontend may swallow it as a generic error; user thinks the link silently failed | Log the `calendar-link` outcome with `noteId` + `calendarEventId` + result (`linked` / `conflict` / `not-found`); count conflicts as a metric |
| 17-B | User links a meeting already owned by another note | Without the picker guard, surfaces only as a `409` after submit | Picker disables already-linked meetings up front; the `409` path is the backstop, logged as above |
| 17-B | Calendar fetch failure in the picker | Renders as "no meetings" → user assumes the day is empty and can't link | Distinguish `unavailable` from `empty` in the picker state (mirror `MeetingsSection`'s `unavailable` branch) |

No new dashboard or alarm proposed; the existing calendar/note request instrumentation plus the per-outcome log on `calendar-link` covers this slice. Flag for the implementer: confirm `POST /notes/{id}/calendar-link` currently emits a structured outcome log — if not, add one in this slice.
