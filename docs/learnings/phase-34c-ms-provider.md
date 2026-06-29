# Phase 34-C — Microsoft as a connectable provider per workspace + per-request resolution

Slice: a workspace can be backed by Outlook or Google, chosen at connect time (A=Google, B=Outlook simultaneously). PR #331, deploy #630. Clean run — one Hawk round (APPROVE, one nit applied), single green backend+frontend deploy.

## What shipped

- `IMicrosoftOAuthClient` (in-app auth-code+PKCE, public client) + `MicrosoftCalendarTokenSource` (store-first, SSM fallback) — the Microsoft mirrors of the Google 34-A/B pieces.
- `ICalendarClientFactory.ForAsync(workspaceId)` replaces the startup-bound singleton `ICalendarClient`. Resolution: STUB → in-app Microsoft token → in-app Google token → `CALENDAR_PROVIDER` fallback. The two calendar handlers resolve via the factory per request.
- `POST …/calendar/connect/microsoft`; `…/calendar/connection` + a generic `POST …/calendar/disconnect` are provider-aware. One provider per workspace (connecting one deletes the other's token).
- Frontend provider-choice UI + Microsoft OAuth round-trip; `VITE_MS_CLIENT_ID` wired into both frontend builds.

## Key decisions

| Decision | Why |
|---|---|
| **No new domain events** | 34-B's `ConnectWorkspaceCalendar(workspaceId, provider, accountRef)` already carries the provider string — Microsoft connect just passes `provider="microsoft"`. |
| **`CALENDAR_PROVIDER` kept as the unconnected fallback (deviates from AC2)** | Prod is dark — served by the global Microsoft SSM token with zero in-app connections. Dropping it would break Home meetings. Strangle coexistence; **34-D** removes it with the SSM path. |
| **Provider resolved from the token store, not the aggregate event** | The `WorkspaceCalendarConnected` event is best-effort (34-B caveat); the token store is authoritative. |
| **Delete-other-BEFORE-upsert-new** (Hawk nit) | Resolution is Microsoft-first. If we upserted Google then a delete of a stale Microsoft token failed, the stale MS token would *shadow* the new Google connection. Delete-first means a failure leaves the workspace cleanly unconnected, never serving the wrong calendar. |

## Process win — the 34-B route-contract lesson held

34-B broke prod because its frontend shipped without its backend (a web-only flake-fix triggered `backend=false`). 34-C changed **both** backend (`src/**`, `deploy.yml`) and frontend (`web/**`) in the same merge, so `detect-changes` saw `backend=true` and `cdk deploy --all` carried both halves in one deploy (#630). New routes verified live in prod (`/calendar/connect/microsoft`, `/calendar/disconnect`, `/calendar/connection` all 401 unauth, not 404). The new connect/disconnect routes are **POST** → they ride the generic `/{proxy+}` integration, so unlike 34-B's GET pins they needed **no API Gateway route change** — only lambda code.

## Ships dark

The Microsoft in-app connect needs an Entra **SPA redirect URI** registered in the Azure app + a real MS account to exercise; `VITE_MS_CLIENT_ID` reuses the backend `MS_CLIENT_ID` secret. Until then prod keeps serving Microsoft via the SSM token (the `CALENDAR_PROVIDER=microsoft` fallback for the unconnected default workspace). The factory + per-workspace resolution + coexistence fallback are fully unit/integration-tested.
