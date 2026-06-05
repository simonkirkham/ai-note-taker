# Phase 16 — Browse meetings by date on the home screen

**Goal:** The home-screen meetings section today only ever shows *today's* meetings — the `GET /calendar/today` endpoint and the Google Calendar client are both hard-wired to "now". This phase makes the section **date-navigable**: previous/next-day buttons, a date picker tucked behind a button, and a heading that reflects the selected day. The interesting work is end-to-end — generalising a "today-only" read path (calendar client → time-window calculation) to an arbitrary day, replacing the misnamed `/calendar/today` route with a date-addressed `GET /calendar/{date}`, and decoupling meeting *reminders* (which must stay anchored to the real today) from what's merely being *browsed*. Builds directly on Phase 9 (calendar integration + meeting notes).

## Summary

| Slice | Summary | Status | Depends on |
|-------|---------|--------|------------|
| 16-A | **See any day's meetings, not just today's.** Prev/next-day buttons + a behind-a-button date picker drive a date-aware meetings list with a day-reflecting heading; reminders stay pinned to the real today | Done | — |

---

## Slice 16-A — See any day's meetings, not just today's

**Status:** Done

### Scenarios

```
Scenario: The meetings section opens on today
  Given I am on the home screen
  Then  the meetings list shows today's meetings
  And   the heading reads "Today's Meetings"

Scenario: Stepping forward a day
  Given the meetings section is showing today
  When  I click the next-day button
  Then  the list shows the following day's meetings
  And   the heading reads "Tomorrow's Meetings"

Scenario: Stepping back a day
  Given the meetings section is showing today
  When  I click the previous-day button
  Then  the list shows the previous day's meetings
  And   the heading reads "Yesterday's Meetings"

Scenario: A day more than one away shows the formatted date
  Given the meetings section is showing today
  When  I step forward more than one day
  Then  the heading reads "Meetings — " followed by the weekday and date of the selected day

Scenario: The date picker is hidden behind a button
  Given the meetings section
  Then  no date input is visible until I click the calendar button
  When  I click the calendar button and pick a date
  Then  the list and heading update to that date and the picker closes

Scenario: Reminders stay anchored to the real today while browsing
  Given today has a meeting that should trigger a reminder
  When  I browse to a different day
  Then  the displayed list changes to that day
  And   the reminder for today's meeting is still scheduled (browsing never schedules or cancels reminders for other days)

Scenario: Creating a note works on a browsed day
  Given I have navigated to another day with a meeting
  When  I create a note from that meeting
  Then  the note is created and dated to that meeting's day, exactly as for today

Scenario: A selected day with no meetings shows an empty state, not an error
  Given a day with no meetings
  When  it is selected
  Then  an empty "no meetings" state is shown, distinct from the "cannot connect to calendar" state

Scenario: The endpoint returns meetings for the date in the path
  Given the calendar has events on a given date
  When  GET /calendar/{date} is called with that ISO date and a tz
  Then  it returns that day's events ordered by start time

Scenario: A malformed date in the path is rejected
  When  GET /calendar/{date} is called with a non-ISO-date segment
  Then  it returns 400 with error "invalid_date"

Scenario: A missing timezone is rejected
  When  GET /calendar/{date} is called without a tz
  Then  it returns 400 (tz remains required, unchanged)
```

### Acceptance criteria

- [x] `IGoogleCalendarClient.GetEventsForDayAsync(DateOnly date, string tz)` replaces `GetTodaysEventsAsync`; window computed from the passed date in `tz`, not `UtcNow`; `StubGoogleCalendarClient` honours the date; `GetNextOccurrenceAsync` unchanged
- [x] `GET /calendar/{date}?tz=` (ISO `YYYY-MM-DD` path segment) replaces `/calendar/today`; malformed date ⇒ `400 { error = "invalid_date" }`; missing/invalid `tz` guard preserved; all callers (`web` API client, `Api.Smoke`, E2E) moved over; handler renamed; `hasNextOccurrenceNote`/`nextOccurrenceNoteId` still relative to `UtcNow`
- [x] `web/src/api.ts` exposes `getMeetingsForDate(tz, date)` hitting `/calendar/{date}?tz=`; the home screen always passes a concrete `YYYY-MM-DD`
- [x] `MeetingsSection` has prev/next-day buttons and a date picker hidden behind a button; selecting a date refetches and closes the picker; navigation is unbounded (both arrows always enabled)
- [x] Heading: `Today's Meetings` (today) / `Tomorrow's Meetings` (+1) / `Yesterday's Meetings` (−1) / `Meetings — {EEE, d MMM}` (otherwise); empty-state copy no longer says "today"; section landmark `aria-label` is stable
- [x] `useMeetingReminders` is fed a dedicated **today** fetch, never the browsed day; browsing never schedules/cancels reminders for other days; when the selected day is today the displayed list reuses the today fetch (no duplicate request)
- [x] Optimistic note-creation from a browsed-day meeting works as it does for today (per the optimistic-UI convention)
- [x] `Api.Integration` test covers the date param (explicit date, default-to-today, `invalid_date`); component tests cover prev/next, picker toggle + selection, all four heading variants, the empty state, and reminders-stay-on-today; existing meetings/calendar specs updated for the renamed client method; the kept calendar E2E journey green; `cdk synth` succeeds

---
