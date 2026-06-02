# Phase 8 — Google Sign-In (multi-user auth)

**Goal:** Secure the API and UI with real Google authentication. Replace the hardcoded single-user ID with a verified identity from a Google ID token. Every API request requires a valid bearer token; the authenticated user's `sub` claim becomes the canonical user ID throughout the system.

## Summary

| Slice | Summary | Status | Depends on |
|-------|---------|--------|------------|
| 8-A | CDK and CORS wiring (`GOOGLE_CLIENT_ID`, allow `Authorization` header) | Done | — |
| 8-B | Google Sign-In on the frontend (PKCE; ID token forwarded as Bearer) | Done | — |
| 8-C | JWT verification in the API (`ICurrentUser` from `sub` claim) | Done | 8-A, 8-B |
| 8-D | Wire userId into the domain (`EventMetadata.UserId`, projection keys scoped) | Done | 8-C |

8-A and 8-B can run in parallel; 8-C depends on both; 8-D follows 8-C.

**Learning surface:** Google OAuth2 authorisation code flow with PKCE; OpenID Connect ID token validation; ASP.NET Core JWT Bearer middleware; JWKS endpoint and key rotation; extracting user claims in a minimal API; multi-user data isolation via user-scoped projection keys; wiring CORS for credentialed cross-origin requests; testing authenticated endpoints with fake tokens.

---

## What is already in place

- `EventMetadata` carries a `UserId` field (currently always `null` — reserved per ADR 0005). Phase 8 starts populating it from the authenticated user's `sub` claim.
- All aggregate stream keys and projection row keys already include a `userId` segment (hardcoded). Switching to a real user ID is a wiring change, not a model change.
- The CDK stack deploys API Gateway + Lambda; CORS is already configured for the CloudFront origin.
- All five test layers are in place. `ICurrentUser` must be an injectable interface from day one so `Api.Integration` tests run without real Google credentials.

What is **not** yet in place:

- No authentication middleware in the ASP.NET pipeline.
- No JWT Bearer validation or JWKS fetching.
- No `ICurrentUser` abstraction.
- No Google Sign-In button or OAuth flow in the frontend.
- No Authorization header forwarded with API requests.

---

## Slice 8-A — CDK and CORS wiring

**Status:** Done

**Value:** The deployed Lambda accepts the `Authorization` header from the CloudFront origin. `GOOGLE_CLIENT_ID` is available to both the Lambda (for token audience validation) and the frontend build.

**No application logic.** This slice is pure CDK and `Infrastructure.Assertions` updates.

**Changes in scope:**

- Lambda env vars: `GOOGLE_CLIENT_ID` (OAuth2 client ID from GCP) and `ALLOWED_USER_SUBS` (comma-separated list of permitted Google `sub` values)
- CORS: `Authorization` is already accepted — CORS is handled by ASP.NET Core's `AllowAnyHeader()` (not at API Gateway). No CDK change needed; this is not testable via a CloudFormation template assertion.
- Frontend env var: `VITE_GOOGLE_CLIENT_ID` passed via the `npm run build` step in CI (added in 8-B)
- `Infrastructure.Assertions` tests updated for both Lambda env vars
- Both secrets wired into `cdk deploy` in CI for both `deploy` and `deploy-production` jobs

**Key implementation files:**

- `src/Infrastructure/NoteTakerStackProps.cs` — add `GoogleClientId` and `AllowedUserSubs` optional props
- `src/Infrastructure/Program.cs` — read `GOOGLE_CLIENT_ID` and `ALLOWED_USER_SUBS` from env, pass to stack props
- `src/Infrastructure/NoteTakerStack.cs` — add both to Lambda `Environment` dictionary (always present, defaults to `""` when unset so the runtime can distinguish "not configured" without a key-missing exception)
- `.github/workflows/deploy.yml` — add both secrets to CDK deploy steps
- `tests/Infrastructure.Assertions/` — two new assertions for both env vars

**Scenarios:**

```
Scenario: Lambda has GOOGLE_CLIENT_ID env var
  Given the CDK stack is synthesised
  When  the CloudFormation template is examined
  Then  the Lambda has a GOOGLE_CLIENT_ID environment variable

Scenario: Lambda has ALLOWED_USER_SUBS env var
  Given the CDK stack is synthesised
  When  the CloudFormation template is examined
  Then  the Lambda has an ALLOWED_USER_SUBS environment variable
```

**Acceptance criteria:**

- [x] `GOOGLE_CLIENT_ID` env var present on the Lambda in `cdk synth` output
- [x] `ALLOWED_USER_SUBS` env var present on the Lambda in `cdk synth` output
- [x] `Authorization` already accepted by CORS — covered by `AllowAnyHeader()` in ASP.NET; no CDK assertion needed
- [x] `dotnet test tests/Infrastructure.Assertions/` — all green
- [x] `cdk synth` exits 0

---

## Slice 8-B — Google Sign-In on the frontend

**Status:** Done

**Value:** The user can sign in with their Google account. The ID token is stored in memory and forwarded as a bearer token on every API request. An unauthenticated user sees only the sign-in screen.

**Backend changes:** none in this slice — the API still accepts all requests (auth enforcement lands in 8-C).

**How the PKCE flow works:**

1. User clicks "Sign in with Google."
2. Frontend redirects to Google's authorisation endpoint with `response_type=code`, `code_challenge` (PKCE), `scope=openid email profile`.
3. Google redirects back with an authorisation code.
4. Frontend exchanges the code for tokens at Google's token endpoint (POST from the browser — no server component needed for PKCE).
5. ID token stored in memory (`useRef` or React context — never `localStorage`).
6. All `fetch` calls in `api.ts` include `Authorization: Bearer <idToken>`.
7. On token expiry (1-hour lifetime), silently re-initiate the flow in the background using `prompt=none`.

**Key implementation files:**

- `web/src/auth/useGoogleAuth.ts` — new hook: manages PKCE flow, token storage, silent refresh
- `web/src/auth/AuthContext.tsx` — new context: provides `{ user, idToken, signIn, signOut }` to the tree
- `web/src/components/SignInPage.tsx` — new: renders the "Sign in with Google" button; shown when not authenticated
- `web/src/api.ts` — all fetch calls accept an `idToken` parameter (or read from context); add `Authorization: Bearer` header
- `web/src/App.tsx` — wrap with `AuthProvider`; gate all routes on `isAuthenticated`

**Scenarios:**

```
Scenario: Unauthenticated user sees the sign-in screen
  Given I am not signed in
  When  I open the app
  Then  the sign-in screen is shown and the note list is not visible

Scenario: Signed-in user sees the app
  Given I complete the Google Sign-In flow
  When  the redirect returns with a valid authorisation code
  Then  the home screen is shown

Scenario: API calls include the bearer token
  Given I am signed in with ID token "id-tok-abc"
  When  any API call is made
  Then  the request includes Authorization: Bearer id-tok-abc

Scenario: Sign out clears the session
  Given I am signed in
  When  I click Sign Out
  Then  the sign-in screen is shown and the ID token is cleared from memory
```

**Acceptance criteria:**

- [x] Unauthenticated users see only the sign-in screen
- [x] Sign-in completes via PKCE; ID token stored in memory only
- [x] All API calls include `Authorization: Bearer <idToken>`
- [x] Sign-out clears the token and returns to the sign-in screen
- [x] Token never written to `localStorage` or `sessionStorage`

---

## Slice 8-C — JWT verification in the API

**Status:** Done

**Value:** The API rejects any request without a valid Google-issued ID token. The authenticated user's `sub` claim is available to every endpoint handler.

**How verification works:**

- `AddAuthentication().AddJwtBearer()` with Google's OIDC discovery URL (`https://accounts.google.com/.well-known/openid-configuration`).
- Middleware validates: signature (against Google JWKS), `aud` (must match `GOOGLE_CLIENT_ID`), `iss`, expiry.
- A second middleware step checks the `sub` claim against `ALLOWED_USER_SUBS` (comma-separated env var). Returns 403 if the sub is not in the list. This is **authorisation**, separate from JWT **authentication** — a valid token from an unknown user is still rejected.
- All endpoints protected via `app.UseAuthentication(); app.UseAuthorization(); endpoints.RequireAuthorization()`.
- `ICurrentUser` interface injected into handlers; production implementation reads `sub` from `ClaimsPrincipal`.

```csharp
// src/Api/Auth/ICurrentUser.cs
public interface ICurrentUser
{
    string UserId { get; }
}
```

For `Api.Integration` tests: `FakeCurrentUser` returns a fixed test user ID; JWT middleware is replaced with a `TestAuthHandler` that accepts a custom `X-Test-User-Id` header; `ALLOWED_USER_SUBS` is set to the test user ID so the allowlist check passes.

**Key implementation files:**

- `src/Api/Auth/ICurrentUser.cs` — new interface
- `src/Api/Auth/CurrentUser.cs` — new: reads `sub` from `ClaimsPrincipal`
- `src/Api/Auth/AllowlistMiddleware.cs` — new: reads `ALLOWED_USER_SUBS` from config; returns 403 if `sub` not in list
- `src/Api/Auth/FakeCurrentUser.cs` — in `tests/Api.Integration/`; returns fixed test user ID
- `src/Api/Builder.cs` — `AddAuthentication().AddJwtBearer(...)` with Google OIDC options; register `ICurrentUser`; `UseAuthentication()` + `UseAuthorization()` + `UseMiddleware<AllowlistMiddleware>()`
- `src/Api/Endpoints/` — add `.RequireAuthorization()` to all route groups
- `tests/Api.Integration/` — `TestAuthHandler` replaces JWT middleware; `ALLOWED_USER_SUBS` set to test user ID; all existing tests pass

**Scenarios:**

```
Scenario: Request without a token is rejected
  Given no Authorization header is present
  When  GET /notes is called
  Then  401 Unauthorized is returned

Scenario: Request with an invalid token is rejected
  Given the Authorization header contains a tampered JWT
  When  GET /notes is called
  Then  401 Unauthorized is returned

Scenario: Request from an allowed user is accepted
  Given a valid Google ID token with sub "allowed-sub-123"
  And   ALLOWED_USER_SUBS contains "allowed-sub-123"
  When  GET /notes is called
  Then  200 is returned

Scenario: Request from a non-allowlisted user is rejected
  Given a valid Google ID token with sub "stranger-sub-456"
  And   ALLOWED_USER_SUBS does not contain "stranger-sub-456"
  When  GET /notes is called
  Then  403 Forbidden is returned

Scenario: ICurrentUser.UserId contains the sub claim
  Given a valid token with sub "allowed-sub-123"
  When  any endpoint handler resolves ICurrentUser
  Then  UserId is "allowed-sub-123"
```

**Acceptance criteria:**

- [x] All endpoints return 401 when no/invalid token is provided
- [x] Valid token from a non-allowlisted sub returns 403
- [x] Valid token from an allowlisted sub returns 200; `ICurrentUser.UserId` equals the `sub` claim
- [x] `Api.Integration` tests use `TestAuthHandler` with test sub in `ALLOWED_USER_SUBS`; all existing tests pass
- [x] JWT middleware config: audience = `GOOGLE_CLIENT_ID`; issuer = `accounts.google.com`
- [x] Write endpoints return 404 when the resource belongs to a different user (IDOR guard)
- [x] Smoke test fixture passes Bearer token when `SMOKE_TEST_TOKEN` is set; all tests skip (not fail) when absent
- [x] E2E tests inject auth token via `window.__E2E_AUTH_TOKEN`; `BrowserFixture` reads `E2E_GOOGLE_ID_TOKEN`

---

## Slice 8-D — Wire userId into the domain

**Status:** Done

**Value:** Every event and projection row is stamped with the real authenticated user's ID. Data is naturally isolated per user.

**Changes in scope:**

- All command handlers inject `ICurrentUser` and set `EventMetadata.UserId = currentUser.UserId`.
- Projection stores query/write with the userId from the event metadata (they already include userId in the key — now it's a real value).
- `GET /notes`, `GET /notes/{id}`, `GET /todos`, `GET /folders` etc. filter by `ICurrentUser.UserId`.

**What happens to existing data:** Data created before Phase 8 has `UserId = null` in its events and projection rows. It is not migrated. A freshly authenticated user starts with an empty note list. The hardcoded-user data remains in the tables but is never returned to any real user. This is acceptable for a learning project.

**Key implementation files:**

- `src/Api/NoteCommandHandler.cs` — inject `ICurrentUser`; set `EventMetadata.UserId`
- `src/Api/FolderCommandHandler.cs` — same
- `src/Api/ActionItemCommandHandler.cs` — same
- `src/Api/Projections/` — projection event handlers already key by userId; now confirmed non-null
- `src/Api/Endpoints/` — read endpoints pass `currentUser.UserId` to projection queries
- `tests/Api.Integration/` — all tests use the `TestAuthHandler` test user ID; assert userId on returned data

**Scenarios:**

```
Scenario: Events are stamped with the authenticated user's ID
  Given I am authenticated as user "google|user-123"
  When  I create a note
  Then  the NoteCreated event has UserId "google|user-123"

Scenario: A user only sees their own notes
  Given user A has created two notes and user B has created one note
  When  user A calls GET /notes
  Then  only user A's two notes are returned

Scenario: Projection stores are keyed by userId
  Given a note exists for user "google|user-123"
  When  GET /notes is called by user "google|user-456"
  Then  the note is not returned
```

**Acceptance criteria:**

- [x] `EventMetadata.UserId` is non-null on all new events
- [x] All read endpoints filter by the authenticated user's ID
- [x] All `Api.Integration` tests pass with the test user wiring
- [x] All BDD domain specs continue to pass (domain is user-ID agnostic)

---

## Backlog (deferred from Phase 8)

- **Account linking** — same Google account signed in on multiple devices shares data. This works automatically since `sub` is stable per Google account.
- **Sign-in with a second provider** — deferred; Google Sign-In is sufficient.
- **Token refresh UX** — silent refresh with `prompt=none` is specified; edge cases (third-party cookie blocking) are not in scope.
- **Admin view of all users' data** — out of scope.
- **Migrating pre-auth data to a real userId** — not in scope; old data with null UserId is orphaned but not deleted.
