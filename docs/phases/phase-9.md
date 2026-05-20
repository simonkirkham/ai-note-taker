# Phase 9 — Google Calendar Integration + Meeting Notes

**Goal:** Surface today's Google Calendar meetings on the home screen so meeting notes can be created with one click, linked to the calendar event, and reminded at meeting time. Recurring meetings support one-click creation of a note for the next scheduled occurrence.

**Learning surface:** Outbound HTTP from Lambda (first time); Google OAuth2 refresh-token flow for Calendar access; SSM Parameter Store for secrets; extending an existing aggregate with a new event (`NoteLinkedToCalendarEvent`) without touching the immutable `NoteCreated`; a new read projection (`CalendarLinkIndex`) keyed by an external ID; browser Notifications API + `setTimeout` for client-side reminders.

---

## Prototype status

A UX prototype **must be built and approved before any backend work begins.** The prototype lives on branch `prototype/9-meetings` and is never merged. On approval, this doc is updated with confirmed GWT scenarios and UX patterns; real implementation starts fresh.

See slice 9-A for the prototype brief.

---

## What is already in place

- `EventMetadata.UserId` is populated from the authenticated user's `sub` claim (Phase 8). The Google account identity is already known at the API layer — no `GOOGLE_ACCOUNT_ID` env var needed.
- `ICurrentUser` is injectable; `Api.Integration` tests use `FakeCurrentUser` with a fixed test user ID.
- `NoteCommandHandler` already follows load-stream → rebuild → handle → persist → update-projection. The new `LinkNoteToCalendarEvent` command fits this pattern exactly.
- All five test layers are in place. `IGoogleCalendarClient` must be an injectable interface from day one so `Api.Integration` tests run without real Google credentials.
- The home screen (`ListView.tsx`) renders `<TodoSection />` and a grid of `<NoteCard>`. Adding `<MeetingsSection />` is an additive change.
- Google Sign-In is in place; the authenticated user's email is available — it can be used as the Google account identity for the Calendar API refresh token lookup if needed.

What is **not** yet in place:

- No outbound HTTP from Lambda; no Google client library; no SSM usage; no `HttpClient` registration.
- No `NoteLinkedToCalendarEvent` event or `LinkNoteToCalendarEvent` command.
- No `CalendarLinkIndex` projection or DynamoDB table.
- No `GET /calendar/today` endpoint.
- No `<MeetingsSection />` component.
- No browser notification wiring.

**Out-of-band prerequisite (not a slice):** Create a GCP project, enable the Calendar API, create OAuth2 client credentials, and run the one-time authorisation flow to obtain a refresh token for `calendar.readonly` scope. Store the refresh token in AWS SSM Parameter Store as a `SecureString` at the path configured in `GOOGLE_REFRESH_TOKEN_SSM_PATH`. This must be done before 9-B can be deployed.

---

## Slice order and dependencies

```
9-A  UX prototype ─── human approval required ────────────────────────────────────────┐
                                                                                       │
9-G  CDK wiring ──────────────────────────────────────────────────────────────────┐   │
     (SSM grant, Google env vars, CalendarLinkIndex table + GSI)                  │   │
     can run in parallel with 9-B and 9-C                                         │   │
                                                                                  │   ▼
9-B  Google Calendar pass-through ─────────────────────────────────────────────────────┤
     GET /calendar/today, OAuth, MeetingsSection UI (linkedNoteId always null here)    │
        │                                                                              │
        ├──→ 9-C  NoteLinkedToCalendarEvent + CalendarLinkIndex projection ────────────┤
        │           │                                                                  │
        │           └──→ 9-D  One-click create note from a meeting ───────────────────┤
        │                       │                                                      │
        │                       └──→ 9-F  Recurring: note for next occurrence ─────────┘
        │
        └──→ 9-E  Meeting-time browser reminder  (no backend changes; independent of C/D/F)
```

Each slice is a complete vertical: domain, API, projections, and frontend wired together.

---

## Slice 9-A — UX prototype

**Status:** Done — prototype approved. See `web/src/prototype/REFERENCE.md` on branch `prototype/9-meetings`.

**Prototype branch:** `prototype/9-meetings` (never merged)

---

### Confirmed UX patterns

**Layout:** Home screen gains a right panel (320px). Left column holds tag filter + note cards. Right panel holds `<MeetingsSection />` (top) and `<TodoSection />` (bottom). Right panel is hidden when navigating into a folder. `<TodoSection />` moves out of the main flow entirely.

**Notification banner (N1):** Full-width blue bar above the entire app shell — outside `app-layout`, spanning sidebar + main + panel. Shown only when `Notification.permission === 'default'`. Contains "Enable" button (triggers `requestPermission()`) and "✕" dismiss.

**Meeting card (Style 3):** Bordered card per meeting. Title prominent top-left. Time badge top-right (muted, small). One or two action rows in the footer.

**Action rows (R2):** Non-recurring meetings: single "Today" row with one action button. Recurring meetings: two rows separated by a hairline — "Today" on row 1, "↻ Next · [date]" on row 2. Next row hidden for non-recurring or when `nextOccurrenceDate` is null.

**Button states:**
- `linkedNoteId === null` → primary "Create Note" (optimistically flips to "Open Note ↗" on click)
- `linkedNoteId !== null` → "Open Note ↗" (navigates to note)
- `hasNextOccurrenceNote === false` → "Create Note" on next row
- `hasNextOccurrenceNote === true` → "Open Note ↗" on next row

**Error state (E1):** Muted centred column — faint calendar icon + "Cannot connect to calendar" + small "Retry" link. No red/amber — intentionally low noise.

**Empty state (M1):** Centred column — faint calendar icon + "No meetings today".

---

### Given/When/Then scenarios (confirmed by prototype)

```
Scenario: Meetings panel appears to the right of the note grid on Home
  Given I am on the home screen
  When  the page loads
  Then  a right panel appears beside the note card grid
  And   the panel contains a "Today's Meetings" section above "To Do"
  And   the note card grid fills the remaining width

Scenario: Meetings panel is hidden inside a folder
  Given I have navigated into a folder
  When  I view the folder contents
  Then  the right panel is not visible
  And   the note card grid fills the full main area

Scenario: Meeting card shows title, time, and Create Note button
  Given today's meetings include "1:1 with Sam" at 09:00–09:30
  And   that meeting has no linked note
  When  I view the home screen
  Then  a card shows the title "1:1 with Sam" and time "09:00–09:30"
  And   a "Create Note" button appears in the card footer

Scenario: Meeting card with a linked note shows Open Note
  Given a meeting has a linked note
  When  I view the home screen
  Then  the meeting card shows "Open Note ↗" instead of "Create Note"

Scenario: Clicking Create Note optimistically updates the card
  Given a meeting has no linked note
  When  I click "Create Note"
  Then  the button immediately changes to "Open Note ↗" without waiting for the API

Scenario: Recurring meeting shows a next-occurrence row
  Given a recurring meeting "Design Review" with nextOccurrenceDate "Tue 27 May"
  And   hasNextOccurrenceNote is false
  When  I view the home screen
  Then  the card footer has two rows separated by a hairline
  And   row 1 shows "Today" with a "Create Note" button
  And   row 2 shows "↻ Next · Tue 27 May" with a "Create Note" button

Scenario: Recurring meeting with both notes shows Open Note on both rows
  Given a recurring meeting where linkedNoteId is set and hasNextOccurrenceNote is true
  When  I view the home screen
  Then  row 1 shows "Open Note ↗"
  And   row 2 shows "Open Note ↗"

Scenario: Non-recurring meeting has no next-occurrence row
  Given a non-recurring meeting
  When  I view the home screen
  Then  the card footer has only one row with no hairline separator

Scenario: Calendar unavailable shows muted error state
  Given the calendar API returns an error
  When  I view the home screen
  Then  the meetings section shows a faint calendar icon and "Cannot connect to calendar"
  And   a small "Retry" link is visible
  And   the rest of the home screen loads normally

Scenario: No meetings today shows empty state
  Given today's meetings list is empty
  When  I view the home screen
  Then  the meetings section shows a faint calendar icon and "No meetings today"
  And   the To Do section below is unaffected

Scenario: Notification permission banner shown when permission is default
  Given the browser notification permission is "default"
  When  I open the home screen
  Then  a full-width blue bar appears above the app header
  And   it contains an "Enable" button and a "✕" dismiss button

Scenario: Banner disappears after clicking Enable
  Given the notification banner is visible
  When  I click "Enable"
  Then  the browser permission prompt fires
  And   the banner is dismissed regardless of the user's permission choice

Scenario: Banner disappears after clicking dismiss
  Given the notification banner is visible
  When  I click "✕"
  Then  the banner disappears without requesting notification permission

Scenario: Banner is not shown when permission is already granted or denied
  Given the browser notification permission is "granted" or "denied"
  When  I open the home screen
  Then  no notification banner is shown
```

---

## Slice 9-B — Google Calendar API pass-through

**Status:** Done

**Value:** Today's meetings appear on the home screen, fetched live from Google Calendar. `linkedNoteId` is always `null` in this slice — the link index comes in 9-C.

**Commands in scope:** none
**Events in scope:** none

**New service:**

```csharp
// src/Api/Services/IGoogleCalendarClient.cs
public interface IGoogleCalendarClient
{
    Task<IReadOnlyList<CalendarEvent>> GetTodaysEventsAsync(string ianaTimezone);
}

public record CalendarEvent(
    string CalendarEventId,
    string Title,
    DateTimeOffset StartTime,
    DateTimeOffset EndTime,
    bool IsRecurring,
    string? RecurringSeriesId
);
```

The production implementation (`GoogleCalendarClient`) reads `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REFRESH_TOKEN_SSM_PATH` env vars; reads the SSM `SecureString` on cold start; uses `Google.Apis.Calendar.v3` with `singleEvents=true`, `orderBy=startTime`. The SSM read is cached in a static field for the Lambda process lifetime.

On any Google API failure: log the exception and return a `CalendarUnavailable` sentinel. The endpoint returns `{ "error": "calendar_unavailable" }` with HTTP 200 so the frontend can render the error message without treating it as a network failure.

**API endpoint:**

- `GET /calendar/today?tz={ianaTimezone}` — required param; returns 400 if missing. Requires authentication (401 if no valid token).

Wire shape:
```json
{
  "meetings": [
    {
      "calendarEventId": "abc123_20260514T090000Z",
      "title": "1:1 with Bill",
      "startTime": "2026-05-14T09:00:00Z",
      "endTime": "2026-05-14T09:30:00Z",
      "isRecurring": true,
      "recurringSeriesId": "abc123",
      "linkedNoteId": null,
      "hasNextOccurrenceNote": false
    }
  ]
}
```

Or on failure:
```json
{ "error": "calendar_unavailable" }
```

**Key implementation files:**

- `src/Api/Services/IGoogleCalendarClient.cs` — new interface + `CalendarEvent` record
- `src/Api/Services/GoogleCalendarClient.cs` — new: SSM read + `Google.Apis.Calendar.v3` integration
- `src/Api/Builder.cs` — register `IGoogleCalendarClient` in DI
- `src/Api/Handlers/CalendarHandlers.cs` — new: `GetTodaysMeetings` handler
- `src/Api/Endpoints/CalendarEndpoints.cs` — new: register `GET /calendar/today`
- `tests/Api.Integration/FakeGoogleCalendarClient.cs` — new: in-memory `IGoogleCalendarClient`
- `tests/Api.Integration/` — test: correct shape returned; 400 on missing `tz`; `calendar_unavailable` when fake throws
- `web/src/components/MeetingsSection.tsx` — new: fetches `getTodaysMeetings(tz)` on mount; renders meeting cards (prototype-confirmed layout); shows error state; shows empty state
- `web/src/api.ts` — add `getTodaysMeetings(tz: string)`, `CalendarMeeting` interface
- `web/src/components/ListView.tsx` — include `<MeetingsSection />` at prototype-confirmed position

**Scenarios:**

```
Scenario: Today's meetings appear on the home screen
  Given my Google Calendar has two meetings today at 09:00 and 14:00
  When  I open the home screen
  Then  both meetings are shown with their titles and times

Scenario: Meetings are ordered by start time
  Given I have a 14:00 meeting and a 09:00 meeting today
  When  I view the home screen
  Then  the 09:00 meeting appears above the 14:00 meeting

Scenario: A meeting outside today is not shown
  Given I have a meeting scheduled for tomorrow
  When  I view the home screen
  Then  that meeting does not appear in the meetings section

Scenario: Today is relative to the user's local timezone
  Given I am in UTC+1 and it is 23:30 local time (22:30 UTC)
  When  the frontend calls GET /calendar/today?tz=Europe/London
  Then  meetings up to midnight London time are included, not midnight UTC

Scenario: When Google Calendar is unreachable the section shows a friendly message
  Given the Google Calendar API cannot be reached
  When  I open the home screen
  Then  the meetings section shows "Cannot connect to calendar"
  And   the rest of the home screen loads normally

Scenario: When there are no meetings today an empty state is shown
  Given my Google Calendar has no events today
  When  I view the home screen
  Then  the meetings section shows an appropriate empty state

Scenario: GET /calendar/today without tz returns 400
  When  GET /calendar/today is called with no tz query parameter
  Then  400 Bad Request is returned
```

**Acceptance criteria:**

- [x] `IGoogleCalendarClient` is injectable; `FakeGoogleCalendarClient` used in all tests
- [x] `GET /calendar/today?tz=Europe/London` returns today's meetings in start-time order
- [x] `GET /calendar/today` without `tz` returns 400
- [x] `GET /calendar/today` when Google is unreachable returns `{ "error": "calendar_unavailable" }` with 200
- [x] All meetings have `linkedNoteId: null` and `hasNextOccurrenceNote: false` in this slice
- [x] `<MeetingsSection />` renders meetings, empty state, and error state correctly

---

## Slice 9-C — NoteLinkedToCalendarEvent event + CalendarLinkIndex projection

**Status:** Done

**Value:** A note can be associated with a calendar event in the domain. `GET /calendar/today` starts returning `linkedNoteId` for meetings that have a note. The domain event carries all calendar metadata so the note is self-contained in the event stream even if the calendar event is later deleted or rescheduled.

**Commands in scope:**

- `LinkNoteToCalendarEvent(NoteId, CalendarEventId, CalendarEventTitle, StartTime, EndTime, IsRecurring, RecurringSeriesId?)` — note must exist and not be deleted; note must not already be linked to a calendar event

**Events in scope:**

- `NoteLinkedToCalendarEvent { NoteId, CalendarEventId, CalendarEventTitle, StartTime, EndTime, IsRecurring, RecurringSeriesId? }`

**Projections in scope:**

`CalendarLinkIndex` — keyed by `CalendarEventId → NoteId`. Updated by:
- `NoteLinkedToCalendarEvent` → put row `(CalendarEventId, NoteId, RecurringSeriesId?, StartTime)`
- `NoteDeleted` → delete row where `NoteId = …`

Storage: table `notetaker-proj-calendarlinkindex` (PK: `CalendarEventId`; GSI: `RecurringSeriesId-index`, PK: `RecurringSeriesId` — needed in 9-F).

**API endpoint:**

- `POST /notes/{noteId}/calendar-link` — body matches the command fields; returns 204; 404 if note not found; 409 if note is deleted or already linked

**GET /calendar/today update:** The `GetTodaysMeetings` handler now batch-queries `CalendarLinkIndex` for each `calendarEventId` and populates `linkedNoteId`.

**Key implementation files:**

- `src/Domain/Notes/NoteCommands.cs` — add `LinkNoteToCalendarEvent`
- `src/Domain/Notes/NoteEvents.cs` — add `NoteLinkedToCalendarEvent`
- `src/Domain/Notes/Note.cs` — add `_calendarEventId` state; `Apply(NoteLinkedToCalendarEvent)`; `HandleLinkNoteToCalendarEvent` (reject if deleted; reject if already linked)
- `src/EventStore/EventDeserializer.cs` — route `NoteLinkedToCalendarEvent`
- `src/EventStore/Projections/CalendarLinkIndexProjection.cs` — new file
- `src/Api/Stores/ICalendarLinkIndexStore.cs` — new interface (`GetByCalendarEventId`, `GetByRecurringSeriesId`, `Upsert`, `DeleteByNoteId`)
- `src/Api/NoteCommandHandler.cs` — add `HandleAsync(LinkNoteToCalendarEvent)`
- `src/Api/Handlers/CalendarHandlers.cs` — update `GetTodaysMeetings` to query `CalendarLinkIndex`
- `src/Api/Handlers/NoteHandlers.cs` — add `POST /notes/{noteId}/calendar-link` handler
- `src/Api/Endpoints/NoteEndpoints.cs` — register new endpoint
- `tests/Domain.Specs/Notes/LinkNoteToCalendarEventSpec.cs` — new BDD spec file
- `tests/Api.Integration/InMemoryCalendarLinkIndexStore.cs` — new in-memory implementation
- `tests/Api.Integration/` — test `POST /notes/{noteId}/calendar-link`; test that `GET /calendar/today` returns correct `linkedNoteId`

**Scenarios:**

```
Scenario: Link a note to a calendar event
  Given a note exists and has not been deleted
  When  LinkNoteToCalendarEvent is handled with calendarEventId "abc123"
  Then  NoteLinkedToCalendarEvent is appended to the note's stream
  And   the CalendarLinkIndex records "abc123" → noteId

Scenario: GET /calendar/today shows the linked note
  Given note "7f3a" is linked to calendarEventId "abc123"
  And   today's meetings include the event with id "abc123"
  When  GET /calendar/today is called
  Then  that meeting has linkedNoteId "7f3a"

Scenario: Cannot link a deleted note to a calendar event
  Given a note has been deleted
  When  LinkNoteToCalendarEvent is handled for that note
  Then  the command is rejected and no event is appended

Scenario: Cannot link a note that is already linked
  Given a note is already linked to calendarEventId "abc123"
  When  LinkNoteToCalendarEvent is called again for that note
  Then  409 is returned and no second event is appended

Scenario: Deleting a note removes it from the CalendarLinkIndex
  Given note "7f3a" is linked to calendarEventId "abc123"
  When  the note is deleted
  Then  the CalendarLinkIndex no longer has an entry for "abc123"
  And   GET /calendar/today returns linkedNoteId: null for that meeting
```

**Acceptance criteria:**

- [x] *(internal)* `Note` aggregate handles `LinkNoteToCalendarEvent`; rejects if deleted or already linked
- [x] *(internal)* `NoteLinkedToCalendarEvent` is deserialised and routed
- [x] *(internal)* `CalendarLinkIndex` projection folds `NoteLinkedToCalendarEvent` (put) and `NoteDeleted` (delete by NoteId)
- [x] `POST /notes/{noteId}/calendar-link` appends the event; `CalendarLinkIndex` is updated
- [x] `POST /notes/{noteId}/calendar-link` returns 404 for unknown note; 409 for deleted or already-linked note
- [x] `GET /calendar/today` returns correct `linkedNoteId` (non-null when linked, null otherwise)

---

## Slice 9-D — One-click create note from a meeting

**Status:** Not Started

**Value:** I can create a note for a meeting in one click. The note is pre-titled from the meeting title, dated to the meeting's date, and immediately linked to the calendar event. The meeting card updates to show "Open Note".

**Note:** The "Create Note" and "Open Note ↗" buttons are currently rendered in `MeetingsSection.tsx` without `onClick` handlers — they were wired up visually by the Stylist pass but have no backing implementation until this slice lands. Clicking them does nothing.

**Commands in scope:** `CreateNote` + `RenameNote` + `SetNoteDate` + `LinkNoteToCalendarEvent` — issued in sequence by the handler; no new commands needed.

**API endpoint:**

- `POST /notes/from-meeting` — body:
  ```json
  {
    "calendarEventId": "abc123_20260514T090000Z",
    "title": "1:1 with Bill",
    "startTime": "2026-05-14T09:00:00Z",
    "endTime": "2026-05-14T09:30:00Z",
    "isRecurring": true,
    "recurringSeriesId": "abc123"
  }
  ```
  Returns 201 with `{ "noteId": "..." }`. Returns 409 if a note already exists for this `calendarEventId`.

Handler sequence:
1. Check `CalendarLinkIndex` for `calendarEventId` — return 409 if a note already exists.
2. Issue `CreateNote` (new `NoteId`).
3. Issue `RenameNote` with the meeting title.
4. Issue `SetNoteDate` with `DateOnly.FromDateTime(startTime.ToLocalTime())` — so a today meeting gets today's date and a future meeting gets its own date.
5. Issue `LinkNoteToCalendarEvent`.

**Key implementation files:**

- `src/Api/Handlers/CalendarHandlers.cs` — add `CreateNoteFromMeeting` handler
- `src/Api/Endpoints/CalendarEndpoints.cs` — register `POST /notes/from-meeting`
- `tests/Api.Integration/` — test: creates note, renames it, links it; 409 on duplicate calendarEventId
- `web/src/components/MeetingsSection.tsx` — "Create Note" button calls `createNoteFromMeeting(...)`; on success update card to "Open Note"; "Open Note" navigates to the note screen
- `web/src/api.ts` — add `createNoteFromMeeting(...)` returning `{ noteId: string }`

**Scenarios:**

```
Scenario: Create a note from a meeting with one click
  Given a meeting "1:1 with Bill" has no linked note
  When  I click "Create Note"
  Then  a new note is created with the title "1:1 with Bill"
  And   the note's date is set to the meeting's start date (local timezone)
  And   the meeting card changes to show "Open Note"

Scenario: Note date matches today for a today meeting
  Given a meeting today at 09:00 local time
  When  I click "Create Note"
  Then  the note's date is set to today

Scenario: Note date matches the meeting date for a future meeting
  Given a meeting on 2026-05-27 at 14:00 local time
  When  I click "Create Note"
  Then  the note's date is set to 2026-05-27

Scenario: The created note is linked to the calendar event
  Given I clicked "Create Note" on a meeting
  When  GET /calendar/today is called
  Then  that meeting has a non-null linkedNoteId

Scenario: Open Note navigates to the linked note
  Given a meeting card shows "Open Note"
  When  I click "Open Note"
  Then  the note screen opens for that note

Scenario: Creating a note when one already exists returns 409
  Given a note already exists for calendarEventId "abc123"
  When  POST /notes/from-meeting is called for "abc123"
  Then  409 is returned and no new note is created
```

**Acceptance criteria:**

- [ ] `POST /notes/from-meeting` creates, renames, and links a note; returns `{ noteId }`
- [ ] `POST /notes/from-meeting` with an already-linked `calendarEventId` returns 409
- [ ] `GET /calendar/today` returns correct `linkedNoteId` after creation
- [ ] "Create Note" button calls the endpoint; on success becomes "Open Note"
- [ ] "Open Note" navigates to the note screen for the linked note
- [ ] Note title is pre-populated from the meeting title
- [ ] Note date is set to the meeting's `startTime` local date (`DateOnly.FromDateTime(startTime.ToLocalTime())`)
- [ ] E2E: click "Create Note" on a meeting; card shows "Open Note"; click it — note screen opens with meeting title

---

## Slice 9-E — Meeting-time browser reminder

**Status:** Done

**Value:** At the moment a meeting starts, a browser notification appears so I don't miss it.

**Commands in scope:** none
**Events in scope:** none
**Backend changes:** none — entirely a frontend feature.

**How it works:** When `<MeetingsSection />` loads and receives meetings:
1. Requests notification permission once via `Notification.requestPermission()` if not already decided. Shows a banner prompt.
2. For each meeting whose `startTime` is in the future today, schedules `setTimeout(() => fireReminder(meeting), msUntilStart)`.
3. On fire: if permission is `granted`, fires `new Notification(meeting.title, { body: "Your meeting is starting now" })`. If `denied` or `default`, shows an in-app banner/toast instead.
4. Clears all timers on component unmount.

**Key implementation files:**

- `web/src/hooks/useMeetingReminders.ts` — new custom hook: schedules `setTimeout` per meeting; fires notification or in-app toast; cleans up on unmount
- `web/src/components/MeetingsSection.tsx` — notification permission request banner; uses `useMeetingReminders`

**Scenarios:**

```
Scenario: A notification fires when a meeting starts
  Given I have granted notification permission
  And   a meeting is scheduled to start in 1 minute
  When  the meeting start time is reached
  Then  a browser notification appears with the meeting title

Scenario: An in-app banner appears if notification permission was denied
  Given I have denied notification permission
  When  a meeting start time is reached
  Then  an in-app banner shows the meeting title

Scenario: A permission request banner is shown before a decision is made
  Given I have not yet made a notification permission decision
  When  I open the home screen and meetings are loaded
  Then  a banner prompts me to enable notifications

Scenario: No reminder is scheduled for a meeting that has already started
  Given a meeting started 10 minutes ago
  When  the home screen loads
  Then  no reminder timer is set for that meeting
```

**Acceptance criteria:**

- [x] `useMeetingReminders` schedules a `setTimeout` for each future meeting on mount; clears all on unmount
- [x] `new Notification(...)` fires when permission is `granted`
- [x] `alert()` fallback shown when permission is `denied`; `default` is silent (user hasn't decided — show the banner instead)
- [x] Permission request banner shown when permission state is `default`; dismissible with Enable or ✕
- [x] No timer set for meetings with `startTime` in the past

---

## Slice 9-F — Recurring meetings: create note for next occurrence

**Status:** Not Started

**Value:** For a recurring meeting shown today, I can create a note for next week's occurrence in one click so I can start adding agenda items before the meeting.

**Commands in scope:** `CreateNote` + `RenameNote` + `LinkNoteToCalendarEvent` (same as 9-D, applied to the next occurrence)

**New service method:**

```csharp
// Added to IGoogleCalendarClient
Task<CalendarEvent?> GetNextOccurrenceAsync(string recurringSeriesId, DateTimeOffset after);
```

**API endpoint:**

- `POST /notes/from-next-occurrence` — body:
  ```json
  {
    "recurringSeriesId": "abc123",
    "todayCalendarEventId": "abc123_20260514T090000Z"
  }
  ```
  Returns 201 with `{ "noteId": "...", "nextOccurrence": { "calendarEventId": "...", "startTime": "...", "endTime": "..." } }`.
  Returns 404 with `{ "error": "no_future_occurrences" }` if the series has no future instances.
  Returns 200 with `{ "noteId": "...", "alreadyExists": true }` if a note already exists for the next occurrence.

Handler sequence:
1. Call `GetNextOccurrenceAsync(recurringSeriesId, after: now)` — return 404 if null.
2. Check `CalendarLinkIndex` for the next instance's `calendarEventId` — if found, return `alreadyExists: true`.
3. Otherwise: create, rename, and link a note (same as `POST /notes/from-meeting`).

**GET /calendar/today update:** Populates `hasNextOccurrenceNote` by querying `RecurringSeriesId-index` GSI for a note linked to any instance with `StartTime > now`. If one exists, `hasNextOccurrenceNote: true`.

**Key implementation files:**

- `src/Api/Services/IGoogleCalendarClient.cs` — add `GetNextOccurrenceAsync`
- `src/Api/Services/GoogleCalendarClient.cs` — implement using Google Calendar `instances` endpoint with `timeMin=now`, take first result
- `src/Api/Handlers/CalendarHandlers.cs` — add `CreateNoteFromNextOccurrence` handler; update `GetTodaysMeetings` for `hasNextOccurrenceNote`
- `src/Api/Endpoints/CalendarEndpoints.cs` — register `POST /notes/from-next-occurrence`
- `tests/Api.Integration/FakeGoogleCalendarClient.cs` — add `GetNextOccurrenceAsync` stub
- `tests/Api.Integration/` — test: creates note for next occurrence; 404 on no future instances; `alreadyExists: true` when note exists
- `web/src/components/MeetingsSection.tsx` — for recurring meetings: show "Note for next occurrence" when `!hasNextOccurrenceNote`; show "Open next occurrence note" when `hasNextOccurrenceNote`; hide both for non-recurring
- `web/src/api.ts` — add `createNoteFromNextOccurrence(...)`

**Scenarios:**

```
Scenario: A recurring meeting shows "Note for next occurrence" when none exists
  Given a recurring weekly meeting has no note for next week's instance
  When  I view the home screen
  Then  a "Note for next occurrence" button appears on that meeting card

Scenario: Create a note for the next occurrence
  Given a recurring meeting shows "Note for next occurrence"
  When  I click the button
  Then  a note is created linked to next week's instance
  And   the button changes to "Open next occurrence note"

Scenario: Open the next occurrence note
  Given a note already exists for next week's occurrence
  When  I click "Open next occurrence note"
  Then  the note screen opens for that note

Scenario: The button is hidden when no future occurrences exist
  Given a recurring meeting series ended last week
  When  I view the home screen
  Then  no "Note for next occurrence" or "Open next occurrence note" button appears

Scenario: hasNextOccurrenceNote reflects a note already created for next week
  Given I created a note for next week's recurring meeting
  When  GET /calendar/today is called for this week's meeting
  Then  hasNextOccurrenceNote is true for that meeting
```

**Acceptance criteria:**

- [ ] `GetNextOccurrenceAsync` returns the next calendar instance after `now`
- [ ] `POST /notes/from-next-occurrence` creates and links a note to the next instance
- [ ] `POST /notes/from-next-occurrence` returns 404 when no future occurrences exist
- [ ] `POST /notes/from-next-occurrence` returns `alreadyExists: true` when a note already exists; frontend navigates to it
- [ ] `GET /calendar/today` populates `hasNextOccurrenceNote` correctly via GSI lookup
- [ ] "Note for next occurrence" button visible on recurring meetings with `!hasNextOccurrenceNote`
- [ ] "Open next occurrence note" button visible when `hasNextOccurrenceNote` is true
- [ ] Both buttons hidden for non-recurring meetings and when series has ended
- [ ] E2E: click "Note for next occurrence" on a recurring meeting; button changes to "Open next occurrence note"; click it — note screen opens

---

## Slice 9-G — CDK wiring

**Status:** Done

**Value:** The deployed Lambda can reach Google Calendar and the `CalendarLinkIndex` DynamoDB table. Infrastructure changes are tested via CDK template assertions.

**No new domain code.** This slice is pure CDK and `Infrastructure.Assertions` updates.

**Changes in scope:**

- Lambda env vars: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN_SSM_PATH`, `PROJ_CALENDARLINKINDEX_TABLE_NAME`
- IAM grant: `ssm:GetParameter` on the SSM parameter ARN
- New DynamoDB table: `notetaker-proj-calendarlinkindex` — PK: `CalendarEventId` (string); on-demand billing; PITR enabled; deletion policy: `Retain`
- New GSI on that table: `RecurringSeriesId-index` (PK: `RecurringSeriesId`; projection: all attributes)
- Lambda IAM: `GrantReadWriteData` on the new table
- `Infrastructure.Assertions` tests updated for all of the above

**Key implementation files:**

- `src/Infrastructure/NoteTakerStack.cs` — add env vars, SSM grant, new table with GSI, IAM grants
- `tests/Infrastructure.Assertions/` — new assertions for env vars, SSM grant, new table, GSI

**Scenarios:**

```
Scenario: Lambda has Google Calendar env vars
  Given the CDK stack is synthesised
  When  the CloudFormation template is examined
  Then  the Lambda has GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET,
        and GOOGLE_REFRESH_TOKEN_SSM_PATH env vars

Scenario: Lambda has SSM GetParameter permission
  Given the CDK stack is synthesised
  When  the CloudFormation template is examined
  Then  the Lambda's IAM role includes ssm:GetParameter on the SSM parameter ARN

Scenario: CalendarLinkIndex table exists with the RecurringSeriesId GSI
  Given the CDK stack is synthesised
  When  the CloudFormation template is examined
  Then  notetaker-proj-calendarlinkindex DynamoDB table exists
  And   it has a RecurringSeriesId-index GSI with all-attributes projection

Scenario: Lambda has read-write access to the CalendarLinkIndex table
  Given the CDK stack is synthesised
  When  the CloudFormation template is examined
  Then  the Lambda's IAM role has DynamoDB read-write grants on notetaker-proj-calendarlinkindex
```

**Acceptance criteria:**

- [x] All env vars present on the Lambda in `cdk synth` output
- [x] `ssm:GetParameter` IAM grant present in CDK template
- [x] `notetaker-proj-calendarlinkindex` table with `RecurringSeriesId-index` GSI present
- [x] `GrantReadWriteData` on the new table present
- [x] `dotnet test tests/Infrastructure.Assertions/Infrastructure.Assertions.csproj` — all green
- [x] `cdk synth` exits 0 with no errors or warnings
- [ ] After `cdk deploy`: `GET /calendar/today` returns live Google Calendar data

---

## Backlog (deferred from Phase 9)

- **Multi-calendar support** — show meetings from calendars other than primary. Deferred; primary is sufficient for Phase 9.
- **Persistent notifications to a closed tab** — requires a WebSocket API or service worker; materially larger scope.
- **Link an existing note to a meeting** — the domain supports it (`LinkNoteToCalendarEvent` on any note), but the UX for doing this from the note screen is not in scope.
- **Unlink a note from a calendar event** — deferred.
- **Calendar event details on the note screen** — show meeting time and attendees when a note is calendar-linked. Deferred.
- **Calendar data refreshes on every home-screen mount** — `MeetingsSection` re-fetches on every navigation back to home because it has no shared state or cache. Likely acceptable (data stays fresh) but may feel slow on poor connections. **Parked — check back after 9-D lands to see if the latency is noticeable in practice.**
