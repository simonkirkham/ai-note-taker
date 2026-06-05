# Phase 9 — Google Calendar Integration + Meeting Notes

**Goal:** Surface today's Google Calendar meetings on the home screen so meeting notes can be created with one click, linked to the calendar event, and reminded at meeting time. Recurring meetings support one-click creation of a note for the next scheduled occurrence.

## Summary

| Slice | Summary | Status | Depends on |
|-------|---------|--------|------------|
| 9-A | UX prototype (human approval required) | Done | — |
| 9-B | Google Calendar API pass-through | Done | 9-A |
| 9-C | NoteLinkedToCalendarEvent event + CalendarLinkIndex projection | Done | 9-B |
| 9-D | One-click create note from a meeting | Done | 9-C |
| 9-E | Meeting-time browser reminder | Done | 9-B |
| 9-F | Recurring meetings: create note for next occurrence | Done | 9-D |
| 9-G | CDK wiring (SSM grant, Google env vars, CalendarLinkIndex table + GSI) | Done | — |

Each slice is a complete vertical: domain, API, projections, and frontend wired together. 9-G can run in parallel with 9-B and 9-C; 9-E is independent of 9-C/9-D/9-F.

---

## Slice 9-A — UX prototype

**Status:** Done — prototype approved. See `web/src/prototype/REFERENCE.md` on branch `prototype/9-meetings`.

### Scenarios

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

### Scenarios

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

### Acceptance criteria

- [x] `IGoogleCalendarClient` is injectable; `FakeGoogleCalendarClient` used in all tests
- [x] `GET /calendar/today?tz=Europe/London` returns today's meetings in start-time order
- [x] `GET /calendar/today` without `tz` returns 400
- [x] `GET /calendar/today` when Google is unreachable returns `{ "error": "calendar_unavailable" }` with 200
- [x] All meetings have `linkedNoteId: null` and `hasNextOccurrenceNote: false` in this slice
- [x] `<MeetingsSection />` renders meetings, empty state, and error state correctly

---

## Slice 9-C — NoteLinkedToCalendarEvent event + CalendarLinkIndex projection

**Status:** Done

### Scenarios

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

### Acceptance criteria

- [x] *(internal)* `Note` aggregate handles `LinkNoteToCalendarEvent`; rejects if deleted or already linked
- [x] *(internal)* `NoteLinkedToCalendarEvent` is deserialised and routed
- [x] *(internal)* `CalendarLinkIndex` projection folds `NoteLinkedToCalendarEvent` (put) and `NoteDeleted` (delete by NoteId)
- [x] `POST /notes/{noteId}/calendar-link` appends the event; `CalendarLinkIndex` is updated
- [x] `POST /notes/{noteId}/calendar-link` returns 404 for unknown note; 409 for deleted or already-linked note
- [x] `GET /calendar/today` returns correct `linkedNoteId` (non-null when linked, null otherwise)

---

## Slice 9-D — One-click create note from a meeting

**Status:** Done

### Scenarios

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

### Acceptance criteria

- [x] `POST /notes/from-meeting` creates, renames, and links a note; returns `{ noteId }`
- [x] `POST /notes/from-meeting` with an already-linked `calendarEventId` returns 409
- [x] `GET /calendar/today` returns correct `linkedNoteId` after creation
- [x] "Create Note" button calls the endpoint; on success becomes "Open Note"
- [x] "Open Note" navigates to the note screen for the linked note
- [x] Note title is pre-populated from the meeting title
- [x] Note date is set to the meeting's `startTime` local date (`DateOnly.FromDateTime(startTime.LocalDateTime)`)
- [ ] E2E: click "Create Note" on a meeting; card shows "Open Note"; click it — note screen opens with meeting title

---

## Slice 9-E — Meeting-time browser reminder

**Status:** Done

### Scenarios

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

### Acceptance criteria

- [x] `useMeetingReminders` schedules a `setTimeout` for each future meeting on mount; clears all on unmount
- [x] `new Notification(...)` fires when permission is `granted`
- [x] `alert()` fallback shown when permission is `denied`; `default` is silent (user hasn't decided — show the banner instead)
- [x] Permission request banner shown when permission state is `default`; dismissible with Enable or ✕
- [x] No timer set for meetings with `startTime` in the past

---

## Slice 9-F — Recurring meetings: create note for next occurrence

**Status:** Done

### Scenarios

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

### Acceptance criteria

- [x] `GetNextOccurrenceAsync` returns the next calendar instance after `now`
- [x] `POST /notes/from-next-occurrence` creates and links a note to the next instance
- [x] `POST /notes/from-next-occurrence` returns 404 when no future occurrences exist
- [x] `POST /notes/from-next-occurrence` returns `alreadyExists: true` when a note already exists; frontend navigates to it
- [x] `GET /calendar/today` populates `hasNextOccurrenceNote` correctly via GSI lookup
- [x] "Note for next occurrence" button visible on recurring meetings with `!hasNextOccurrenceNote`
- [x] "Open next occurrence note" button visible when `hasNextOccurrenceNote` is true
- [x] Both buttons hidden for non-recurring meetings and when series has ended
- [ ] E2E: click "Note for next occurrence" on a recurring meeting; button changes to "Open next occurrence note"; click it — note screen opens

---

## Slice 9-G — CDK wiring

**Status:** Done

### Scenarios

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

### Acceptance criteria

- [x] All env vars present on the Lambda in `cdk synth` output
- [x] `ssm:GetParameter` IAM grant present in CDK template
- [x] `notetaker-proj-calendarlinkindex` table with `RecurringSeriesId-index` GSI present
- [x] `GrantReadWriteData` on the new table present
- [x] `dotnet test tests/Infrastructure.Assertions/Infrastructure.Assertions.csproj` — all green
- [x] `cdk synth` exits 0 with no errors or warnings
- [ ] After `cdk deploy`: `GET /calendar/today` returns live Google Calendar data
