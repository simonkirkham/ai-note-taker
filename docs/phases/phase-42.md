# Phase 42 — Calendar access through the MCP _(Done)_

**Goal:** from a connected Claude session the owner can ask "what meetings do I have in OGI on Monday?" and "make a note for my next Acme standup" — Claude reads the workspace's connected calendar and creates calendar-linked notes, over the MCP connector.

## Summary

| Slice | What the user gets | Status | Depends on |
|-------|--------------------|--------|------------|
| 42-A | Ask Claude what's on a workspace's calendar for a given day, including which meetings already have a note | Done _(#366, deploy #670)_ | — |
| 42-B | Ask Claude to start a note for a meeting — or for the next occurrence of a repeating one | Done _(#369, deploy #677)_ | 42-A |

**42-A is the proving slice** — the hard part is working out *which* calendar to read when the request doesn't arrive through a workspace's own page, not the listing itself. Reading one day's meetings is the smallest capability that proves it end-to-end on one real call; 42-B then scales to the calendar-linked writes.

## Slices

### 42-A — Ask Claude what's on your calendar

**User value:** you ask "what meetings do I have in OGI on Monday?" and Claude answers from that workspace's own connected calendar — including which meetings already have a note.

**How it works:**
- You name a workspace and a date; Claude lists that day's meetings with title, start and end time, whether it repeats, and the note already linked to it (if any).
- A workspace that isn't yours is refused, and no meetings come back.
- A workspace with no calendar connected gets a plain "no calendar connected" answer, so Claude can tell you to connect one — it is not treated as a failure.
- A date Claude can't parse comes back with a clear message about the expected format.
- You can pass a timezone so "that day" means your day, not UTC's.

**Scenarios (GWT):**
```
Scenario: List a workspace's meetings for a date
  Given I am connected and own a workspace with a connected calendar
  When  I ask Claude for that workspace's meetings on a date
  Then  it returns that day's meetings, each with its times, whether it repeats,
        and any note already linked to it

Scenario: A workspace I do not own
  Given a workspace that is not mine
  When  I ask Claude for its meetings
  Then  the request is refused and no meetings are returned

Scenario: No calendar connected
  Given a workspace I own with no calendar connected
  When  I ask Claude for its meetings
  Then  I am told no calendar is connected, rather than shown an error

Scenario: A date Claude cannot parse
  Given a date that is not in the expected format
  When  I ask Claude for meetings on it
  Then  I get a clear message describing the format to use
```

### 42-B — Ask Claude to start a note for a meeting

**User value:** you say "make a note for my next Acme standup" and the note is created, dated, and tied to that meeting — no hunting through the calendar yourself.

**How it works:**
- You pick a meeting (usually one Claude just listed) and ask for a note; the note is created, dated to the meeting, and linked to it.
- Asking twice for the same meeting hands you back the note you already have instead of creating a duplicate.
- For a repeating meeting you can ask for "the next one" and Claude finds the next future occurrence and links the note to that.
- A repeating meeting with nothing upcoming gets a plain "no future occurrence" answer, not a failure.

**Scenarios (GWT):**
```
Scenario: Create a note for a meeting
  Given I own a workspace and have picked one of its meetings
  When  I ask Claude to make a note for it
  Then  a note is created, dated to the meeting, and linked to it

Scenario: A meeting that already has a note
  Given a meeting I already made a note for
  When  I ask Claude to make a note for it again
  Then  I am given the existing note rather than a duplicate

Scenario: Create a note for the next occurrence of a repeating meeting
  Given I own a workspace with a repeating meeting
  When  I ask Claude to make a note for the next one
  Then  a note is created and linked to the next future occurrence

Scenario: A repeating meeting with nothing upcoming
  Given a repeating meeting with no future occurrence
  When  I ask Claude to make a note for the next one
  Then  I am told there is no future occurrence, rather than shown an error
```

---

## Build notes _(implementation — skip when reviewing)_

Phase 41 made the connector read+write for notes/to-dos. This adds the **calendar** surface. No new aggregates or events: the read reuses the existing calendar client chain; the writes reuse the existing `CreateNote`/`RenameNote`/`SetNoteDate`/`LinkNoteToCalendarEvent` commands. The one cross-cutting change is identity/workspace resolution: the calendar chain resolves the workspace from the **URL route** (`ICurrentWorkspace`), but the `/mcp` path has no workspace in it — so 42-A introduces a scoped `ICalendarScope` the MCP tools set from the token `sub` + the `workspaceId` argument.

### Locked decisions

1. **Workspace-parameterized, like every Phase 41 tool.** Each calendar tool takes a `workspaceId`, authorizes the token `sub` owns it (default always allowed; else `WorkspaceList` membership), and resolves **that** workspace's connected calendar. (Owner decision 2026-06-29.)
2. **Calendar resolution becomes identity/workspace-explicit via a scoped `ICalendarScope`.** It defaults to `(ICurrentUser, ICurrentWorkspace)` — so every existing HTTP calendar path is unchanged — and the MCP tools override it with `(sub, workspaceIdArg)` before resolving. The four route-coupled consumers (`GoogleCalendarTokenSource`, `MicrosoftCalendarTokenSource`, `IcsFeedCalendarClient`, `CalendarClientFactory`) read `ICalendarScope` instead of `ICurrentUser`/`ICurrentWorkspace` directly. Behaviour-preserving refactor, covered by the existing calendar tests.
3. **No event-model changes, no new handler overloads.** The read reuses `ICalendarClientFactory`/`ICalendarClient`. The writes reuse the existing `NoteCommand`s through the **generic** identity-explicit overload `INoteCommandHandler.HandleAsync(NoteCommand, userId, workspaceId, ct)` — which already covers `SetNoteDate` and `LinkNoteToCalendarEvent` (both `NoteCommand`s), so 41-A's path extends with no new handler code.
4. **No infra change.** The calendar services + token store are already on the **Command** Lambda, which has served `/mcp` since 41-A. Deploy-time neutral.
5. **`calendar_unavailable` is a normal result, not an MCP error.** A workspace with no connected calendar returns a clear "no calendar connected" payload (Claude tells the user to connect one), exactly as the HTTP `GetMeetingsForDate` returns `{ error: "calendar_unavailable" }` rather than failing.
6. **Tool-count cap raised to ≤13.** Three calendar tools land on Phase 41's 10. Descriptions stay one terse line.

### Routing & Lambda (infra note)

- No CDK change. `/mcp` is on the Command Lambda (41-A); the calendar client chain, `ICalendarTokenStore`, and `ICalendarLinkIndexStore` are all already granted to Command. The calendar GET routes stay on Command unchanged.

### Deploy-time impact

**Neutral.** No new routes, tables, or always-on compute — a scoped DI service + three tools on an existing endpoint.

### Slice 42-A — `list_meetings` + calendar resolution off the route

**Acceptance criteria:**
- New scoped `ICalendarScope` (default `(ICurrentUser, ICurrentWorkspace)`; settable override). `GoogleCalendarTokenSource`, `MicrosoftCalendarTokenSource`, `IcsFeedCalendarClient`, `CalendarClientFactory` read it instead of `ICurrentUser`/`ICurrentWorkspace`. Existing calendar tests stay green (behaviour-preserving).
- `list_meetings(workspaceId, date, timezone?)`: `ReadOnly`; authorizes workspace ownership; sets `ICalendarScope` to `(sub, workspaceId)`; resolves the client; returns meetings `[{calendarEventId, title, startTime, endTime, isRecurring, recurringSeriesId, linkedNoteId}]`. `timezone` is optional IANA (default `Etc/UTC`) — it only sets the day boundary; times are absolute.
- `calendar_unavailable` → a normal payload (`{ calendarConnected: false, meetings: [] }`-style), not an MCP error.
- Malformed date / invalid timezone → MCP error.
- `linkedNoteId` resolved per event via `ICalendarLinkIndexStore`, filtered to `sub`.
- `NoteMcpTools` gains `ICalendarClientFactory`, `ICalendarScope` (settable), `ICalendarLinkIndexStore`.
- Tests: `Api.Integration` MCP read (seed stub calendar + workspace; assert meetings returned, scoped); unowned-workspace rejection; calendar-unavailable; malformed date. Existing calendar suite green.
- Deploy-time delta: neutral.
- Owner manual gate: a real Claude session round-trips `list_meetings` against the deployed connector.

**Observability:** structured log per call (tool, workspaceId, sub, provider, meeting count, latency); cross-workspace rejection logged for audit (read leak of meeting titles — same severity bar as the note reads).

### Slice 42-B — calendar-linked note creation

**Build notes:**
- `create_note_from_meeting(workspaceId, calendarEventId, title, startTime, endTime, isRecurring?, recurringSeriesId?)` → authorize workspace; conflict-check `ICalendarLinkIndexStore.GetByCalendarEventIdAsync` for `sub`; `CreateNote → RenameNote → SetNoteDate → LinkNoteToCalendarEvent` via the generic identity-explicit overload (token `sub` = owner). Returns `{ noteId, version }`. Mirrors `CalendarHandlers.CreateNoteFromMeeting`.
- `create_note_from_next_occurrence(workspaceId, recurringSeriesId)` → authorize workspace; set `ICalendarScope`; resolve client; `GetNextOccurrenceAsync`; null → clean "no future occurrence" result; conflict-check; create + link as above. Mirrors `CalendarHandlers.CreateNoteFromNextOccurrence`.
- `startTime`/`endTime` as ISO-8601 strings (Claude supplies the values it got from `list_meetings`).
