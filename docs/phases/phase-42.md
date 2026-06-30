# Phase 42 — Calendar access through the MCP

**Goal:** from a connected Claude session the owner can ask "what meetings do I have in OGI on Monday?" and "make a note for my next Acme standup" — Claude reads the workspace's connected calendar and creates calendar-linked notes, over the MCP connector.

Phase 41 made the connector read+write for notes/to-dos. This adds the **calendar** surface. No new aggregates or events: the read reuses the existing calendar client chain; the writes reuse the existing `CreateNote`/`RenameNote`/`SetNoteDate`/`LinkNoteToCalendarEvent` commands. The one cross-cutting change is identity/workspace resolution: the calendar chain resolves the workspace from the **URL route** (`ICurrentWorkspace`), but the `/mcp` path has no workspace in it — so 42-A introduces a scoped `ICalendarScope` the MCP tools set from the token `sub` + the `workspaceId` argument.

## Summary

| Slice | What the user gets | Status | Depends on |
|-------|--------------------|--------|------------|
| 42-A | **`list_meetings(workspaceId, date)` + calendar resolution off the route.** Claude lists a workspace's meetings for a date (title, time, whether a note is linked). Proves the whole MCP→calendar pipe on one real read. | Done _(#366, deploy #670)_ | — |
| 42-B | **`create_note_from_meeting` + `create_note_from_next_occurrence`.** Claude creates a note linked to a specific meeting, or to the next occurrence of a recurring series. | Not Started | 42-A |

**42-A is the proving slice** — the hard part is the cross-cutting contract (resolving the calendar for an explicit `(sub, workspaceId)` instead of the route's `ICurrentWorkspace`), not the tool. `list_meetings` is the smallest capability that proves it end-to-end on one real call. 42-B then scales to the calendar-linked writes on the proven resolution.

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

---

## Build notes _(implementation — skip when reviewing)_

### Slice 42-A — `list_meetings` + calendar resolution off the route

**User value:** Claude lists a workspace's meetings for a given date.

**How it works:**
- Owner asks "what meetings do I have in OGI on 2026-06-29?"; Claude resolves the workspace via `list_workspaces`, then calls `list_meetings(workspaceId, date, timezone?)`.
- The tool authorizes workspace ownership, resolves that workspace's connected calendar (Google/Microsoft/ICS), and returns the day's meetings.

**Scenarios (GWT):**
```
Scenario: List a workspace's meetings for a date
  Given I am connected and own a workspace with a connected calendar
  When  Claude calls list_meetings for that workspace and a date
  Then  it returns that day's meetings (title, start, end, recurring, linked note id)

Scenario: A workspace I do not own is rejected
  Given a workspaceId I do not own
  When  Claude calls list_meetings with it
  Then  the call is rejected (MCP error) and no meetings are returned

Scenario: No calendar connected
  Given a workspace I own with no connected calendar
  When  Claude calls list_meetings for it
  Then  it returns a clear "no calendar connected" result, not an error

Scenario: Malformed date
  Given a date that is not yyyy-MM-dd
  When  Claude calls list_meetings with it
  Then  it returns an MCP error describing the expected format
```

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

**User value:** Claude creates a note linked to a specific meeting, or to the next occurrence of a recurring series.

**Scenarios (GWT):**
```
Scenario: Create a note from a meeting
  Given I own a workspace and have a meeting's details (from list_meetings)
  When  Claude calls create_note_from_meeting with the workspace and meeting
  Then  a note is created, dated, and linked to that calendar event

Scenario: A meeting already has a note
  Given a meeting I already created a note for
  When  Claude calls create_note_from_meeting for it again
  Then  the call reports the existing note rather than creating a duplicate

Scenario: Create a note for the next occurrence of a recurring meeting
  Given I own a workspace with a recurring series
  When  Claude calls create_note_from_next_occurrence with the series id
  Then  a note is created and linked to the next future occurrence

Scenario: No future occurrence
  Given a recurring series with no upcoming occurrence
  When  Claude calls create_note_from_next_occurrence
  Then  it returns a clear "no future occurrence" result, not a 500
```

**Build notes:**
- `create_note_from_meeting(workspaceId, calendarEventId, title, startTime, endTime, isRecurring?, recurringSeriesId?)` → authorize workspace; conflict-check `ICalendarLinkIndexStore.GetByCalendarEventIdAsync` for `sub`; `CreateNote → RenameNote → SetNoteDate → LinkNoteToCalendarEvent` via the generic identity-explicit overload (token `sub` = owner). Returns `{ noteId, version }`. Mirrors `CalendarHandlers.CreateNoteFromMeeting`.
- `create_note_from_next_occurrence(workspaceId, recurringSeriesId)` → authorize workspace; set `ICalendarScope`; resolve client; `GetNextOccurrenceAsync`; null → clean "no future occurrence" result; conflict-check; create + link as above. Mirrors `CalendarHandlers.CreateNoteFromNextOccurrence`.
- `startTime`/`endTime` as ISO-8601 strings (Claude supplies the values it got from `list_meetings`).
