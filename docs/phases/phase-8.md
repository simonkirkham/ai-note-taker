# Phase 8 — Google Calendar Integration + Meeting Notes

**Goal:** Surface today's Google Calendar meetings on the home screen so meeting notes can be created with one click, linked to the calendar event, and reminded at meeting time. Recurring meetings support one-click creation of a note for the next scheduled occurrence.

**Learning surface:** Outbound HTTP from Lambda (first time); Google OAuth2 refresh-token flow; SSM Parameter Store for secrets; extending an existing aggregate with a new event (`NoteLinkedToCalendarEvent`) without touching the immutable `NoteCreated`; a new read projection (`CalendarLinkIndex`) keyed by an external ID; browser Notifications API + `setTimeout` for client-side reminders; `EventMetadata.UserId` populated for the first time (groundwork for Phase 10 multi-user).

---

## Prototype status

A UX prototype **must be built and approved before any backend work begins.** The prototype lives on branch `prototype/8-meetings` and is never merged. On approval, this doc is updated with confirmed GWT scenarios and UX patterns; real implementation starts fresh.

See slice 8-A for the prototype brief.

---

## What is already in place

- `EventMetadata` already carries a `UserId` field (always `null` — reserved per ADR 0005). Phase 8 starts populating it via a `GOOGLE_ACCOUNT_ID` env var, hardcoded to the single developer's Google account ID. This makes the Phase 10 upgrade a wiring change, not a model change.
- `NoteCommandHandler` already follows load-stream → rebuild → handle → persist → update-projection. The new `LinkNoteToCalendarEvent` command fits this pattern exactly.
- All five test layers are in place. `IGoogleCalendarClient` must be an injectable interface from day one so ApiIntegration tests run without real Google credentials.
- The home screen (`ListView.tsx`) renders `<TodoSection />` and a grid of `<NoteCard>`. Adding `<MeetingsSection />` is an additive change.

What is **not** yet in place:
- No outbound HTTP from Lambda; no Google client library; no SSM usage; no `HttpClient` registration.
- No `NoteLinkedToCalendarEvent` event or `LinkNoteToCalendarEvent` command.
- No `CalendarLinkIndex` projection or DynamoDB table.
- No `GET /calendar/today` endpoint.
- No `<MeetingsSection />` component.
- No browser notification wiring.

**Out-of-band prerequisite (not a slice):** Create a GCP project, enable the Calendar API, create OAuth2 client credentials, and run the one-time authorisation flow to obtain a refresh token for `calendar.readonly` scope. Store the refresh token in AWS SSM Parameter Store as a `SecureString` at the path configured in `GOOGLE_REFRESH_TOKEN_SSM_PATH`. This must be done before 8-B can be deployed.

---

## Slice order and dependencies

```
8-A  UX prototype ─── human approval required ────────────────────────────────────────┐
                                                                                       │
8-G  CDK wiring ──────────────────────────────────────────────────────────────────┐   │
     (SSM grant, Google env vars, CalendarLinkIndex table + GSI)                  │   │
     can run in parallel with 8-B and 8-C                                         │   │
                                                                                  │   ▼
8-B  Google Calendar pass-through ─────────────────────────────────────────────────────┤
     GET /calendar/today, OAuth, MeetingsSection UI (linkedNoteId always null here)    │
        │                                                                              │
        ├──→ 8-C  NoteLinkedToCalendarEvent + CalendarLinkIndex projection ────────────┤
        │           │                                                                  │
        │           └──→ 8-D  One-click create note from a meeting ───────────────────┤
        │                       │                                                      │
        │                       └──→ 8-F  Recurring: note for next occurrence ─────────┘
        │
        └──→ 8-E  Meeting-time browser reminder  (no backend changes; independent of C/D/F)
```

Each slice is a complete vertical: domain, API, projections, and frontend wired together.

---

## Slice 8-A — UX prototype

**Status:** Not Started

**Value:** Validate the `<MeetingsSection />` layout on the home screen before writing any production code. The home screen already has three sections (TodoSection, tag filter, NoteCards); adding a fourth is a genuine UX uncertainty.

**This is a prototype slice.** Work happens on branch `prototype/8-meetings`. No real backend — hardcode a fake `getTodaysMeetings()` response in `api.ts`. Code is quick-and-dirty; it will be thrown away. On human approval the exit procedure updates this doc with confirmed GWT scenarios and UX patterns. Real implementation (8-B onward) starts from scratch.

**What the prototype must demonstrate:**

- `<MeetingsSection />` sits on the home screen alongside `<TodoSection />` and the note card grid. Validate position and layout (panel, list, row?).
- Meeting card shows: title, start/end time.
- "Create Note" button on a meeting with no linked note (fake `linkedNoteId: null`).
- "Open Note" button on a meeting that has a linked note (fake a non-null `linkedNoteId`).
- "Note for next occurrence" button on a recurring meeting (fake `isRecurring: true`, `hasNextOccurrenceNote: false`).
- "Open next occurrence note" when `hasNextOccurrenceNote: true`.
- "Cannot connect to calendar" error state when fake data returns null.
- Notification permission request banner (mock — no actual `Notification` call needed).

**Prototype confirmed items (filled in after approval):**

- *Component layout — TBD*
- *Meeting card design — TBD*
- *Recurring meeting button placement — TBD*
- *Error state treatment — TBD*

---

## Slice 8-B — Google Calendar API pass-through

**Status:** Not Started

**Value:** Today's meetings appear on the home screen, fetched live from Google Calendar. `linkedNoteId` is always `null` in this slice — the link index comes in 8-C.

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

- `GET /calendar/today?tz={ianaTimezone}` — required param; returns 400 if missing.

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

**EventMetadata.UserId:** Starting in this slice, all command handlers read `GOOGLE_ACCOUNT_ID` from `IConfiguration` and set `UserId` in `EventMetadata`. For Phase 8's single-user app this is a constant string; Phase 10 replaces it with the authenticated user's sub claim.

**Key implementation files:**

- `src/Api/Services/IGoogleCalendarClient.cs` — new interface + `CalendarEvent` record
- `src/Api/Services/GoogleCalendarClient.cs` — new: SSM read + `Google.Apis.Calendar.v3` integration
- `src/Api/Builder.cs` — register `IGoogleCalendarClient` in DI; read `GOOGLE_ACCOUNT_ID`
- `src/Api/Handlers/CalendarHandlers.cs` — new: `GetTodaysMeetings` handler
- `src/Api/Endpoints/CalendarEndpoints.cs` — new: register `GET /calendar/today`
- `src/Api/NoteCommandHandler.cs` — populate `EventMetadata.UserId` from config
- `tests/ApiIntegration/FakeGoogleCalendarClient.cs` — new: in-memory `IGoogleCalendarClient`
- `tests/ApiIntegration/` — test: correct shape returned; 400 on missing `tz`; `calendar_unavailable` when fake throws
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

- [ ] `IGoogleCalendarClient` is injectable; `FakeGoogleCalendarClient` used in all tests
- [ ] `GET /calendar/today?tz=Europe/London` returns today's meetings in start-time order
- [ ] `GET /calendar/today` without `tz` returns 400
- [ ] `GET /calendar/today` when Google is unreachable returns `{ "error": "calendar_unavailable" }` with 200
- [ ] All meetings have `linkedNoteId: null` and `hasNextOccurrenceNote: false` in this slice
- [ ] `<MeetingsSection />` renders meetings, empty state, and error state correctly
- [ ] `EventMetadata.UserId` populated from `GOOGLE_ACCOUNT_ID` in all command handlers

---

## Slice 8-C — NoteLinkedToCalendarEvent event + CalendarLinkIndex projection

**Status:** Not Started

**Value:** A note can be associated with a calendar event in the domain. `GET /calendar/today` starts returning `linkedNoteId` for meetings that have a note. The domain event carries all calendar metadata so the note is self-contained in the event stream even if the calendar event is later deleted or rescheduled.

**Commands in scope:**

- `LinkNoteToCalendarEvent(NoteId, CalendarEventId, CalendarEventTitle, StartTime, EndTime, IsRecurring, RecurringSeriesId?)` — note must exist and not be deleted; note must not already be linked to a calendar event

**Events in scope:**

- `NoteLinkedToCalendarEvent { NoteId, CalendarEventId, CalendarEventTitle, StartTime, EndTime, IsRecurring, RecurringSeriesId? }`

**Projections in scope:**

`CalendarLinkIndex` — keyed by `CalendarEventId → NoteId`. Updated by:
- `NoteLinkedToCalendarEvent` → put row `(CalendarEventId, NoteId, RecurringSeriesId?, StartTime)`
- `NoteDeleted` → delete row where `NoteId = …`

Storage: table `notetaker-proj-calendarlinkindex` (PK: `CalendarEventId`; GSI: `RecurringSeriesId-index`, PK: `RecurringSeriesId` — needed in 8-F).

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
- `tests/Specs/Notes/LinkNoteToCalendarEventSpec.cs` — new BDD spec file
- `tests/ApiIntegration/InMemoryCalendarLinkIndexStore.cs` — new in-memory implementation
- `tests/ApiIntegration/` — test `POST /notes/{noteId}/calendar-link`; test that `GET /calendar/today` returns correct `linkedNoteId`

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

- [ ] *(internal)* `Note` aggregate handles `LinkNoteToCalendarEvent`; rejects if deleted or already linked
- [ ] *(internal)* `NoteLinkedToCalendarEvent` is deserialised and routed
- [ ] *(internal)* `CalendarLinkIndex` projection folds `NoteLinkedToCalendarEvent` (put) and `NoteDeleted` (delete by NoteId)
- [ ] `POST /notes/{noteId}/calendar-link` appends the event; `CalendarLinkIndex` is updated
- [ ] `POST /notes/{noteId}/calendar-link` returns 404 for unknown note; 409 for deleted or already-linked note
- [ ] `GET /calendar/today` returns correct `linkedNoteId` (non-null when linked, null otherwise)

---

## Slice 8-D — One-click create note from a meeting

**Status:** Not Started

**Value:** I can create a note for a meeting in one click. The note is pre-titled from the meeting title and immediately linked to the calendar event. The meeting card updates to show "Open Note".

**Commands in scope:** `CreateNote` + `RenameNote` + `LinkNoteToCalendarEvent` — issued in sequence by the handler; no new commands needed.

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
4. Issue `LinkNoteToCalendarEvent`.

**Key implementation files:**

- `src/Api/Handlers/CalendarHandlers.cs` — add `CreateNoteFromMeeting` handler
- `src/Api/Endpoints/CalendarEndpoints.cs` — register `POST /notes/from-meeting`
- `tests/ApiIntegration/` — test: creates note, renames it, links it; 409 on duplicate calendarEventId
- `web/src/components/MeetingsSection.tsx` — "Create Note" button calls `createNoteFromMeeting(...)`; on success update card to "Open Note"; "Open Note" navigates to the note screen
- `web/src/api.ts` — add `createNoteFromMeeting(...)` returning `{ noteId: string }`

**Scenarios:**

```
Scenario: Create a note from a meeting with one click
  Given a meeting "1:1 with Bill" has no linked note
  When  I click "Create Note"
  Then  a new note is created with the title "1:1 with Bill"
  And   the meeting card changes to show "Open Note"

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
- [ ] E2E: click "Create Note" on a meeting; card shows "Open Note"; click it — note screen opens with meeting title

---

## Slice 8-E — Meeting-time browser reminder

**Status:** Not Started

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

- [ ] `useMeetingReminders` schedules a `setTimeout` for each future meeting on mount; clears all on unmount
- [ ] `new Notification(...)` fires when permission is `granted`
- [ ] In-app banner/toast shown when permission is `denied` or `default`
- [ ] Permission request banner shown when permission state is `default`
- [ ] No timer set for meetings with `startTime` in the past

---

## Slice 8-F — Recurring meetings: create note for next occurrence

**Status:** Not Started

**Value:** For a recurring meeting shown today, I can create a note for next week's occurrence in one click so I can start adding agenda items before the meeting.

**Commands in scope:** `CreateNote` + `RenameNote` + `LinkNoteToCalendarEvent` (same as 8-D, applied to the next occurrence)

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
- `tests/ApiIntegration/FakeGoogleCalendarClient.cs` — add `GetNextOccurrenceAsync` stub
- `tests/ApiIntegration/` — test: creates note for next occurrence; 404 on no future instances; `alreadyExists: true` when note exists
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

## Slice 8-G — CDK wiring

**Status:** Not Started

**Value:** The deployed Lambda can reach Google Calendar and the `CalendarLinkIndex` DynamoDB table. Infrastructure changes are tested via CDK template assertions.

**No new domain code.** This slice is pure CDK and `InfraAssertions` updates.

**Changes in scope:**

- Lambda env vars: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN_SSM_PATH`, `GOOGLE_ACCOUNT_ID`, `PROJ_CALENDARLINKINDEX_TABLE_NAME`
- IAM grant: `ssm:GetParameter` on the SSM parameter ARN
- New DynamoDB table: `notetaker-proj-calendarlinkindex` — PK: `CalendarEventId` (string); on-demand billing; PITR enabled; deletion policy: `Retain`
- New GSI on that table: `RecurringSeriesId-index` (PK: `RecurringSeriesId`; projection: all attributes)
- Lambda IAM: `GrantReadWriteData` on the new table
- `InfraAssertions` tests updated for all of the above

**Key implementation files:**

- `src/Infrastructure/NoteTakerStack.cs` — add env vars, SSM grant, new table with GSI, IAM grants
- `tests/InfraAssertions/` — new assertions for env vars, SSM grant, new table, GSI

**Scenarios:**

```
Scenario: Lambda has Google credentials env vars
  Given the CDK stack is synthesised
  When  the CloudFormation template is examined
  Then  the Lambda has GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET,
        GOOGLE_REFRESH_TOKEN_SSM_PATH, and GOOGLE_ACCOUNT_ID env vars

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

- [ ] All five env vars present on the Lambda in `cdk synth` output
- [ ] `ssm:GetParameter` IAM grant present in CDK template
- [ ] `notetaker-proj-calendarlinkindex` table with `RecurringSeriesId-index` GSI present
- [ ] `GrantReadWriteData` on the new table present
- [ ] `dotnet test tests/InfraAssertions/InfraAssertions.csproj` — all green
- [ ] `cdk synth` exits 0 with no errors or warnings
- [ ] After `cdk deploy`: `GET /calendar/today` returns live Google Calendar data

---

## Backlog (deferred from Phase 8)

- **Multi-calendar support** — show meetings from calendars other than primary. Deferred; primary is sufficient for Phase 8.
- **Persistent notifications to a closed tab** — requires a WebSocket API or service worker; materially larger scope.
- **Link an existing note to a meeting** — the domain supports it (`LinkNoteToCalendarEvent` on any note), but the UX for doing this from the note screen is not in scope.
- **Unlink a note from a calendar event** — deferred.
- **Calendar event details on the note screen** — show meeting time and attendees when a note is calendar-linked. Deferred.
