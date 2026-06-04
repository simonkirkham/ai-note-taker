# Phase 16 — Browse meetings by date on the home screen

**Goal:** The home-screen meetings section today only ever shows *today's* meetings — the `GET /calendar/today` endpoint and the Google Calendar client are both hard-wired to "now". This phase makes the section **date-navigable**: previous/next-day buttons, a date picker tucked behind a button, and a heading that reflects the selected day. The interesting work is end-to-end — generalising a "today-only" read path (calendar client → time-window calculation) to an arbitrary day, replacing the misnamed `/calendar/today` route with a date-addressed `GET /calendar/{date}`, and decoupling meeting *reminders* (which must stay anchored to the real today) from what's merely being *browsed*. Builds directly on Phase 9 (calendar integration + meeting notes).

## Summary

| Slice | Summary | Status | Depends on |
|-------|---------|--------|------------|
| 16-A | **See any day's meetings, not just today's.** Prev/next-day buttons + a behind-a-button date picker drive a date-aware meetings list with a day-reflecting heading; reminders stay pinned to the real today | Not Started | — |

> **Note on slice size.** 16-A is a single vertical slice spanning the calendar client, the endpoint contract, and the home-screen UI, because the user value — "browse meetings for a chosen day" — is invisible if delivered in backend-only or frontend-only halves. If the diff proves large, Breaker may sub-split along the natural **generalise-the-read-path** (calendar client + endpoint accept a date) → **date-navigation UI** (controls + heading + reminder decoupling) seam during spec-writing, **without** changing the single user-value definition. The frontend half would then depend on the backend half.

**Learning surface:** generalising a time-bounded external-API read (Google Calendar `Instances`/`Events` windowed by an explicit local day rather than `UtcNow`); a date-addressed REST resource (`/calendar/{date}`) replacing a misnamed action route; the client/server timezone-boundary contract (the client owns "which day" by sending an explicit `date`, the server owns the local-day window in `tz`); and a frontend state split where the **displayed** data (selected day) and a **side-effect source** (today's reminders) are deliberately driven by two different fetches.

---

## Slice 16-A — See any day's meetings, not just today's

**Status:** Not Started

**User value:** On the home screen the user can move the meetings list to any day. **‹ Prev** and **Next ›** step one day at a time; a **calendar button** reveals a date picker to jump straight to a date; and the section heading tells them which day they're looking at — **"Today's Meetings"** for today, **"Tomorrow's Meetings"** / **"Yesterday's Meetings"** for ±1 day, and a formatted date like **"Meetings — Mon, 8 Jun"** for any other day. Browsing is a read-only look-ahead/look-back: creating a note from a meeting works on any day, but **meeting reminders keep firing only for the real today**, regardless of which day is on screen.

**Confirmed product decisions (from Scout brief, 2026-06-04):**
- **Heading:** relative labels for today / ±1 day, otherwise a formatted `EEE, d MMM` date (option A).
- **Reminders:** scheduled for the real current day only; browsing another day never schedules or cancels notifications (option "Today only").
- **Navigation range:** unbounded — both arrows always enabled, the picker accepts any date; whatever Google returns for that day is shown.

### How it works (implementation notes)

A vertical slice across the calendar client, the endpoint, and the home screen.

- **Calendar client — generalise the day window.** `IGoogleCalendarClient.GetTodaysEventsAsync(string ianaTimezone)` becomes `GetEventsForDayAsync(DateOnly date, string ianaTimezone)`. The existing logic in `GoogleCalendarClient` that computes `todayLocal` from `DateTimeOffset.UtcNow` is replaced by building the start/end window from the **passed `date`** in `tz` (`startOfDay = new DateTimeOffset(date.ToDateTime(TimeOnly.MinValue), tz.GetUtcOffset(...))`, `endOfDay = +1 day`). `StubGoogleCalendarClient` updates to honour the date. `GetNextOccurrenceAsync` is unchanged — "next occurrence" of a recurring series stays relative to `UtcNow`, not the browsed day.
- **Endpoint — a date-addressed route.** Replace `GET /calendar/today` with **`GET /calendar/{date}?tz=<iana>`**, where `{date}` is an ISO `YYYY-MM-DD` path segment (ISO, **not** `DD-MM-YYYY` — unambiguous across locales, lexically sortable, and the format `DateOnly.TryParseExact` round-trips cleanly). The frontend computes its own local today and always passes a concrete date, so an endpoint named *today* never serves a non-today day. `CalendarHandlers` parses the segment with `DateOnly.TryParseExact(date, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out _)`; a malformed value returns `400 { error = "invalid_date" }` (mirroring the existing `invalid_timezone` guard). `tz` stays a required query param — the date alone doesn't bound the local day for Google. Existing callers move off `/calendar/today` in this slice: the `web` API client, `tests/Api.Smoke`, and any E2E journey. The handler name `GetTodaysMeetings` is renamed to match. The `hasNextOccurrenceNote`/`nextOccurrenceNoteId` computation is unchanged (still relative to `UtcNow`).
- **API client.** `getTodaysMeetings(tz)` in `web/src/api.ts` becomes `getMeetingsForDate(tz, date: string)`, calling `GET /calendar/{date}?tz=` with an explicit `YYYY-MM-DD`. The home screen always passes a concrete date (its own local today on first load).
- **Home screen — `MeetingsSection.tsx`.** Add `selectedDate` state (default = today in the user's tz). A control row above the list carries **‹** / **›** buttons (step ±1 day) and a **calendar-icon button** that toggles a hidden `<input type="date">`; picking a date sets `selectedDate` and closes the picker. The data fetch keys off `selectedDate` (effect dependency) with the existing loading / unavailable / empty states per day (empty-state copy generalised away from "No meetings **today**"). The visible `<h2>` is computed from `selectedDate` (see heading rules); the `<section aria-label>` becomes a stable "Meetings" so the landmark name doesn't churn on navigation.
- **Reminders stay on today (the key decoupling).** `useMeetingReminders` must be fed **today's** meetings, never the browsed day's. The component keeps a *separate* `todaysMeetings` fetch (today, on mount) that feeds the hook, independent of the date-driven displayed list. When `selectedDate` is today, the displayed list reuses that same data instead of issuing a duplicate request. Browsing to another day changes only the displayed list; today's scheduled reminders are untouched.

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

- [ ] `IGoogleCalendarClient.GetEventsForDayAsync(DateOnly date, string tz)` replaces `GetTodaysEventsAsync`; window computed from the passed date in `tz`, not `UtcNow`; `StubGoogleCalendarClient` honours the date; `GetNextOccurrenceAsync` unchanged
- [ ] `GET /calendar/{date}?tz=` (ISO `YYYY-MM-DD` path segment) replaces `/calendar/today`; malformed date ⇒ `400 { error = "invalid_date" }`; missing/invalid `tz` guard preserved; all callers (`web` API client, `Api.Smoke`, E2E) moved over; handler renamed; `hasNextOccurrenceNote`/`nextOccurrenceNoteId` still relative to `UtcNow`
- [ ] `web/src/api.ts` exposes `getMeetingsForDate(tz, date)` hitting `/calendar/{date}?tz=`; the home screen always passes a concrete `YYYY-MM-DD`
- [ ] `MeetingsSection` has prev/next-day buttons and a date picker hidden behind a button; selecting a date refetches and closes the picker; navigation is unbounded (both arrows always enabled)
- [ ] Heading: `Today's Meetings` (today) / `Tomorrow's Meetings` (+1) / `Yesterday's Meetings` (−1) / `Meetings — {EEE, d MMM}` (otherwise); empty-state copy no longer says "today"; section landmark `aria-label` is stable
- [ ] `useMeetingReminders` is fed a dedicated **today** fetch, never the browsed day; browsing never schedules/cancels reminders for other days; when the selected day is today the displayed list reuses the today fetch (no duplicate request)
- [ ] Optimistic note-creation from a browsed-day meeting works as it does for today (per the optimistic-UI convention)
- [ ] `Api.Integration` test covers the date param (explicit date, default-to-today, `invalid_date`); component tests cover prev/next, picker toggle + selection, all four heading variants, the empty state, and reminders-stay-on-today; existing meetings/calendar specs updated for the renamed client method; the kept calendar E2E journey green; `cdk synth` succeeds

---

## Out of scope (explicitly deferred)

- **A multi-day / week / agenda view.** This slice is single-day navigation only; a week grid or infinite-scroll agenda is a separate future feature.
- **Pre-fetching adjacent days.** Each day is fetched on demand; no look-ahead caching of neighbouring days (could become a perf follow-up if Google latency proves annoying).
- **A query-param date on the old route (`/calendar/today?date=`).** Considered and declined — an endpoint named *today* serving another day is a contract lie; this slice replaces it with the date-addressed `/calendar/{date}` instead.
- **Reminders for non-today days.** By decision, reminders only ever track the real current day; "remind me about a meeting three days out from the browse view" is not a goal.
- **Persisting the selected day** across reloads/navigation. Opening the home screen always resets to today.

---

## Observability

This slice adds a date-parameterised read path and a frontend state split; both have quiet failure modes worth guarding.

1. **Reminders silently following the browsed day.** The highest-risk regression: if `useMeetingReminders` is accidentally wired to the displayed (browsed) list instead of the today fetch, the user could **miss a real reminder** (while parked on another day) or get **spurious reminders** for past/far-future meetings — with no error anywhere. This is a frontend timing bug that telemetry won't catch; the guard is an explicit **component test** asserting the reminder source is the today fetch and is unaffected by navigation (listed in acceptance criteria), not a metric.
2. **Empty vs unavailable for a far date.** Navigating to a date Google has no events for returns an empty list, which must stay visually distinct from "cannot connect to calendar" (the existing `error` vs empty split already does this — keep it intact when generalising the empty-state copy).
3. **Timezone/midnight boundary.** The client computes its own local today and always sends an explicit `date`; the server bounds that day's window from `tz`. So "which day" has one owner (the client) and the window calculation has one owner (the server) — they can't disagree near midnight. Worth logging the resolved local-day window on the calendar fetch (the existing retry-logging surface) so an off-by-one-day window is diagnosable.
4. **`invalid_date` rejections.** Low volume, but log the rejected value at debug so a frontend date-format drift (e.g. locale-formatted instead of `YYYY-MM-DD`) is visible rather than silently returning 400s.

No standalone instrumentation slice — fold the resolved-window log and the `invalid_date` debug log into 16-A's backend work, and the reminder-source assertion into its component tests. Run the `observability-brief` skill output into the acceptance criteria when Breaker drafts the spec.
