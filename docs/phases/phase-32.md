# Phase 32 — Microsoft 365 (Outlook) Calendar Integration

**Goal:** Let the owner back the home-screen meetings list with their **Microsoft 365 / Outlook** calendar instead of Google, reusing every existing calendar consumer (create-note-from-meeting, reminders, recurring next-occurrence) unchanged. Mirrors Phase 9's Google model: a refresh token minted out-of-band and stored in SSM, exchanged for an access token per call, read via `/me/calendarView`.

## Summary

| Slice | Summary | Status | Depends on |
|-------|---------|--------|------------|
| 32-A | **See your Outlook meetings on Home and create a note from one** (the day's M365 calendar, one-click note linked to the meeting). | Done | — |
| 32-B | **Create a note for the next occurrence of a recurring Outlook meeting** (parity with Google recurring meetings). | Done | 32-A |

Spike already done (2026-06-22/23): MSAL device-code auth + a real `GET /me/calendarView` returned a real event for `simon.kirkham@outlook.com` (personal MSA), confirming the auth path, the `Calendars.Read` scope, and the field mapping. See [Spike findings](#spike-findings).

32-A is the smallest vertical that proves the whole flow on one real call (owner's Outlook meetings render on Home). 32-B scales the proven pattern to the one remaining interface method.

### Locked decisions

1. **One provider at a time, selected by `CALENDAR_PROVIDER` env (`google` | `microsoft`), default `google`.** Single-user app — no per-user provider state, no merged calendars. "Both calendars at once / merged view" is out of scope → future-features if wanted.
2. **Token minted out-of-band, stored in SSM** — exactly like Google. No in-app OAuth consent UI. The MSAL device-code spike is promoted to a committed one-shot minting tool that prints the refresh token for `aws ssm put-parameter`.
3. **Public-client app, no client secret** — the Entra registration is a public client (device-code requires it). The runtime refresh-token exchange uses `grant_type=refresh_token` at the v2 token endpoint with no secret. `MS_CLIENT_SECRET` is therefore **not** required (unlike Google).
4. **Force UTC via `Prefer: outlook.timezone="UTC"`** so every `start.dateTime` / `end.dateTime` is UTC and parses to a `DateTimeOffset` by appending `Z` — avoids parsing arbitrary Windows timezone names.

### Deploy-time impact

**Neutral.** Adds 3–4 Lambda env vars + one SSM-parameter read grant (mirrors the existing Google grant). No new table, no projection, **no backfill**. No change to `deploy.yml`.

---

## Spike findings

`GET /me/calendarView?startDateTime=…&endDateTime=…&$select=subject,start,end,isAllDay,seriesMasterId` with `Calendars.Read` consented returned:

```json
{ "value": [ {
  "id": "AQMkAD…",
  "subject": "Test Meeting",
  "isAllDay": false,
  "seriesMasterId": null,
  "start": { "dateTime": "2026-06-22T08:30:00.0000000", "timeZone": "UTC" },
  "end":   { "dateTime": "2026-06-22T09:00:00.0000000", "timeZone": "UTC" }
} ] }
```

| Graph field | → `CalendarEvent` | Note |
|---|---|---|
| `id` | `CalendarEventId` | opaque per-**instance** id; differs from `seriesMasterId` |
| `subject` | `Title` | |
| `start.dateTime` + `start.timeZone` | `StartTime` | naive datetime + separate tz string (not an offset) — force UTC via `Prefer` header |
| `end.dateTime` + `end.timeZone` | `EndTime` | same |
| `seriesMasterId` non-null | `IsRecurring` + `RecurringSeriesId` | `/me/calendarView` expands recurrences server-side (Graph equivalent of Google `SingleEvents=true`) |
| `isAllDay` | all-day handling | parse all-day dates in the caller's tz like the Google client |

Proven: personal MSA works with delegated `Calendars.Read`, no admin consent. Unconfirmed corner: a populated `seriesMasterId` (the test event was a one-off) — 32-B exercises the recurring path.

---

## Slice 32-A — See your Outlook meetings on Home and create a note from one

**Status:** Done (PR #320, deploy #620). Ships dark: `CALENDAR_PROVIDER` defaults to `google`; set it to `microsoft` and mint a token (see [guide](../guides/microsoft-calendar-token.md)) to activate.

**User value:** the owner opens Home and sees today's Outlook/M365 meetings in the existing meetings list, and clicks one to create a linked note — exactly the Phase 9 Google experience, now backed by their Microsoft calendar.

**How (mechanics):** extract a provider-agnostic `ICalendarClient` from `IGoogleCalendarClient` (keep the `CalendarEvent` record), add a Microsoft-backed day-view implementation, and select the provider by env var. `GetNextOccurrenceAsync` on the Microsoft client returns `null` (logged) until 32-B; the existing handler maps `null` to `no_future_occurrences` (404), so the recurring create-note path degrades gracefully with no unhandled 500.

### Scenarios

```
Scenario: Owner's Outlook meetings appear on Home when the provider is microsoft
  Given CALENDAR_PROVIDER=microsoft and a valid MS refresh token in SSM
  When  I open Home for a day with an Outlook meeting
  Then  the meetings list shows that meeting (subject, start, end)

Scenario: One-click create note from an Outlook meeting
  Given an Outlook meeting is shown on Home
  When  I click create-note on it
  Then  a note is created and NoteLinkedToCalendarEvent records the Graph instance id

Scenario: Google still works unchanged when the provider is google
  Given CALENDAR_PROVIDER=google (default)
  When  I open Home
  Then  behaviour is identical to Phase 9 (regression guard)

Scenario: Expired/revoked MS token degrades gracefully
  Given the MS refresh token is revoked
  When  I open Home
  Then  the response is calendar_unavailable (not a 500) and the failure is logged

Scenario: Missing Calendars.Read scope is not silently empty
  Given a token without Calendars.Read
  When  the day-view is fetched
  Then  the Graph ErrorAccessDenied is logged and reported calendar_unavailable, not an empty meeting list
```

### Acceptance criteria

1. `ICalendarClient` replaces `IGoogleCalendarClient` at every injection site (`CalendarHandlers`, `Builder.cs`, the stub → `StubCalendarClient`); Google impl renamed but behaviourally unchanged — all existing calendar specs/journeys stay green.
2. `MicrosoftCalendarClient.GetEventsForDayAsync` calls `/me/calendarView` with the day window in the caller's tz, `Prefer: outlook.timezone="UTC"`, maps every field per the table above, filters cancelled instances.
3. Refresh-token exchange mirrors Google: cached for process lifetime, force-reloaded from SSM once on `invalid_grant`, never crashes the request (`calendar_unavailable` on any auth/transport failure).
4. Provider selected by `CALENDAR_PROVIDER` (`google` default); DI binds exactly one `ICalendarClient`; the bound provider is logged at startup.
5. CDK: `MS_CLIENT_ID`, `MS_TENANT_ID`, `MICROSOFT_REFRESH_TOKEN_SSM_PATH`, `CALENDAR_PROVIDER` env vars; conditional SSM `GetParameter` grant scoped to the MS token-path ARN on the Command function, mirroring the existing Google grant (`AddToRolePolicy` is correct here — the Command function has no alias, so the `CurrentVersion`-hash freeze that motivates resource-grants elsewhere does not apply).
6. `GetNextOccurrenceAsync` on the MS client returns `null` (logged) until 32-B; the existing handler maps it to `no_future_occurrences` (404), so there is no unhandled 500.
7. `docs/guides/microsoft-calendar-token.md` documents minting the refresh token (run the committed device-code tool → `aws ssm put-parameter --overwrite`) and re-minting on `invalid_grant`, mirroring the Google guide.

### Observability

| Silent failure | Make visible |
|---|---|
| MS token expired/revoked | structured warn on `invalid_grant`, name the SSM path + the heal-retry outcome (mirror `GoogleCalendarClient`) |
| Missing/insufficient scope → `ErrorAccessDenied` | log the Graph error **code + body**; report `calendar_unavailable` — never collapse to an empty list |
| Off-by-one-day / wrong times (tz) | log the resolved local-day window `start:o–end:o` (Google already does) |
| Provider misconfig (`CALENDAR_PROVIDER` unset/typo) | log the bound provider at startup; default to `google` |
| Graph throttling (429) | honour `Retry-After`, bounded retry, log the throttle |

---

## Slice 32-B — Create a note for the next occurrence of a recurring Outlook meeting

**Status:** Done (PR #322, deploy #620/#622). **Phase 32 complete** — Outlook live in prod (`CALENDAR_PROVIDER=microsoft`).

**User value:** inside a recurring-meeting note, the owner clicks "next occurrence" and gets a note for the meeting's next future instance — the Phase 9 affordance, now working for Outlook recurring meetings.

**How (mechanics):** implement `MicrosoftCalendarClient.GetNextOccurrenceAsync` via Graph series instances, and remove the 32-A guard.

### Scenarios

```
Scenario: Create a note for the next occurrence of an Outlook recurring meeting
  Given a recurring Outlook meeting whose next instance is in the future
  When  I click "next occurrence" on its note
  Then  a note is created for the next instance with its start/end and instance id

Scenario: Series with no future instance
  Given a recurring meeting whose series has ended
  When  next-occurrence is requested
  Then  no note is offered (null), no error
```

### Acceptance criteria

1. `GetNextOccurrenceAsync(seriesMasterId, after)` queries Graph for the series' next instance after `after` (e.g. `/me/events/{seriesMasterId}/instances?startDateTime=…&endDateTime=…` over a bounded lookahead, ordered, first future instance), with `Prefer: outlook.timezone="UTC"`, mapped to `CalendarEvent`.
2. Returns `null` (not an error) when the series has no future instance within the lookahead.
3. Cancelled instances are filtered **client-side** via `isCancelled` (the Graph instances endpoint has no `ShowDeleted` equivalent, unlike Google), and the bounded lookahead + skip-cancelled guard against the cancelled-instance 404 trap (cf. the Google `Instances` guardrail in CLAUDE.md). `$top=10` assumes fewer than 10 leading cancellations.
4. The guarded `NotSupportedException` from 32-A is removed.

### Observability

| Silent failure | Make visible |
|---|---|
| Cancelled next instance → spurious empty/404 | filter cancelled server-side; log the resolved lookahead window |
| Series id not found / not recurring | log + return `null`, never 500 |
