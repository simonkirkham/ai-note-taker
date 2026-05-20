# Learnings: 8-C/D — JWT Auth + Per-User Data Isolation

- **IDOR gap omitted from the spec.** The 8-C/D spec covered authentication and user ID wiring but said nothing about write endpoint ownership checks. After merge, Hawk found that any authenticated user could mutate any other user's notes/actions/folders — a textbook IDOR. Fixing it required adding ownership guards to 8 handlers across 3 files and 12 new integration tests, all post-merge directly to main. **Action:** Add "write endpoints return 404 when the resource belongs to a different user" as a mandatory acceptance criterion in any slice that wires `ICurrentUser` into write handlers — Done (captured in phase-9 spec checklist; TODO to add to Breaker's spec template).

- **Smoke tests need auth from the same PR that adds `RequireAuthorization()`.** Once `RequireAuthorization()` was applied to all endpoint groups, every smoke test immediately returned 401. The smoke test fixture had no token-injection mechanism, and the spec had no criterion for it. Result: two post-merge commits to add `Xunit.SkippableFact` and token injection to the fixture. **Action:** Add "smoke test fixture passes a Bearer token if `SMOKE_TEST_TOKEN` is present; all tests skip (not fail) when token is absent" as an explicit acceptance criterion for any slice that adds auth enforcement — Done (phase-8.md updated; TODO to add to Breaker's auth spec template).

- **E2E auth bypass needs to be spec'd, not discovered post-merge.** E2E tests navigate a real deployed frontend — they cannot use a fake JWT. The `window.__E2E_AUTH_TOKEN` injection pattern (`AddInitScriptAsync` + `AuthProvider initialToken`) was designed and implemented after merge. Four E2E journey files had to be updated to pass the token through. **Action:** Add "E2E tests inject auth token via `window.__E2E_AUTH_TOKEN`; `BrowserFixture.E2EAuthToken` reads `E2E_GOOGLE_ID_TOKEN` env var" as an explicit acceptance criterion for auth-gating slices — Done (phase-8.md updated; TODO to add to Breaker's E2E spec template).

- **CI token exchange needs environment-scoped secrets explicitly listed.** The "Get smoke test token" step reads `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` from the job environment. These were set at repo level and in Production but not in the Test environment. The step failed silently (warning, not error), producing an empty id_token. Result: three deploy cycles to diagnose and add the missing secrets. **Action:** Any CI step that reads environment-scoped secrets should document which secrets must exist in each environment in a comment above the step — TODO.

- **Seven post-merge commits to main for issues that should have been caught before the PR.** The IDOR gap, smoke test auth, E2E auth bypass, and CI secret gaps all landed as hotfix commits directly to main (no PR, no Hawk review). **Action:** Breaker's pre-PR checklist should include (a) ownership guard for all write endpoints in auth slices, (b) smoke test auth criterion, (c) E2E auth bypass criterion, (d) CI environment secret audit — TODO.

## Applied status

| Learning | Status |
|---|---|
| 1. IDOR gap not in spec | Documented — ownership guard criterion added to 8-C/D acceptance criteria; full checklist addition TODO |
| 2. Smoke tests need auth criterion | Documented — phase-8.md acceptance criteria updated; spec template addition TODO |
| 3. E2E auth bypass needs spec criterion | Documented — phase-8.md acceptance criteria updated; spec template addition TODO |
| 4. CI token exchange secrets must be environment-scoped | Documented — TODO to add comment to deploy.yml step |
| 5. Seven post-merge hotfix commits | Documented — all root causes captured above; Breaker checklist update TODO |
