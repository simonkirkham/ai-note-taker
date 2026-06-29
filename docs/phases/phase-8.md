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

---

## Slice 8-A — CDK and CORS wiring

**Status:** Done

### Scenarios

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

### Acceptance criteria

- [x] `GOOGLE_CLIENT_ID` env var present on the Lambda in `cdk synth` output
- [x] `ALLOWED_USER_SUBS` env var present on the Lambda in `cdk synth` output
- [x] `Authorization` already accepted by CORS — covered by `AllowAnyHeader()` in ASP.NET; no CDK assertion needed
- [x] `dotnet test tests/Infrastructure.Assertions/` — all green
- [x] `cdk synth` exits 0

---

## Slice 8-B — Google Sign-In on the frontend

**Status:** Done

### Scenarios

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

### Acceptance criteria

- [x] Unauthenticated users see only the sign-in screen
- [x] Sign-in completes via PKCE; ID token stored in memory only
- [x] All API calls include `Authorization: Bearer <idToken>`
- [x] Sign-out clears the token and returns to the sign-in screen
- [x] Token never written to `localStorage` or `sessionStorage`

---

## Slice 8-C — JWT verification in the API

**Status:** Done

### Scenarios

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

### Acceptance criteria

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

### Scenarios

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

### Acceptance criteria

- [x] `EventMetadata.UserId` is non-null on all new events
- [x] All read endpoints filter by the authenticated user's ID
- [x] All `Api.Integration` tests pass with the test user wiring
- [x] All BDD domain specs continue to pass (domain is user-ID agnostic)
