# Phase 30 — Durable sign-in (no re-authorise)

**Goal:** Sign in behaves like a normal SSO app — the Google scope-approval ("re-authorise") screen is shown **once, ever**, never again on return. Achieved by persisting the Google refresh token **server-side** (keyed by the user's Google `sub`) instead of only in a browser cookie, so a returning user — even on a new browser, a cleared cookie, or after weeks away — is restored with a plain sign-in and no consent. The OAuth app is already **Published** (refresh tokens are long-lived; confirmed via the 15-day-old calendar token), so a stored token effectively never expires.

## Summary

| Slice | Summary | Status | Depends on |
|-------|---------|--------|------------|
| 30-A | Server-side refresh-token store; persist on sign-in and **restore from it** when Google returns no refresh token (returning, prompt-less login) | Done (PR #301, deploy #603) | — |
| 30-B | Stop forcing `prompt=consent` on returning sign-ins — frontend always omits it (first-ever authorization still consents once, via Google) | Not Started | 30-A |
| 30-C | BUG-33 fix — warm-tab refresh paths try the refresh before signing out on idle-return (visibility handler + scheduler) | Not Started | — |
| 30-D | `/auth/refresh` falls back to the server-side store when the cookie is absent (extends durability to the in-app 401-retry path) | Not Started | 30-A |

**Ordering:** 30-C is independent and can ship first (pure frontend, immediately reduces the symptom). 30-A is the architectural core; 30-B must follow 30-A (dropping forced consent before the store exists would break long sessions on a dead cookie). 30-D is hardening on top of 30-A.

**Root cause this phase fixes:** the refresh token lives **only** in the `rt` httpOnly cookie — there is no durable server-side copy. Any cookie loss (idle > 30 days, cleared cookies, new browser/device) leaves the backend with nothing, and the only way to obtain a new refresh token from Google is to force `prompt=consent` → the re-authorise screen. Normal SSO apps store the token server-side and consent once. See [BUG-33](phase-bugs.md#bug-33) for the immediate-symptom defect (30-C is its fix).

---

## 30-A — Server-side refresh-token store + restore on login

**Capability:** A returning user who signs in without the consent screen still gets a long-lived session — the backend restores the refresh token from its own store keyed by the user's Google `sub`.

**Design:**
- New `IRefreshTokenStore` with a DynamoDB implementation; table `notetaker-auth-tokens`, PK = `sub`, attribute `refreshToken`, SSE-KMS encrypted at rest, `RemovalPolicy.RETAIN`.
- `/auth/token` (Command Lambda): decode `sub` from the Google-issued `id_token` (trusted — fetched directly from Google over TLS); if the response carries a `refresh_token`, upsert it to the store; set the `rt` cookie from whichever token the backend now holds.
- When Google returns **no** `refresh_token` (returning user, no consent) but the store **has** one for that `sub` → load it, set the cookie from it, return the `id_token`. Session is long-lived with no consent.
- If a stored token is later rejected by Google on refresh (revoked) → delete it from the store; the next sign-in legitimately re-consents.
- IAM: Command Lambda granted read/write to the new table only (`table.GrantReadWriteData(commandFunction)`), via the resource-grant path (not a bare `AddToRolePolicy`).

**Scenarios (GWT):**
- Given a first-ever sign-in (consent shown, Google returns a refresh token) When `/auth/token` runs Then the token is stored keyed by `sub` and the cookie is set.
- Given a returning user with a stored token, signing in without consent (Google returns no refresh token) When `/auth/token` runs Then the cookie is restored from the store and the session is long-lived.
- Given a stored token Google now rejects as revoked When `/auth/refresh` runs Then the store entry is deleted and the response is 401 (next sign-in re-consents).
- Given no stored token and no refresh token from Google When `/auth/token` runs Then behaviour is unchanged (id_token returned, short session) — no regression.

**Acceptance criteria:**
- [ ] Refresh token persisted server-side keyed by `sub`, encrypted at rest.
- [ ] Returning prompt-less sign-in re-establishes the `rt` cookie from the store — no consent required.
- [ ] Revoked-token path deletes the store entry and surfaces 401, never 500.
- [ ] New table created in CDK with RETAIN + SSE; Infrastructure.Assertions covers the grant + encryption + no PutObject-style over-grant.
- [ ] Refresh token never returned to the browser or logged.

---

## 30-B — Stop forcing `prompt=consent` on returning sign-ins

**Capability:** The re-authorise screen never appears on a return visit.

**Design:** `signIn()` always builds the auth URL with `forceConsent = false` (drop the `!isRefreshEstablished()` forcing). First-ever authorization still shows consent (Google forces it regardless) and yields the refresh token 30-A stores; every later sign-in omits `prompt` → silent or account-pick only.

**Scenarios (GWT):**
- Given a returning user When they sign in Then the auth URL omits `prompt=consent` and no scope-approval screen is shown.
- Given a brand-new user (never authorized) When they sign in Then Google shows consent once and a refresh token is issued and stored (30-A).

**Acceptance criteria:**
- [ ] No sign-in path sends `prompt=consent`.
- [ ] The vestigial `google_refresh_established` forcing is removed (or always false); BUG-16's "no email on returning login" stays satisfied.
- [ ] E2E/unit assert the returning-user auth URL has no `prompt=` param.

---

## 30-C — BUG-33 fix: warm-tab refresh tries the cookie before signing out

**Capability:** Returning to an idle tab silently restores the session instead of bouncing to sign-in (and, pre-30-B, was wrongly forcing consent).

**Design:** Both paths attempt `attemptSilentRefresh()` first and only fail (clear token + flag) on a null result:
- `AuthContext.tsx onVisibilityChange`: collapse the `remaining <= 0` branch into the refresh-attempt branch.
- `useGoogleAuth.scheduleRefresh`: when `delay <= 0`, run a silent refresh immediately instead of calling `onRefreshFailure()`.

**Scenarios (GWT):**
- Given a backgrounded tab whose in-memory token has expired but whose `rt` cookie is valid When the tab becomes visible Then a silent refresh restores the session — no sign-in screen.
- Given the cookie is genuinely dead When the tab becomes visible Then sign-in is shown exactly as today (no regression).

**Acceptance criteria:**
- [ ] Red test in `TokenRefresh.test.tsx`: visibility refocus with an already-expired token recovers via the cookie (currently ends signed-out).
- [ ] No refresh path calls `handleRefreshFailure`/`onRefreshFailure` without first attempting a silent refresh.

---

## 30-D — `/auth/refresh` falls back to the server-side store

**Capability:** Even the in-app 401-retry refresh survives a missing cookie, as long as the request still identifies the user.

**Design:** When `/auth/refresh` finds no `rt` cookie but the request carries a valid `id_token` (Authorization header → `sub`), load the stored refresh token for that `sub`, refresh, and re-set the cookie. Absent both → 401 as today.

**Acceptance criteria:**
- [ ] Cookie-less refresh with a valid id_token restores the session from the store.
- [ ] No id_token and no cookie → 401 (unchanged).

---

## Observability

| Silent failure mode | Make visible |
|---|---|
| Store write fails on `/auth/token` (user silently loses durability) | Warn log + `RefreshTokenStoreWriteFault` metric; alarm on sustained > 0 |
| Stored token rejected/revoked by Google | Info log on delete-and-reconsent; count `RefreshTokenRevoked` |
| Restore-from-store path taken | Debug log "session restored from server-side token" (no token value) to confirm the no-consent path in prod |
| Cross-account caveat | The E2E env is a different AWS account than `--profile prod`; verify the new table + metrics in the env under test, not prod |

## Security

- Refresh tokens are long-lived credentials → table SSE-KMS encrypted; never returned to the client; never logged (log `sub` + outcome only).
- Least-privilege: only the Command Lambda role gets RW to `notetaker-auth-tokens`.
- `sub` decoded from a token fetched directly from Google's token endpoint over TLS — trusted without re-validation for the store key; the bearer middleware still validates id_tokens on every other endpoint.
