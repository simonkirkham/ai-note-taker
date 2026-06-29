# Phase 34-B — Key the calendar connection by workspace

Slice: keyed the calendar connection + meetings read by workspace (PR #327). Two follow-on fixes (#329, #330) were needed to land it cleanly in prod — both are the real lessons.

## Design decisions (refined the locked plan)

| Decision | Why |
|---|---|
| Token key is `(userId, workspaceId, provider)`, not `(workspaceId, provider)` | The default workspace id `__default__` is **shared across users**. Keying purely by workspace would leak the default workspace's calendar between users. `userId` stays the DynamoDB partition key (physical schema unchanged; SK holds `{workspaceId}#{provider}`) — no RETAIN-table replacement. |
| No new read projection (deviates from AC1) | Connection status + meetings resolve from the strongly-consistent `CalendarTokenStore` (RYW-safe). A projection would be async (needs gating) and nothing else reads it. Events are still recorded for 34-C's provider resolution. |
| `WorkspaceCalendarConnected/Disconnected` recorded for **non-default** workspaces only | The default has no per-user aggregate stream (`workspace-__default__` is shared). Best-effort: token written first (source of truth for reads), event append swallowed-and-logged on failure. |

## Lesson 1 — Relocating a route means relocating its TEST DOUBLES too

34-B moved `/calendar/*` under `/w/{workspaceId}`. Two test-double sites mirror the api client's prefix logic and both had to move in lockstep:

- **Backend** `tests/Api.Integration/ApiFactory.cs` `WorkspacePrefixStartupFilter` — add `/calendar` to `ScopedPrefixes`; drop the from-meeting routes from `GlobalExceptions`.
- **Frontend** `web/src/test/handlers.ts` — register calendar msw handlers via the existing `scoped()` helper (both `/api/calendar/*` and `/api/w/:wsId/calendar/*`).

Missing the msw one flaked deploy **#627**: full-App routing tests set the workspace store, so their calendar queries hit `/api/w/__default__/calendar/*` → unhandled by msw → network error → backoff retries. A retry firing **after** a test's `fetchSpy` was installed broke `TokenRefresh › does not call fetch when token is expired mid-session`. **Timing-dependent**, so the slice's own pre-merge runs (and a local full run) passed — it only bit in CI ordering. When you move a route prefix, grep the test doubles (`GLOBAL_PATH_PREFIXES`, `scoped(`, `ScopedPrefixes`, `GlobalExceptions`) and move them in the same slice.

## Lesson 2 — Frontend and a backend route-contract change MUST ship in the same backend deploy

The worst issue. Sequence that broke prod:

1. 34-B (#327) merged. Its deploy **#627 failed at `validate-frontend`** — *before* `deploy-production`. So the backend (API Gateway route pins + lambda code) never deployed.
2. The msw fix (#329) was **web-only**. Its deploy **#628** had `detect-changes backend=false` → `cdk deploy` **skipped**. But `frontend=true`, so the 34-B **frontend shipped**.
3. Prod now served the **new frontend** (`GET /w/{wsId}/calendar/connection`) against the **old backend** (only `/calendar/*` routes) → the new path fell through to `GET /{proxy+}` → Query Lambda → **404**. Home meetings + connection status broke. Verified live: new path `404`, old `/calendar/connection` `401`.
4. Fixed by #330 — a `src/**` (CDK) change forcing `detect-changes backend=true` so `cdk deploy --all` ran (#629) and the route pins + lambda landed.

**Rules this reinforces:**
- A slice that changes an **API route contract** has its frontend (web asset) and backend (lambda + API Gateway routes) on **independent deploy tracks**. If the backend half is skipped/failed while the frontend ships, prod breaks. After merging such a slice, **confirm the backend actually deployed** (`detect-changes backend=true` on the *shipping* run **and** verify the route in prod: `aws apigatewayv2 get-routes`), exactly as the CLAUDE.md infra-slice guardrail requires.
- A slice's own deploy failing **pre-`deploy-production`** (e.g. at `validate-frontend`) leaves the backend undeployed; a later **web/test-only** commit will NOT carry it (`backend=false`). It only ships on the next **`src/**`** push. `gh run rerun` replays the original (web-only) sha — it does **not** help.
- The deploy-gate flake and the route-contract split compounded: the frontend rode in on the *fix* for the flake. Prefer fixing a pre-production deploy failure with a change that **re-triggers the full backend deploy**, or explicitly push a backend no-op-but-real change to carry it.
