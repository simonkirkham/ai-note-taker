# Phase Bugs — Defect backlog

**Goal:** A standing, unnumbered phase that captures bugs found in the deployed app and tracks them to a fix. Unlike numbered phases, this has no learning theme and no fixed slice sequence — items are added as defects surface and removed (marked Done) as they are fixed. Each bug is still fixed the normal way: a failing spec/test that reproduces it first, then the fix.

**What belongs here:** defects — behaviour that is wrong, broken, or crashes. If it's a small adjustment to working behaviour it's a **minor change** ([docs/phases/phase-minor-changes.md](phase-minor-changes.md)); a new capability is a **feature** ([docs/future-features.md](../future-features.md) → a numbered phase); a refactor/upgrade/CI item is a **technical improvement** ([docs/technical-improvements.md](../technical-improvements.md)).

**Learning surface:** none specific — this is maintenance work. The discipline is reproduce-before-fix (the Prove-It pattern) and guarding against regression.

---

## Summary

| Item | Summary | Status | Depends on |
|------|---------|--------|------------|
| BUG-1 | Blank screen presented when 401 returned from API | Done | — |
| BUG-2 | favicon.ico request 404s / errors on every page load | Done | — |
| BUG-3 | Data Protection warnings on every Lambda cold start (log noise) | Done | — |
| BUG-4 | ConcurrencyException surfaces as unhandled 500 on note writes | Done | — |
| BUG-5 | Renaming a deleted note throws unhandled 500 instead of 404 | Done | — |
| BUG-6 | CloudWatch RUM receives no data — loader CDN host is regional, doesn't resolve | Done | 12-F |

Further bugs will be appended as they are identified.

---

## BUG-1 — Blank screen presented when 401 returned from API

**Status:** Done — fixed in PR #99 (commit `7272d5b`), deployed to main 2026-06-02. See [docs/learnings/phase-bug-1-blank-screen-on-401.md](../learnings/phase-bug-1-blank-screen-on-401.md).

**Severity:** High — the app is unusable when it occurs; the user sees an empty/broken screen with no way to recover other than a manual reload.

**Symptom:** When API calls return `401 Unauthorized`, the screen is presented blank (or in a broken half-rendered state) instead of either silently refreshing the token or routing the user to sign in. Observed on the home screen: `today`, `todos`, `tags`, `notes`, `folders`, and `cards` all return `401` while the calendar widget shows "Cannot connect to calendar / Retry". The page chrome renders but the data regions are empty because every data fetch failed unauthenticated.

**Evidence:** DevTools Network panel showing `401` on `/today?tz=Europe%2FLondon`, `/todos`, `/tags`, `/notes`, `/folders`, `/cards` (all `fetch`, initiator `index-*.js`), home screen rendered with empty meetings/todo regions.

**Suspected cause (to confirm):** The token has expired (or was never attached) and the 401 path does not trigger a silent refresh or a redirect to sign-in — the fetches just fail and their consumers render nothing. Phase 11 added token expiry + silent refresh and a `visibilitychange` pre-flight guard; this case appears to slip past that path (e.g. expiry detected only on tab-wake, not on a cold load where the stored token is already stale; or the 401 handler does not fire because the request carried no token). See memory `feedback_react_effect_ordering` (initial API calls can fire before `AuthProvider` sets the token) and Phase 11's 401-on-wake slice.

**Expected behaviour:** A 401 from any API call should trigger a single silent token refresh and retry; if refresh fails (or there is no valid session), route the user to the sign-in flow. The user must never be left on a blank/half-rendered screen.

**Repro (to be confirmed during fix):**
1. Sign in, then let the access token expire (or clear/expire the stored token).
2. Cold-load the home screen.
3. Observe all data fetches return 401 and the screen renders empty instead of refreshing or redirecting.

**Acceptance criteria:**
- [x] A 401 response from any data fetch triggers a silent refresh-and-retry exactly once.
- [x] If refresh fails or no session exists, the user is routed to sign-in — never left on a blank screen.
- [x] A failing test reproduces the blank-screen-on-401 condition before the fix lands, and passes after.

**Root cause (confirmed):** the in-memory token was seeded in a parent `useEffect`, which runs *after* child data-fetch effects, so the first fetches on a cold load went out with no `Authorization` header → `401`; the `&& token` guard in `apiFetch` then swallowed that 401 (no banner, no redirect → blank screen).

**Fix:** seed the in-memory token synchronously in the `AuthProvider` `useState` initialiser (closes the effect-ordering race); on any `401`, `apiFetch` performs a single silent refresh-and-retry (deduped across concurrent calls) and routes to sign-in on failure; new `setOnRefresh`/`triggerRefresh` in the token store lets the API layer request a refresh without knowing the `clientId`.

**Key files:** `web/src/api.ts`, `web/src/auth/AuthContext.tsx`, `web/src/auth/tokenStore.ts`; tests `web/src/__tests__/ApiFetch.test.ts`, `web/src/__tests__/TokenRefresh.test.tsx`.

---

## BUG-2 — favicon.ico request 404s / errors on every page load

**Status:** Done — fixed in PR #103 (squash commit `8ef329e`), deployed to main 2026-06-02. See [docs/learnings/phase-bug-2-favicon.md](../learnings/phase-bug-2-favicon.md).

**Severity:** Low — cosmetic/log noise; no functional impact, but every page load logs a failed `/favicon.ico` request in the browser console and server/CDN logs.

**Symptom:** On every page load the browser issues a default request for `/favicon.ico` and receives an error (404, or an SPA fallback that isn't a valid icon). There is no favicon configured.

**Suspected cause (confirmed):** `web/index.html` declares no `<link rel="icon" ...>` and `web/public/` contains no `favicon.ico`, so the browser falls back to requesting `/favicon.ico`, which the app does not serve.

**Expected behaviour:** A favicon is served (an actual icon asset, or an inline/SVG data-URI `<link rel="icon">`), so no failed request is logged on page load.

**Repro:**
1. Open the app with DevTools Network/Console open.
2. Observe a failed `GET /favicon.ico` on initial load.

**Acceptance criteria:**
- [x] No failed `/favicon.ico` request on page load (a valid icon is served, or an explicit `<link rel="icon">` is declared).
- [x] A test/asset assertion guards the favicon is present — `web/src/__tests__/Favicon.test.ts` asserts `index.html` declares an icon link and the referenced asset exists in `web/public/`.

**Fix:** added `web/public/favicon.svg` (a teal note-card glyph) and declared `<link rel="icon" type="image/svg+xml" href="/favicon.svg" />` in `web/index.html`, so the browser resolves the icon instead of falling back to `/favicon.ico`.

**Key files:** `web/index.html`, `web/public/favicon.svg`, `web/src/__tests__/Favicon.test.ts`.

> **Note — not logged here:** the recurring console warning `content.js:360 The kernel 'TopK' for backend 'webgl' is already registered` originates from a **browser extension** (a TensorFlow.js content script injected into the page), not from this app — the codebase has no TensorFlow.js/WebGL usage. It cannot be fixed from our code; reproduce in a clean profile with extensions disabled to confirm.

---

## BUG-3 — ASP.NET Data Protection warnings on every Lambda cold start

**Status:** Done — fixed in PR #108 (squash commit `fac23e7`), deployed to main 2026-06-02. **Chosen approach: suppress at source** — the API authenticates with bearer tokens only (no cookie auth, antiforgery, or `IDataProtector` consumers), so Data Protection is genuinely unused; `Builder.cs` filters the `Microsoft.AspNetCore.DataProtection` category below `Error`. See [docs/learnings/phase-bug-3-dataprotection-logs.md](../learnings/phase-bug-3-dataprotection-logs.md).

**Severity:** Low — log noise, no functional impact today, but it dominates the `notetaker-ops` "All errors" widget (3 Warning lines per cold start), drowning out the genuine Error-level entries the widget is meant to surface.

**Symptom:** Every Lambda cold start emits three `Warning`-level log lines from the ASP.NET Core Data Protection subsystem:
- `Using an in-memory repository. Keys will not be persisted to storage.`
- `Neither user profile nor HKLM registry available. Using an ephemeral key repository. Protected data will be unavailable when application exits.`
- `No XML encryptor configured. Key {…} may be persisted to storage in unencrypted form.`

**Evidence:** CloudWatch Logs Insights over the `notetaker-ops` dashboard "All errors" query (Lambda log group `NoteTakerStack-ApiFunctionLogGroup…`) — ~50 of ~55 matched rows over 14 days are these three lines, one set per cold start (each carries `"cold_start":true`).

**Suspected cause (to confirm):** The default ASP.NET Data Protection services are registered (implicitly, e.g. via antiforgery/auth middleware) but no key persistence is configured. On Lambda there is no user profile, HKLM, or writable key directory, so the framework falls back to an in-memory, unencrypted, ephemeral key ring and warns about each fallback. Keys are regenerated on every cold start.

**Expected behaviour:** No Data Protection warnings on a normal cold start. Either (a) the app does not depend on Data Protection at all and the warnings are eliminated at source, or (b) keys are persisted to a durable, encrypted store so the warnings no longer fire.

**Options to weigh during fix:**
- If Data Protection is genuinely unused (no antiforgery tokens, no cookie auth, no `IDataProtector` consumers — this API authenticates via bearer tokens), the cleanest fix is to not trigger the subsystem, or to raise its log threshold so the startup warnings are suppressed deliberately (documented as intentional).
- If it is (or will be) used, persist the key ring durably — e.g. `PersistKeysToAWSSystemsManager` (SSM Parameter Store) or S3 + a KMS key for `ProtectKeysWithAwsKms` — so keys survive cold starts and the warnings clear.

**Repro:**
1. Trigger a cold start (deploy, or wait for the Lambda to idle out, then hit any endpoint).
2. Observe the three Data Protection `Warning` lines in the Lambda log group for that invocation.

**Acceptance criteria:**
- [x] A cold-start invocation produces zero Data Protection warning lines in the Lambda log group.
- [x] The `notetaker-ops` "All errors" widget no longer shows Data Protection lines.
- [x] The chosen approach (suppress vs. persist) is recorded, with a note on whether the app relies on Data Protection — suppress; the app does not rely on Data Protection (bearer-token auth).

**Key files:** `src/Api/Builder.cs` (log filter), `tests/Api.Integration/DataProtectionLoggingTests.cs`.

---

## BUG-4 — `ConcurrencyException` surfaces as an unhandled 500 on note writes

**Status:** Done — fixed in PR #107 (squash commit `bcdf97b`, combined with BUG-5), deployed to main 2026-06-02. The global exception handler in `LoggingConfig` now maps `EventStore.ConcurrencyException` → `409 Conflict` at a single cross-cutting point. See [docs/learnings/phase-bug-4-5-exception-mapping.md](../learnings/phase-bug-4-5-exception-mapping.md).

**Severity:** Medium — a concurrent or rapidly-repeated write to the same note returns HTTP 500 with an unhandled-exception stack trace, instead of a meaningful status the client can act on. It is a recurring Error-level entry on the dashboard.

**Symptom:** `EventStore.ConcurrencyException: Stream 'note#…': expected version 28 but was 29.` bubbles up as `An unhandled exception has occurred while executing the request.` and the request returns 500. Observed on `DELETE /notes/{id}/tags/{tag}`, but the cause is cross-cutting — it can occur on any note write command.

**Evidence:** Lambda log group, 2026-06-02 10:23:02 — `Microsoft.AspNetCore.Diagnostics.ExceptionHandlerMiddleware`, exception type `EventStore.ConcurrencyException`, thrown at `DynamoDbEventStore.AppendAsync` → `NoteCommandHandler.PersistAsync` (`src/Api/CommandHandlers/NoteCommandHandler.cs:43`) → `NoteHandlers.DeleteTag` (`src/Api/Handlers/NoteHandlers.cs:118`).

**Suspected cause (to confirm):** The event store appends with optimistic concurrency (`store.AppendAsync(streamId, history.Count, …)`). When two writes race (or a double-submit / retry hits the same stream), the expected version no longer matches and `ConcurrencyException` is thrown. No handler — and no global exception mapping — catches `ConcurrencyException`, so it propagates to the default exception handler and becomes a 500. The endpoint catches `NoteNotFoundException` and `InvalidOperationException` but not `ConcurrencyException`.

**Expected behaviour:** A concurrency conflict must not be a 500. Either (a) the command handler retries once — reload the stream, rebuild, re-apply the command, re-append — which resolves benign races transparently; or (b) it maps to `409 Conflict` so the client can refetch and retry. Option (a) is preferable for idempotent-ish edits; (b) is the minimum.

**Repro (to be confirmed during fix):**
1. Issue two near-simultaneous writes to the same note (e.g. two tag deletes, or a double-submit from the UI).
2. Observe the second append fail with `ConcurrencyException` → 500.

**Acceptance criteria:**
- [x] A concurrency conflict on a note write never returns 500 — it is returned as `409 Conflict`.
- [x] A failing spec/test reproduces the conflict before the fix and passes after — `ExceptionMappingTests.ConcurrencyConflict_OnNoteWrite_Returns409…` (via a `ConflictingEventStore` double).
- [x] The fix is applied at a single cross-cutting point (global `ConcurrencyException → 409` mapping in `LoggingConfig`), not patched per-endpoint.

**Key files:** `src/Api/LoggingConfig.cs` (global `ConcurrencyException → 409` mapping), `src/Api/Observability/CommandInstrumentation.cs`; tests `tests/Api.Integration/ExceptionMappingTests.cs`, `tests/Api.Integration/ConflictingEventStore.cs`.

---

## BUG-5 — Renaming a deleted/non-rebuildable note throws an unhandled 500

**Status:** Done — fixed in PR #107 (squash commit `bcdf97b`, combined with BUG-4), deployed to main 2026-06-02. `NoteCommandHandler.ExecuteAsync` now rebuilds the aggregate and throws the typed `NoteNotFoundException` when the note no longer exists (empty stream **or** deleted), via the new `Note.Exists` predicate; the global handler maps that family → `404`. See [docs/learnings/phase-bug-4-5-exception-mapping.md](../learnings/phase-bug-4-5-exception-mapping.md).

**Severity:** Medium — `PATCH /notes/{id}/title` returns 500 instead of a clean 404/409 when the note no longer exists in the event stream.

**Symptom:** `System.InvalidOperationException: Note {id} does not exist.` bubbles up as an unhandled exception and the request returns 500. Observed on `PATCH /notes/{id}/title` (RenameNote).

**Evidence:** Lambda log group, 2026-06-02 10:17:15 — exception type `System.InvalidOperationException`, message `Note 9c907353-… does not exist.`, thrown at `Domain.Notes.Note.HandleRename` (`src/Domain/Notes/Note.cs:85`) → `NoteCommandHandler.HandleAsync` → `NoteHandlers.RenameNote` (`src/Api/Handlers/NoteHandlers.cs:44`).

**Suspected cause (confirmed by code read):** `RenameNote` catches only `NoteNotFoundException` (`src/Api/Handlers/NoteHandlers.cs:45`). The pre-check at lines 42–43 reads the **projection** (`noteDetailStore`, eventually consistent), which can still show the note while the event stream has already been deleted. The command then rebuilds the aggregate from the stream, and the domain's `HandleRename` guard throws a raw `InvalidOperationException("Note … does not exist.")`. Because the handler does not catch `InvalidOperationException`, it becomes a 500. Sibling handlers `DeleteNote` (line 100), `DeleteTag` (line 120) and `PostTag` (line 110) already catch `InvalidOperationException`; `RenameNote`, `EditContent` (line 64) and `SetNoteDate` (line 90) do not — same latent gap.

**Expected behaviour:** Renaming (or editing/dating) a note that no longer exists in the stream returns `404 Not Found` (or `409 Conflict`), never a 500. The behaviour should be consistent across all note-mutating endpoints.

**Repro (to be confirmed during fix):**
1. Delete a note, then immediately `PATCH /notes/{id}/title` before the projection catches up (or replay the recorded request).
2. Observe a 500 with `InvalidOperationException: Note … does not exist.`

**Acceptance criteria:**
- [x] `RenameNote`, `EditContent`, and `SetNoteDate` return a clean 404 (not 500) when the note does not exist in the event stream.
- [x] A failing spec/test reproduces the rename-of-deleted-note 500 before the fix and passes after — `ExceptionMappingTests.WriteToDeletedNote_WithStaleProjection_Returns404…` (`[Theory]` over title/content/date).
- [x] Mapping is uniform, not per-endpoint: the handler throws the typed `NoteNotFoundException` for every note write command via `Note.Exists`, rather than relying on per-endpoint `InvalidOperationException` catches.

**Key files:** `src/Api/CommandHandlers/NoteCommandHandler.cs` (`ExecuteAsync` existence check), `src/Domain/Notes/Note.cs` (`Exists`), `src/Api/LoggingConfig.cs` (`NoteNotFoundException → 404` mapping); tests `tests/Api.Integration/ExceptionMappingTests.cs`.

---

## BUG-6 — CloudWatch RUM receives no data (loader CDN host is regional)

**Status:** Done — fixed in `hotfix/12-f-rum-cdn-host`. See [docs/learnings/phase-12f-frontend-rum.md](../learnings/phase-12f-frontend-rum.md).

**Severity:** Medium — no user-facing impact, but the entire frontend observability surface delivered in 12-F was silently dead: the RUM console showed "we haven't received any data" and `RumEventCount` was flat zero.

**Symptom:** After 12-F deployed, the `notetaker-rum` AppMonitor received zero events. Throwing an error on the live site produced nothing in the JS Errors view; no page-view or performance events arrived either.

**Cause (confirmed):** The deploy-time RUM snippet built its loader URL as `https://client.rum.{region}.amazonaws.com/3.x/cwr.js` with `{region} = eu-west-2`. That host does **not exist** — `client.rum.eu-west-2.amazonaws.com` returns NXDOMAIN. The aws-rum-web loader CDN is global, served only from **`us-east-1`**; only the data-plane `endpoint` (`dataplane.rum.{region}.amazonaws.com`) is regional. The `<script>` failed to load, so `window.cwr(...)` calls queued forever and nothing was ever sent. Everything else (AppMonitor state, Cognito identity pool, guest role + `rum:PutRumEvents` on the exact monitor ARN, domain match, snippet injection, version) was verified correct.

**Why no gate caught it:** the loader host is a literal string inside the `Inject RUM snippet` CI step — not exercised by `Template.FromStack` assertions, the build, or any unit test. It only fails at runtime DNS in a real browser. Diagnosed post-deploy by inspecting the live `index.html`, the IAM/Cognito wiring, and a flat-zero `RumEventCount`, then DNS-resolving the regional vs `us-east-1` host.

**Fix:** hard-code `us-east-1` for the loader host in `deploy.yml`'s snippet template (both deploy jobs); keep the data-plane `endpoint` regional.

**Acceptance criteria:**
- [x] `deploy.yml` RUM snippet loads `cwr.js` from `client.rum.us-east-1.amazonaws.com` (both `deploy-test` and `deploy-production` jobs); data-plane `endpoint` stays regional.
- [x] Post-deploy: a thrown browser error appears in the `notetaker-rum` console and `PutRumEvents` → `dataplane.rum.eu-west-2.amazonaws.com` returns 200 — verified on the live site after the hotfix deploy.

**Key files:** `.github/workflows/deploy.yml` (`Inject RUM snippet` step, both jobs).
