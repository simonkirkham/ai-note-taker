# Phase 34-A — Connect Google Calendar in-app → server-side per-user token

**Shipped:** PR #326, deploy #626 (2026-06-23). Keystone of Phase 34; graduates the core of TI-47.
Replaces the out-of-band SSM calendar token with an in-app "Connect calendar" OAuth flow whose
refresh token is stored server-side per user. SSM kept as a coexistence fallback (retired in 34-D).
Ships **dark** — prod stays on Outlook; exercise via `CALENDAR_PROVIDER=google`.

## Non-obvious lessons (the why worth keeping)

### 1. An OAuth-redirect connect flow collides with the app's auth bootstrap — order the writes
A full-page OAuth redirect **drops the in-memory id_token**, so on return the app is unauthenticated
until a silent refresh (the `rt` cookie) restores it. But the connect endpoint needs the bearer. The
working sequence in `AuthContext`'s callback:
1. Detect the calendar-connect return by a **separate `state` marker** (`calendar_state`/
   `calendar_verifier`), distinct from sign-in's `pkce_state` — otherwise the sign-in exchange path
   grabs the calendar code.
2. Keep the gate in **`authLoading`** for the whole connect (computed in the `useState` initializer
   from `isCalendarConnectReturn`) so `MeetingsSection` isn't mounted and its connection query can't
   fire and read `needs_auth` mid-connect.
3. `attemptSilentRefresh()` → **`setToken()` (in-memory store) before the connect POST**, but
   **`setIdToken()` (React state) after**. The fetch client reads the in-memory store, not React
   state, so the POST is authenticated even though React state lags — and the app only reveals
   (mounts `MeetingsSection`) once the connect has persisted, so the first connection read returns
   `connected`. **Lesson:** with a redirect-based connect, the token-store write, the connect POST,
   and the React-state reveal must be ordered deliberately; conflating them races the status read.
- Graceful-degrade gap (tracked): if the silent refresh fails, the connect POST goes out
  unauthenticated (401, swallowed) and the user falls to sign-in — intent silently lost. Acceptable
  for 34-A; a later slice could short-circuit to sign-in first.

### 2. Per-user credentials force a singleton→scoped lifetime — and break the static cache
`GoogleCalendarClient` was a process-lifetime **singleton** with a `static` SSM-token cache (one
shared calendar). A per-user token can't be a process-global, so the client + its new
`IGoogleCalendarTokenSource` became **scoped** (resolve `ICurrentUser` per request). Safe because the
client is only consumed in per-request endpoint delegates (no singleton captures it). The
provider-selection unit test had to **resolve within a scope** and register the new deps once the
client went scoped. **Caveat:** the source still keeps a `static _ssmToken` for the *global* SSM
fallback — fine during coexistence, but **34-B must not extend this class** once tokens key by
workspace (cross-workspace footgun); it's removed at 34-D.

### 3. Store-first + SSM-fallback gives "reconnect vs re-mint" for free
`invalid_grant` force-reloads from the source once. For the **SSM fallback** that heals a re-mint
(re-reads SSM). For a **per-user stored token** the reload returns the same dead token unchanged → the
client gives up → the UI shows **"Reconnect"**. One retry loop, two correct behaviours, selected by
which source served the token. Coexistence (store-first, else SSM) means Phase 9 is unchanged while
unconnected — no big-bang auth cutover.

### 4. Authorize from the bearer, not the OAuth'd account
The connect endpoint stores under `ICurrentUser.UserId` (the signed-in `sub` from the validated
bearer), **never** a sub/email decoded from the OAuth id_token. The connected-account email is a
**display label only** (`JwtClaims`, unsigned decode) — so a user can't write another user's record
by connecting a different Google account. Connection status is a **strongly-consistent** point read
of the token store (not an async projection — avoids the BUG-30 authz-on-async-projection trap).

## Patterns that worked
- Reused `GoogleOAuthClient.ExchangeAuthCodeAsync` unchanged (scope is set at the authorize step, not
  the exchange) and the frontend `pkce.ts` machinery — only a calendar-scoped authorize URL + a
  marker were new. No new OAuth redirect-URI registration needed (the app-origin URI + the
  `calendar.readonly` consent already existed from the SSM-mint era).
- MSW test ordering: `/api/calendar/connection` handler must precede `/api/calendar/:date` (`:date`
  would match `connection`); a neutral default (`connected, email: null`) kept every pre-existing
  MeetingsSection test green (email null → falls back to the provider label; not needs_auth → keeps
  the "Cannot connect"/Retry path).

## Follow-up
- **34-B** — key the connection by workspace (`WorkspaceCalendarConnected` event); revisit the static
  SSM cache. **34-C** — Microsoft in-app connect + per-request `ICalendarClientFactory`. **34-D** —
  retire the SSM path + mint scripts.
- Dedup `JwtClaims` with `AuthEndpoints`' private base64url decoder in a later slice (left as the
  shared home; didn't refactor the tested sign-in path now).
