# Phase 34 — Per-workspace calendars (in-app connect, multi-account)

**Goal:** let each **workspace** back its meetings list with its own connected calendar account and provider — workspace A on a Google account, workspace B on Outlook — instead of one global calendar for the whole app. Get there by first replacing the out-of-band SSM refresh token with an **in-app "Connect calendar" OAuth flow** whose refresh token is stored **server-side per entity** (this graduates **[TI-47](../technical-improvements.md)**), then **keying that token + provider choice by workspace**, then making provider selection **per-request**. Strangle the global single-calendar model flow-by-flow — never a big-bang auth cutover.

## Summary

| Slice | Summary | Status | Depends on |
|-------|---------|--------|------------|
| 34-A | **Connect Google Calendar in-app → server-side per-user token** (keystone; TI-47 core). A "Connect calendar" button runs auth-code+PKCE; backend stores the refresh token server-side; the meetings read uses it (SSM fallback while unconnected). Google only, per-user. | Done | — |
| 34-B | **Key the calendar connection by workspace.** `WorkspaceCalendarConnected` event; connect associates with the current workspace; token + read resolve by `(userId, workspaceId)`. Two workspaces → two different Google accounts. | Done | 34-A |
| 34-C | **Add Microsoft as a connectable provider per workspace + per-request resolution.** In-app connect for Outlook; `ICalendarClientFactory.ForAsync(workspaceId)` resolves google/microsoft from the workspace's connection (`CALENDAR_PROVIDER` kept as the unconnected fallback → removed in 34-D). A=Google, B=Outlook. | Done | 34-B |
| 34-D1 | **Retire the Google SSM token path** — Google is fully in-app + proven, so drop the Google SSM fallback (`GoogleCalendarTokenSource` store-only), its `GOOGLE_REFRESH_TOKEN_SSM_PATH` env + conditional grant, and the Google mint script + guide. | Done | 34-C |
| 34-D2 | **Retire the Microsoft SSM path + `CALENDAR_PROVIDER` + remaining mint scripts** — the rest of the strangle cleanup. Unconnected workspace → `UnavailableCalendarClient` → "Connect calendar". | Done | 34-D1, Outlook in-app verified |
| 34-E | **ICS calendar feed provider** — connect a calendar via a published ICS feed URL (e.g. Outlook "Publish a calendar"), bypassing the M365 admin-consent wall. Third provider (`ics`) reusing the token store, factory, connect/connection/disconnect, and the CHANGE-25 menu. No new domain events. SSRF-guarded. | Done | 34-C |

Strictly sequential through 34-D (34-E is a follow-on provider, added after the strangle completed) — this is a **strangle** of the calendar-auth model (CLAUDE.md guardrail: prove the new path on one real call, then migrate flow-by-flow with old+new coexisting until the last flow moves). 34-A proves in-app-connect + server-side token on one real Google read; 34-B/C scale it to workspace-keyed and multi-provider; 34-D removes the old path only after nothing depends on it.

### Locked decisions

1. **In-app OAuth (auth-code + PKCE), not device-code/CLI.** A "Connect calendar" button redirects to the provider's consent; the backend exchanges the code and persists the **refresh token**. The Phase 32 device-code mint scripts stay only as a break-glass fallback until 34-D removes them.
2. **Server-side token store keyed by `(workspaceId, provider)`**, extending the existing `DynamoDbRefreshTokenStore` / auth-tokens table pattern (Phase 30 direction). 34-A keys by `sub` as the interim; 34-B re-keys by `workspaceId`. Encrypted at rest.
3. **Provider chosen per workspace via a new `WorkspaceCalendarConnected(workspaceId, provider, accountRef)` event** on the `Workspace` aggregate (purely additive); `WorkspaceCalendarDisconnected` clears it. Replaces the global `CALENDAR_PROVIDER` env. **One provider per workspace at a time** (merged calendars remain out of scope).
4. **Reuse, don't rebuild:** Phase 8's Google OAuth client + Phase 32's `MicrosoftCalendarClient`/Graph path are unchanged — only the *token source* (`ICalendarClient` already abstracts the rest) and *provider resolution* change.
5. **Each strangle step keeps old+new coexisting and every prior read flow reload-tolerant** (RYW: a freshly connected calendar must render on the next load; a freshly disconnected one must clear). Existing E2E journeys that read meetings stay green throughout.

### Deploy-time impact

**Neutral to slightly positive.** No new always-on infra; the per-entity token store reuses the existing auth-tokens table. 34-D *removes* SSM grants + env vars. No bake/canary. One-time prerequisite: register the in-app OAuth **redirect URI** for the calendar scope in Google Cloud Console (Phase 8 client) and the Entra app registration.

---

## Slice 34-A — Connect Google Calendar in-app → server-side per-user token

**Status:** Done (PR #326, deploy #626). Ships dark — prod stays on Outlook
(`CALENDAR_PROVIDER=microsoft`); exercise the Google in-app connect by temporarily setting
`CALENDAR_PROVIDER=google`. Table `notetaker-calendar-tokens` verified ACTIVE in prod.

**Follow-ups surfaced in review (non-blocking):**
- If the cold-session silent refresh fails during a calendar-connect return, the connect POST is
  issued unauthenticated (401, swallowed) and the user falls to sign-in — the connect intent is
  silently lost (graceful, no bad state). A later slice could short-circuit to sign-in before the
  wasted POST and preserve intent.
- `GoogleCalendarTokenSource._ssmToken` is a process-wide `static` cache — correct for the single
  global SSM token during coexistence, but **34-B must not extend this class without revisiting**
  (it becomes a cross-workspace footgun once tokens key by workspace). Self-resolves at 34-D when
  the SSM path is removed.

**User value:** the owner clicks "Connect calendar", signs in once in-app (no CLI, no SSM), and their Google meetings appear on Home — the token now lives server-side, refreshed automatically.

**How (mechanics):** add a `GET /calendar/connect/google` (auth-code + PKCE, `calendar.readonly` + `offline_access`) and a `…/callback` that exchanges the code server-side and persists the refresh token in a `CalendarTokenStore` keyed by user `sub`. `GoogleCalendarClient`'s token source reads the stored token first, falling back to the existing SSM token while unconnected. A "Connect calendar" affordance shows when no token is stored; "Connected as …" when it is.

### Scenarios
```
Scenario: Connect Google Calendar in-app
  Given I have not connected a calendar
  When  I click "Connect calendar" and grant Google consent
  Then  my refresh token is stored server-side and my meetings render on Home

Scenario: Reads use the stored token, not SSM
  Given I have connected my Google calendar in-app
  When  the meetings list loads
  Then  the access token is minted from the stored refresh token (SSM is not read)

Scenario: Falls back to SSM while unconnected (coexistence)
  Given I have not connected in-app but an SSM token exists
  When  the meetings list loads
  Then  behaviour is identical to Phase 9 (no regression)

Scenario: Expired/revoked stored token degrades gracefully
  Given my stored refresh token is revoked
  When  the meetings list loads
  Then  the response is calendar_unavailable and the UI offers "Reconnect" (no 500)
```

### Acceptance criteria
1. `GET /calendar/connect/google` starts auth-code+PKCE for `calendar.readonly offline_access`; the callback exchanges the code **server-side** and stores the refresh token in `CalendarTokenStore` keyed by `sub` (encrypted at rest).
2. `GoogleCalendarClient` resolves its refresh token from `CalendarTokenStore` first, then the SSM path (coexistence); the bound source is logged.
3. `invalid_grant` on the stored token → `calendar_unavailable` + a "Reconnect" affordance; never a 500 (mirrors Phase 32 self-heal, minus the SSM reload).
4. A connection-status read (`GET /calendar/connection`) drives "Connect calendar" vs "Connected as {email}"; reload-tolerant (RYW) so it reflects a just-completed connect.
5. No frontend secret; PKCE verifier + state held server-side per the Phase 8 pattern; the calendar redirect URI is registered.

### Observability
| Silent failure | Make visible |
|---|---|
| Code exchange fails (bad redirect/scope) | log the provider error code + body; surface "couldn't connect", not a blank state |
| Stored token revoked | structured warn on `invalid_grant` naming the store key + user; UI "Reconnect" |
| Read silently falls back to SSM when in-app expected | log which source served the token (stored vs ssm) |

---

## Slice 34-B — Key the calendar connection by workspace

**Status:** Done (PRs #327 + #329 + #330, deploy #629). Shipped via three deploys — see
[`docs/learnings/phase-34b-workspace-calendar.md`](../learnings/phase-34b-workspace-calendar.md):
#327's deploy flaked at the frontend gate (un-`scoped()` calendar msw handlers), and the web-only
flake-fix shipped the frontend without the backend (404 in prod) until a backend push (#330) carried
the route pins. Prod verified: `/w/{workspaceId}/calendar/*` routes live (401 auth-gated), old
`/calendar/*` removed.

**As-built decisions (refine the locked decisions; agreed with user):**
1. **Token key is `(userId, workspaceId, provider)`, not `(workspaceId, provider)`.** The default workspace id `__default__` is shared across users, so keying purely by workspace would leak the default workspace's calendar between users. Physical DynamoDB schema unchanged (SK holds `{workspaceId}#{provider}`) to avoid a RETAIN-table replacement.
2. **No new read projection (deviates from AC1).** Connection status + meetings resolve from the strongly-consistent `CalendarTokenStore` (RYW-safe); the `WorkspaceCalendarConnected/Disconnected` events are still recorded for the per-workspace provider choice 34-C needs.
3. **Events recorded for NON-default workspaces only** — the default has no per-user aggregate stream. Best-effort: token written first (source of truth for reads), event append swallowed-and-logged on failure.
4. Calendar routes moved under `/w/{workspaceId}` (incl. `/notes/from-meeting`, `/notes/from-next-occurrence`); the Command-pinned calendar GET routes updated in CDK so they don't fall through to the Query Lambda.

**User value:** different workspaces show different calendars — connect a work Google account in one workspace and a personal one in another.

**How (mechanics):** add `WorkspaceCalendarConnected(workspaceId, provider, accountRef)` + `WorkspaceCalendarDisconnected` to the `Workspace` aggregate; the connect callback records the event for the current workspace and stores the token keyed by `workspaceId`; the meetings read resolves the token by the request's workspace. `accountRef` (email) drives "Connected as …".

### Scenarios
```
Scenario: Two workspaces hold two different calendars
  Given workspace A is connected to calendar-a@gmail and workspace B to calendar-b@gmail
  When  I view meetings in A, then switch to B
  Then  A shows calendar-a's meetings and B shows calendar-b's

Scenario: Disconnect clears one workspace only
  Given both A and B are connected
  When  I disconnect the calendar in A
  Then  A shows "Connect calendar" and B is unaffected

Scenario: A workspace with no connection
  Given workspace C has never connected a calendar
  When  I view meetings in C
  Then  I see "Connect calendar" (not another workspace's meetings)
```

### Acceptance criteria
1. `WorkspaceCalendarConnected`/`Disconnected` events on the `Workspace` aggregate (additive, versioned-safe); a projection exposes per-workspace connection status.
2. The connect callback writes the event for the **current** workspace and stores the token keyed by `workspaceId`; the read resolves by `workspaceId` (never leaks another workspace's calendar — authorize from the strongly-consistent source, not an async projection — cf. CLAUDE.md authz guardrail).
3. Disconnect removes the token + records the event for that workspace only.
4. Connection status + meetings reads are workspace-scoped and reload-tolerant (RYW across workspace switch).

### Observability
| Silent failure | Make visible |
|---|---|
| Cross-workspace token leak | assert workspace ownership at read; log workspace + resolved account |
| Connect recorded against the wrong workspace | log `workspaceId` at connect; status read confirms |

---

## Slice 34-C — Microsoft as a connectable provider per workspace + per-request resolution

**Status:** Done (PR #331, deploy #630). Backend + frontend shipped together in one deploy (the 34-B
route-contract lesson held); new routes verified live in prod (401 unauth, not 404). Ships dark —
the MS in-app connect needs an Entra SPA redirect URI. See
[`docs/learnings/phase-34c-ms-provider.md`](../learnings/phase-34c-ms-provider.md).

**As-built decisions (refine the ACs; agreed with user):**
1. **`CALENDAR_PROVIDER` is kept as the *unconnected* fallback, not dropped (deviates from AC2).** Prod is dark — it serves Microsoft via the global SSM token with zero in-app connections; dropping it now would break Home meetings. `ICalendarClientFactory.ForAsync` resolves: STUB → in-app Microsoft token → in-app Google token → `CALENDAR_PROVIDER` fallback. **34-D** removes it with the SSM path (strangle coexistence).
2. **Provider resolved from the token store, not the aggregate** (the 34-B best-effort-event caveat) — the in-app connection is authoritative.
3. **One provider per workspace enforced at connect time** (decision #3): connecting one provider deletes the other's token.
4. **Generic `POST …/calendar/disconnect`** (replaces the per-provider `…/disconnect/google`) — clears whichever provider the workspace holds. `GET …/calendar/connection` is now provider-aware (`provider` is null when unconnected).
5. **No new domain events** — 34-B's `ConnectWorkspaceCalendar(workspaceId, provider, accountRef)` already carries the provider string.
6. **The Microsoft in-app connect ships dark** — needs an Entra **SPA redirect URI** registered in the Azure app + `VITE_MS_CLIENT_ID` (reuses the backend `MS_CLIENT_ID` secret) to exercise. The factory + per-workspace resolution + coexistence fallback are fully tested.

**Carried over from 34-B review:** 34-B records `WorkspaceCalendarConnected` **best-effort** (the token store is written first and is the source of truth for reads; a failed event append only logs). So a workspace can exist where the token store says "connected" but the aggregate has no connection event. 34-C's `ICalendarClientFactory.For(workspaceId)` must therefore resolve the provider from the **token store** (authoritative), or treat a missing aggregate connection as a re-emit trigger — never assume the event is present whenever a token is.

**User value:** a workspace can be backed by **Outlook** instead of Google, chosen at connect time — A on Google, B on Outlook, simultaneously.

**How (mechanics):** add in-app connect for Microsoft (auth-code+PKCE, `Calendars.Read offline_access`); replace the startup-bound singleton `ICalendarClient` + global `CALENDAR_PROVIDER` with `ICalendarClientFactory.For(workspaceId)` that resolves google/microsoft from the workspace's `WorkspaceCalendarConnected` provider and the workspace-keyed token. The CHANGE-21 source label now reflects each workspace.

### Scenarios
```
Scenario: Connect Outlook in one workspace, Google in another
  Given workspace A is connected to Google and workspace B connects to Outlook
  When  I view meetings in each
  Then  A reads via Graph-less Google and B via Microsoft Graph, labelled accordingly

Scenario: Provider resolved per request, not per process
  Given A=google and B=microsoft
  When  requests for A and B are served by the same warm Lambda
  Then  each resolves its own provider + token (no global state)
```

### Acceptance criteria
1. `GET /calendar/connect/microsoft` mirrors the Google connect (auth-code+PKCE, server-side exchange, token keyed by `workspaceId`).
2. `ICalendarClientFactory.For(workspaceId)` returns a Google- or MS-backed `ICalendarClient` per the workspace's connected provider + token; the global `CALENDAR_PROVIDER` env is removed; `STUB_CALENDAR_JSON` still forces the stub.
3. Handlers resolve the client via the factory per request; the provider label (CHANGE-21) reflects the workspace's provider.
4. Recurring next-occurrence (32-B) and create-note flows work for whichever provider the workspace uses.

### Observability
| Silent failure | Make visible |
|---|---|
| Wrong provider resolved for a workspace | log resolved provider + workspace per request |
| Factory falls back to a default on misconfig | log the resolution decision; never silently pick a provider |

---

## Slice 34-D — Retire the out-of-band SSM token path + mint scripts

**Re-sliced into 34-D1 (Google, done) + 34-D2 (Microsoft, blocked).** The retirement must be done provider-by-provider: a provider's SSM path can only be removed once its in-app connect is *proven*, per the strangle guardrail. Google in-app is verified; Outlook in-app is not (Entra SPA redirect URI pending), so removing the Microsoft SSM fallback now would strand Outlook-backed workspaces.

### Slice 34-D1 — Retire the Google SSM token path

**Status:** Done (PR #339, deploy #640). Google in-app connect verified working in prod, so the Google SSM fallback is dead and removed. Prod verified: the command Lambda's env no longer has `GOOGLE_REFRESH_TOKEN_SSM_PATH` (the Microsoft one remains). The deploy first flaked on an unrelated `NoteReadYourWritesJourney` E2E (the chronic TI-42/TI-39 cold-projector flake); a `gh run rerun --failed` cleared it.

- `GoogleCalendarTokenSource` reads only `CalendarTokenStore` (store-only; SSM fallback + static cache gone).
- CDK drops the `GOOGLE_REFRESH_TOKEN_SSM_PATH` env var + its conditional `ssm:GetParameter` grant; `deploy.yml` stops passing it; infra assertions updated (env absent; the remaining SSM grant is Microsoft's).
- `scripts/remint-google-refresh-token.mjs` + `docs/guides/google-calendar-token.md` removed (git history retains them as break-glass reference).
- An unconnected workspace under `CALENDAR_PROVIDER=google` now cleanly returns `calendar_unavailable` (no SSM). Prod is `CALENDAR_PROVIDER=microsoft`, so this path is unconnected-Google only.

### Slice 34-D2 — Retire the Microsoft SSM path + `CALENDAR_PROVIDER` + remaining mint scripts

**Status:** Done (PR #340, deploy #641). Outlook in-app connect verified in prod, so the last SSM fallback is removed — **Phase 34 is complete** (calendars fully in-app, per workspace, multi-provider, no long-lived SSM secret). Prod verified: command Lambda env has no `CALENDAR_PROVIDER`/`MICROSOFT_REFRESH_TOKEN_SSM_PATH` (MS_CLIENT_ID retained); no `ssm:GetParameter` grant.

### Acceptance criteria (34-D2)
1. ✅ `MicrosoftCalendarTokenSource` reads only `CalendarTokenStore`; `SsmMicrosoftRefreshTokenSource` deleted. Store failure degrades to null (calendar_unavailable), mirroring Google (34-D1).
2. ✅ Factory's `CALENDAR_PROVIDER` fallback removed — an unconnected workspace resolves to `UnavailableCalendarClient` → `calendar_unavailable` → the CHANGE-25 "Connect calendar" menu. `CALENDAR_PROVIDER` env + the Microsoft SSM grant/env dropped from CDK; `MS_CLIENT_ID`/`MS_TENANT_ID` kept (in-app OAuth + Graph exchange). Infra assertions assert no SSM grant + `CALENDAR_PROVIDER` absent.
3. ✅ `scripts/mint-microsoft-refresh-token.mjs` + `docs/guides/microsoft-calendar-token.md` removed (git history retains them).
4. Prod verified at Scribe: the command Lambda env has no `CALENDAR_PROVIDER`/`MICROSOFT_REFRESH_TOKEN_SSM_PATH` and its role has no `ssm:GetParameter`.

### Observability
| Silent failure | Make visible |
|---|---|
| A flow still silently depends on SSM after removal | a real read per provider in prod confirms `calendar_unavailable` does not appear; alarm on it |

---

## Slice 34-E — ICS calendar feed provider

**Status:** Done (PR #343, deploy #644). Prod route `POST /w/{workspaceId}/calendar/connect/ics` verified live (401 unauth). Hawk caught + fixed a real SSRF redirect bypass (`AllowAutoRedirect=false`) + an OOM vector (5 MB body cap); the DNS-rebinding TOCTOU is an accepted, documented residual (ConnectCallback follow-up). Adds the `Ical.Net` dependency.

**Goal:** connect a workspace's calendar via a **published ICS feed URL** (e.g. Outlook "Publish a calendar") instead of OAuth — bypassing the Microsoft admin-consent wall that blocks `connect/microsoft` for locked-down M365 tenants. A third provider (`ics`) alongside `google`/`microsoft`, reusing **all** existing machinery: the token store, the factory, connect/connection/disconnect, and the CHANGE-25 Calendar-settings menu.

**User value:** a user whose IT won't grant Graph consent pastes their calendar's public ICS link into Calendar settings → Save, and their meetings appear on Home — no admin, no OAuth.

### As-built decisions
1. **No new domain events.** `provider` is already a free string (34-C), so the `ics` token rides the existing `(userId, workspaceId, provider)` store and `WorkspaceCalendarConnected(workspaceId, "ics", null)` event. The feed URL is stored as the token's `RefreshToken`; `Email` is null (a feed carries no account identity).
2. **One provider per workspace generalised to three.** Connecting *any* provider deletes the other two of `{google, microsoft, ics}` (delete-first, before the upsert).
3. **SSRF guard (`IcsUrlValidator`) + client hardening.** The feed URL is user-supplied and fetched server-side. `IsAllowed`: absolute **https** only; host resolved via DNS; reject if *any* resolved address is loopback / RFC1918 private / link-local (incl. `169.254.169.254` metadata) / unique-local / CGNAT / 0.0.0.0/8 / 240.0.0.0/4. Applied at connect time **and** before every fetch. Both ICS HttpClients set **`AllowAutoRedirect = false`** (a feed can't `302` to an internal/metadata address — a 3xx fails the success check → `calendar_unavailable`/`invalid_feed`) and a **5 MB `MaxResponseContentBufferSize`** (a giant/streaming feed can't OOM the Lambda). **Known accepted residual (single-user app):** `IsAllowed` is a check-then-fetch (TOCTOU) — HttpClient re-resolves DNS for the actual GET, so a DNS-rebinding host that answers public at validation and private at fetch is not fully closed. Fully closing it needs a `SocketsHttpHandler.ConnectCallback` that validates the connected IP and dials it directly — a documented follow-up (Hawk #2, accepted for now).
4. **Graceful degradation.** Any fetch/parse/HTTP error in `IcsFeedCalendarClient` returns null (→ `calendar_unavailable`), never throws — the meetings GET handler maps null but has no catch (the 34-D1 lesson).
5. **v1 fetch-per-request, no caching** (10s typed-HttpClient timeout); per-request caching is a possible follow-up (noted in code).
6. **Occurrence mapping (Ical.Net 5.2.3):** `Calendar.Load` parses the feed; `calendar.GetOccurrences(windowStart)` lazily expands recurrences ascending by start — iterate, stop at the first occurrence `>=` the window end. Each occurrence's `Source` is the VEVENT: `CalendarEventId = "{UID}::{occurrenceStartUtc:yyyyMMddTHHmmssZ}"` (a single UID is shared by all instances, so the start makes it unique); `Title = Summary` or `"(No title)"`; Start/End from `Period.StartTime.AsUtc` / `Period.EffectiveEndTime.AsUtc` (the occurrence `EndTime` is null — `EffectiveEndTime` derives it from the source duration); skip `STATUS:CANCELLED` (occurrences are still emitted for cancelled sources, so filter by `Source.Status`); `IsRecurring`/`RecurringSeriesId = UID` when the source has an RRULE or RDATEs. Timezone: the local-day window is computed in the requested IANA zone (mirrors the Microsoft client) and compared against each occurrence's UTC instant.
7. **`GetNextOccurrenceAsync`:** expand over `[after, after+400d]`, return the first non-cancelled occurrence whose `Source.Uid == recurringSeriesId`, `RecurringSeriesId` forced to the UID; else null.
8. **Connect validation fetch.** `POST /calendar/connect/ics` does a one-time fetch+parse so a connect either yields a usable feed or fails loudly (`invalid_feed`, 400) instead of silently at the next read; a URL rejected by the SSRF guard returns `invalid_request` (400).

### Scenarios
```
Scenario: Connect a calendar feed via ICS URL
  Given my workspace has no calendar connected
  When  I open Calendar settings, paste a public ICS feed URL, and click Save
  Then  the URL is stored as my "ics" connection and my meetings render on Home

Scenario: Connecting ICS replaces any existing provider
  Given my workspace is connected to Google
  When  I connect a calendar feed (ICS)
  Then  the Google token is cleared and the connection reads provider = ics

Scenario: A private/loopback/metadata URL is refused
  When  I submit an http, loopback, RFC1918, or 169.254.169.254 URL
  Then  connect returns 400 invalid_request and nothing is stored

Scenario: An unparseable feed is refused at connect
  When  I submit an https URL that does not return valid ICS
  Then  connect returns 400 invalid_feed and nothing is stored

Scenario: Recurring events expand for the viewed day
  Given my ICS feed has a weekly series and a one-off, with one cancelled instance
  When  I view a day the series falls on
  Then  the series instance and the one-off appear; the cancelled instance does not

Scenario: A failing feed degrades gracefully
  Given my "ics" feed URL later 404s or returns garbage
  When  the meetings list loads
  Then  it shows calendar_unavailable, never a 500
```

### Acceptance criteria
1. `IcsFeedCalendarClient` resolves the feed URL from the `ics` token, expands occurrences for the local day, skips cancelled, flags recurring with `RecurringSeriesId = UID`, and returns null on any fetch/parse failure (never throws).
2. `IcsUrlValidator` rejects non-https/non-absolute/unresolvable/loopback/private/link-local/metadata URLs and accepts a public https URL; applied at connect and per-fetch.
3. `POST /calendar/connect/ics` validates (SSRF → 400 `invalid_request`; parse → 400 `invalid_feed`), stores the URL, clears the other two providers, records `ConnectWorkspaceCalendar(..., "ics", null)` for non-default workspaces, returns `{ connected, provider = "ics" }`.
4. `GET /calendar/connection` returns `provider = "ics"` when set (order: microsoft, google, ics); `POST /calendar/disconnect` clears the `ics` token; the factory resolves a stored `ics` token to `IcsFeedCalendarClient`.
5. Frontend: the Calendar-settings menu exposes "Connect calendar feed (ICS)" → URL input + Save (`connectIcsCalendar`), invalidating the connection + meetings queries; `providerLabel('ics') = "Calendar feed"`; Disconnect shows for any connected provider (ICS has no email).

### Observability
| Silent failure | Make visible |
|---|---|
| Feed URL fetch fails (timeout, 404, garbage) | client logs a warning per failure with the operation + status; read returns `calendar_unavailable` (not a 500) |
| A stored feed later resolves to a private/metadata address (DNS rebinding) | per-fetch SSRF re-validation logs a warning and refuses; never fetched |
| Connect rejected | endpoint logs whether it was the SSRF guard (`invalid_request`) or the parse (`invalid_feed`) |
