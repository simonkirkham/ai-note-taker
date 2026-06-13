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
| BUG-8 | `x-correlation-id` returned to clients is never logged — a user-quoted ID can't be found in logs | Done | 12-A |
| BUG-9 | Note tab panels (Transcript/Final notes) stack below Quick notes instead of replacing it | Done | 15-B |
| BUG-10 | Live transcription falls behind realtime — audio streamed in ~8ms chunks (~125 events/sec) | Done | — |
| BUG-11 | Signed out ~hourly — iframe silent refresh fails under third-party-cookie blocking; switch to backend refresh-token flow | Done | — |
| BUG-12 | `DynamoDbNoteSearchViewStore.GetByNoteIdAsync` omits `ConsistentRead = true` — stale read on the inline read-modify-write can clobber a just-written field | Done | 22-A |
| BUG-13 | Search bar shows two clear `✕` — the native `<input type="search">` cancel button on top of the custom clear button | Done | 22-B |
| BUG-14 | Pasting space-separated tags drops a pill — optimistic patch no-ops when the note isn't cached yet (initial GET in flight) | Done | 20-E |
| BUG-15 | Forced through full Google sign-in on cold load — bootstrap never uses the `rt` refresh cookie, so the session is only ~1h not 30 days | Done | BUG-11 |
| BUG-16 | Google emails the user on every login — `prompt=consent` forces a fresh consent grant on each sign-in | Done | BUG-11 |
| BUG-17 | Concurrent multi-word tag add drops a tag — second append loses the optimistic-concurrency race and is silently dropped (no handler retry) | Done | BUG-4, BUG-14 |
| BUG-18 | Removing an inline image (or any edit) is silently not persisted — note content saves only on editor `onBlur`; the Save button navigates without flushing the draft | Done | 25-D |
| BUG-19 | Inline image flashes a 403 on every open — `ImageNodeView` renders the raw S3 key as a relative `<img src>` before `resolveImages` swaps in the presigned URL | Done | 25-B, 25-D |
| BUG-20 | Workspace-switcher popover overlaps the main content when open — widened to `min-width: 16rem` (23-E truncation fix) it grows rightward past the narrow sidebar over the Home/Notes area. Keep the popover within the sidebar width and reveal the rename/delete icons on row hover/focus so full names ("Personal · default") still fit without truncating or overlapping content. | Done | 23-E |
| BUG-21 | Note title silently lost on navigate in/out — the title field is never reconciled with the authoritative `detail.title` (initialised once from a prop/card-cache, no draft-pattern sync), so it can show empty; the title input auto-focuses on open and its `onBlur` then persists that empty value (`HandleRename` has no empty-title guard), permanently overwriting the real title. | Done | — |
| BUG-22 | Multi-tag add drops a pill under RYW-2 async reads — the frontend per-stream consistency-token slot is last-writer-wins; two concurrent same-stream tag POSTs (`note#id@N`, `note#id@N+1`) race it, the older `@N` can win, and the next gated note read releases before the second tag is folded. Resurfaces the long-flaky `TagsJourney` E2E (TI-19) on deploy #546. | Done | TI-19, RYW-2 |

Further bugs will be appended as they are identified.

---

## BUG-1 — Blank screen presented when 401 returned from API

**Status:** Done — fixed in PR #99 (commit `7272d5b`), deployed to main 2026-06-02. See [docs/learnings/_archive.md](../learnings/_archive.md).

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

**Status:** Done — fixed in PR #103 (squash commit `8ef329e`), deployed to main 2026-06-02. See [docs/learnings/_archive.md](../learnings/_archive.md).

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

**Status:** Done — fixed in PR #108 (squash commit `fac23e7`), deployed to main 2026-06-02. **Chosen approach: suppress at source** — the API authenticates with bearer tokens only (no cookie auth, antiforgery, or `IDataProtector` consumers), so Data Protection is genuinely unused; `Builder.cs` filters the `Microsoft.AspNetCore.DataProtection` category below `Error`. See [docs/learnings/_archive.md](../learnings/_archive.md).

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

**Status:** Done — fixed in PR #107 (squash commit `bcdf97b`, combined with BUG-5), deployed to main 2026-06-02. The global exception handler in `LoggingConfig` now maps `EventStore.ConcurrencyException` → `409 Conflict` at a single cross-cutting point. See [docs/learnings/_archive.md](../learnings/_archive.md).

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

**Status:** Done — fixed in PR #107 (squash commit `bcdf97b`, combined with BUG-4), deployed to main 2026-06-02. `NoteCommandHandler.ExecuteAsync` now rebuilds the aggregate and throws the typed `NoteNotFoundException` when the note no longer exists (empty stream **or** deleted), via the new `Note.Exists` predicate; the global handler maps that family → `404`. See [docs/learnings/_archive.md](../learnings/_archive.md).

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

**Status:** Done — fixed in `hotfix/12-f-rum-cdn-host`. See [docs/learnings/_archive.md](../learnings/_archive.md).

**Severity:** Medium — no user-facing impact, but the entire frontend observability surface delivered in 12-F was silently dead: the RUM console showed "we haven't received any data" and `RumEventCount` was flat zero.

**Symptom:** After 12-F deployed, the `notetaker-rum` AppMonitor received zero events. Throwing an error on the live site produced nothing in the JS Errors view; no page-view or performance events arrived either.

**Cause (confirmed):** The deploy-time RUM snippet built its loader URL as `https://client.rum.{region}.amazonaws.com/3.x/cwr.js` with `{region} = eu-west-2`. That host does **not exist** — `client.rum.eu-west-2.amazonaws.com` returns NXDOMAIN. The aws-rum-web loader CDN is global, served only from **`us-east-1`**; only the data-plane `endpoint` (`dataplane.rum.{region}.amazonaws.com`) is regional. The `<script>` failed to load, so `window.cwr(...)` calls queued forever and nothing was ever sent. Everything else (AppMonitor state, Cognito identity pool, guest role + `rum:PutRumEvents` on the exact monitor ARN, domain match, snippet injection, version) was verified correct.

**Why no gate caught it:** the loader host is a literal string inside the `Inject RUM snippet` CI step — not exercised by `Template.FromStack` assertions, the build, or any unit test. It only fails at runtime DNS in a real browser. Diagnosed post-deploy by inspecting the live `index.html`, the IAM/Cognito wiring, and a flat-zero `RumEventCount`, then DNS-resolving the regional vs `us-east-1` host.

**Fix:** hard-code `us-east-1` for the loader host in `deploy.yml`'s snippet template (both deploy jobs); keep the data-plane `endpoint` regional.

**Acceptance criteria:**
- [x] `deploy.yml` RUM snippet loads `cwr.js` from `client.rum.us-east-1.amazonaws.com` (both `deploy-test` and `deploy-production` jobs); data-plane `endpoint` stays regional.
- [x] Post-deploy: a thrown browser error appears in the `notetaker-rum` console and `PutRumEvents` → `dataplane.rum.eu-west-2.amazonaws.com` returns 200 — verified on the live site after the hotfix deploy.

**Key files:** `.github/workflows/deploy.yml` (`Inject RUM snippet` step, both jobs).

---

## BUG-8 — `x-correlation-id` returned to clients is never emitted as a log field

**Status:** Done — fixed in PR #125 (commit `c202ec9`), deployed to main 2026-06-02. The correlation ID is now appended to the Powertools logger and emitted as the `correlation_id` field on every log line. See [docs/learnings/_archive.md](../learnings/_archive.md). Found during slice 12-G (observability runbook).

**Severity:** Low–Medium — no functional impact, but it defeats the central promise of 12-A: a user (or a 500 error body) can quote a correlation ID that **cannot then be found in the logs**, so the "trace a user-reported error to its exact log line" workflow doesn't work. Only the X-Ray trace id (`xray_trace_id`) is greppable.

**Symptom:** Every HTTP response carries an `x-correlation-id` header (and a 500's JSON body repeats it). But querying the API Lambda log group (the explicit `NoteTakerStack-ApiFunctionLogGroup…`, `--profile prod`, eu-west-2) for that value returns nothing — there is no `correlationId` (or `correlation_id`) field on any log line.

**Evidence (prod, 2026-06-02):** Logs Insights / `filter-log-events` over the API log group: a `"correlationId"` term match returns **0** events, while lines clearly carry the other Powertools fields (`level`, `message`, `service`, `xray_trace_id`, `command_type`, `stream_id`). The per-request correlation key present in logs is `xray_trace_id` (set by X-Ray, 12-C), which corresponds to the `x-amzn-trace-id` header — a *different* value from `x-correlation-id`.

**Suspected cause (confirmed by code read):** `src/Api/LoggingConfig.cs` sets the `x-correlation-id` response header and 500-body field from `ctx.TraceIdentifier`, but never appends it to the Powertools logger (no `Logger.AppendKey("correlationId", …)` / no `CorrelationIdPath`). So the value the client sees is never written to any log line. The 12-A acceptance criterion "the correlation ID is returned to the browser… so a user-reported error can be traced to its exact log line" was only half-implemented — the return half works, the log half doesn't.

**Expected behaviour:** The correlation ID returned to the client appears on every log line for that request, so pasting it into Logs Insights returns that request's trail. Either:
- (a) append `correlationId` (= `TraceIdentifier`) to the Powertools logger for the request scope (middleware `Logger.AppendKey`), **or**
- (b) make `x-correlation-id` carry the X-Ray trace id (so it matches the already-logged `xray_trace_id`), and retire the separate `TraceIdentifier` value.

Option (a) keeps the existing header semantics; (b) collapses two correlation identifiers into one. Decide during the fix.

**Repro:**
1. Trigger a 500 (or any request); note the `x-correlation-id` response-header value.
2. In Logs Insights over the API log group, `filter correlationId = "<that value>"` (or `filter @message like /<that value>/`).
3. Observe zero results — the value isn't in the logs.

**Acceptance criteria (confirmed during fix — option (a), append `correlationId` to the logger):**
- [x] The `x-correlation-id` value returned to the client appears as the queryable `correlation_id` field on every log line of that request.
- [x] A failing test reproduces the gap before the fix (`CorrelationIdLoggingTests.EmittedLogLine_CarriesCorrelationIdFieldMatchingHeader` captures real Powertools output; verified red before, green after).
- [x] `docs/observability.md` "By trace ID" guidance updated — both `correlation_id` and `xray_trace_id` lookups documented.
- [x] The bearer token / `Authorization` header is still never logged (no header logging added; `LogEvent` stays off).

**Key files:** `src/Api/LoggingConfig.cs` (sets the header/body today), `src/Api/Builder.cs` (Powertools logger registration); tests `tests/Api.Integration/`. Same `correlationId`-vs-`xray_trace_id` mismatch was corrected in the 12-G saved queries and the 12-D/12-H dashboard "All errors" widgets (they now project `xray_trace_id`).

---

## BUG-9 — Note tab panels stack below Quick notes instead of replacing it

**Status:** Done — fixed in PR #156 (commit `20361ca`), deployed to main 2026-06-03.

**Symptom:** On a note (Phase 15-B three-tab view), the Transcript and Final notes panels rendered *below* the Quick notes editor rather than replacing it when their tab was selected — all three panels floating stacked.

**Cause:** Each tab panel used `hidden={activeTab !== id}`, but `.panel { display: flex }` (NoteTabs.module.css) overrode the `hidden` attribute — the attribute's `display: none` is only the UA-stylesheet default, which any explicit `display` rule beats. So inactive panels stayed laid out.

**Fix:** Added `.panel[hidden] { display: none }` (specificity `0,2,0` > `.panel` `0,1,0`), so hidden panels are truly removed from layout. Same pattern already used by `.filters-panel[hidden]`.

**Why it shipped / regression guard:** jsdom does not apply CSS-Module stylesheets, so the component tests' `toBeVisible()` saw only the `hidden` attribute and passed despite the visual bug — a CSS-only defect is invisible to the jsdom layer. Guarded with a real-browser test: `tests/Browser.E2E/Journeys/NoteTabsJourney.cs` switches tabs and asserts the inactive panel `ToBeHidden` (Playwright checks computed visibility). **Lesson:** layout/visibility behaviour driven by CSS must be guarded at the browser (E2E) layer, not jsdom.

**Key files:** `web/src/components/NoteTabs.module.css`, `web/src/components/NoteView.tsx` (panels), `tests/Browser.E2E/Journeys/NoteTabsJourney.cs`.

---

## BUG-10 — Live transcription falls progressively behind realtime

**Status:** Done — fixed in PR #158 (squash commit `3ce415d`), deployed to main 2026-06-03 (deploy #445). Confirmed working on a real call (transcription keeps pace). See [docs/learnings/_archive.md](../learnings/_archive.md).

**Severity:** High — on a real call the transcript lags further and further behind the conversation and never catches up until speech pauses, so live notes are unusable and the saved transcript can be truncated when the user stops.

**Symptom:** During a live recording the displayed transcript drifts steadily behind what is actually being said; the longer the call, the larger the gap. Pressing Stop submits only what has been finalised so far, so trailing speech can be lost.

**Cause (confirmed by code read):** `web/src/hooks/useTranscription.ts` posted audio from the AudioWorklet once per render quantum — a fixed **128 samples**. At the 16kHz capture rate that is ~8ms of audio, ~125 messages/sec, each pushed to the Transcribe stream as its own `AudioEvent`/`AudioChunk`. Every event in the AWS event stream is serialised and SigV4-signed on the main thread, so ~125 signed events/sec is far more per-event overhead than the client can sustain — a backlog forms in the audio queue, and because Transcribe Streaming only consumes at ~realtime, the backlog never drains. AWS guidance is ~100ms chunks; the client was sending at ~8ms, ~12× too fine. Secondary contributor: every partial result called `setTranscript` with the entire growing transcript string, so main-thread render cost grew with call length and competed with streaming.

**Expected behaviour:** The live transcript keeps pace with the conversation for the full duration of a call; stopping captures the complete transcript.

**Fix:** Coalesce worklet frames into fixed ~100ms PCM chunks before they reach the Transcribe client (`web/src/hooks/pcm.ts`, `PcmChunker`), cutting the event-stream rate from ~125/sec to ~10/sec. Throttle live partial-result re-renders to ≤1 per 200ms (finals always render immediately) so a long transcript no longer congests the main thread. Capture is unchanged (still AudioWorklet, off the main thread) — no change in approach (browser → AWS Transcribe Streaming).

**Repro:**
1. Start a recording and speak continuously for several minutes.
2. Observe the transcript falling further behind real speech as the call goes on; it does not catch up until you pause.
3. (Diagnostic) logging the audio-queue length shows it growing monotonically during the call.

**Acceptance criteria:**
- [x] Audio is sent to Transcribe in ~100ms chunks (~10 events/sec), not per 128-sample frame — guarded by a unit test of the chunking contract (`web/src/__tests__/pcm.test.ts`).
- [x] Live partial-result re-renders are bounded (≤1 per 200ms); final results still render immediately.
- [x] Existing transcription/RecordControl tests remain green.
- [x] Confirmed on a real call: the live transcript keeps pace for the full duration (manual, post-deploy — verified 2026-06-03, noticeably better).

**Key files:** `web/src/hooks/pcm.ts` (new — `PcmChunker`, `floatTo16BitPcm`), `web/src/hooks/useTranscription.ts` (chunker wiring + partial-render throttle); tests `web/src/__tests__/pcm.test.ts`.

---

## BUG-11 — User is signed out too frequently

**Status:** Done — fixed in PR #175 (squash commit `0b05575`), deployed to main 2026-06-05 (deploy #469). See [docs/learnings/_archive.md](../learnings/_archive.md).

**Severity:** Medium — no data loss, but the user is repeatedly forced back through sign-in during normal use, interrupting work.

**Symptom:** The signed-in session does not persist as long as expected. The user is returned to the sign-in flow more often than a normal session lifetime should require (reported as "I get signed out too often").

**Root cause (confirmed by code read):** the session lasts at most ~1 hour (Google ID-token lifetime) and the *only* mechanism to extend it is the hidden-iframe `prompt=none` silent refresh against `accounts.google.com` (`web/src/auth/silentRefresh.ts`). That depends on Google's session cookie being readable inside a **third-party iframe**, which modern browsers (Safari ITP, Firefox ETP, Chrome third-party-cookie phase-out) block by default. When the cookie is unavailable the iframe returns `login_required`, `attemptSilentRefresh` resolves `null`, and `onRefreshFailure` immediately sets `sessionExpired = true` (`AuthContext.tsx:56-61`) → the user is bounced to sign-in. The refresh fires ~5 min before expiry (`REFRESH_LEAD_MS`, `useGoogleAuth.ts:4`), so a user whose browser blocks the iframe cookie is signed out roughly **every ~55 minutes**, and also on any tab-refocus near expiry (`AuthContext.tsx:116-120`).

No refresh token is ever used: the auth URL requests no `access_type=offline` (`pkce.ts:25`) and the backend code-exchange discards everything except `id_token` (`AuthEndpoints.cs:45`) — even though it holds the `client_secret` and is exactly where a refresh token could be obtained.

Distinct from [BUG-1] (blank screen on 401) — there the screen broke; here the session ends and sign-in is shown, just too often.

**Chosen fix — backend refresh-token flow (Option A), refresh token in an httpOnly cookie:**
1. Auth URL requests `access_type=offline` + `prompt=consent` so Google returns a `refresh_token` on sign-in.
2. The backend `/auth/token` exchange captures the `refresh_token` and sets it in an `HttpOnly; Secure; SameSite=Strict; Path=/api/auth` cookie (named `rt`). The token never reaches JS. Browser-visible path is `/api/auth/*` (a CloudFront function strips `/api` before the origin), so the cookie path is `/api/auth`.
3. A new backend `POST /auth/refresh` reads the `rt` cookie, exchanges it with Google (`grant_type=refresh_token`), and returns a fresh `id_token`. No cookie / invalid-or-expired refresh token → `401` (session genuinely over).
4. The frontend silent refresh becomes a `fetch('/api/auth/refresh', { credentials: 'include' })` — the fragile iframe + `silent-refresh.html` are deleted. The existing 401-retry and scheduled-refresh paths are unchanged (they call the same `attemptSilentRefresh`).

No CDK change: the `/api/*` CloudFront behaviour already uses `CACHING_DISABLED` + `ALL_VIEWER_EXCEPT_HOST_HEADER`, so `Cookie`/`Set-Cookie` are forwarded both ways.

**Expected behaviour:** The session persists for the refresh token's lifetime (days–weeks), independent of third-party-cookie policy; the user is only sent to sign-in when the refresh token is genuinely expired or revoked.

**Repro:**
1. Sign in in a browser that blocks third-party cookies (Safari, or Chrome with third-party cookies blocked).
2. Use the app for over an hour (or fast-forward: let the access token reach ~55 min).
3. Observe being bounced to sign-in when the iframe silent refresh fails.

**Acceptance criteria:**
- [x] The auth URL requests `access_type=offline` so Google issues a refresh token.
- [x] `/auth/token` success sets the refresh token in a cookie with `HttpOnly`, `SameSite=Strict`, `Path=/api/auth` (and `Secure` over HTTPS); the response body still returns only `id_token`.
- [x] `POST /auth/refresh` returns a fresh `id_token` for a valid refresh-token cookie, and `401` when the cookie is absent or Google rejects the refresh token.
- [x] The frontend silent refresh calls `/api/auth/refresh` (no iframe); `silent-refresh.html` and the iframe code are removed.
- [x] Failing tests reproduce the gap before the fix and pass after: backend `/auth/refresh` (200 w/ cookie via a stubbed Google client, 401 w/o) + `/auth/token` cookie attributes; frontend `silentRefresh` posts to `/api/auth/refresh` and returns the token / null.
- [x] Existing `TokenRefresh`/`Auth` frontend tests and `AuthTokenExchange` backend tests stay green (the 401-retry and scheduled-refresh behaviour is unchanged).
- [x] The refresh cookie's 30-day window slides forward on every successful refresh (Hawk #1), so an active session is never force-signed-out at the 30-day mark.

**Key files:** `web/src/auth/pkce.ts`, `web/src/auth/silentRefresh.ts`, `web/src/auth/AuthContext.tsx`, `web/src/auth/useGoogleAuth.ts`, removed `web/public/silent-refresh.html`; `src/Api/Endpoints/AuthEndpoints.cs`, new `src/Api/Auth/IGoogleOAuthClient.cs` + `GoogleOAuthClient.cs`, `src/Api/Builder.cs` wiring; tests `tests/Api.Integration/AuthRefreshTests.cs`, `FakeGoogleOAuthClient.cs`, `AuthEnvCollection.cs`, `AuthTokenExchangeTests.cs`, `ApiFactory.cs`, `web/src/__tests__/SilentRefresh.test.ts`, `AuthUrl.test.ts`.

---

## BUG-14 — Pasting space-separated tags intermittently drops a pill

**Status:** Done — fixed in PR #205 (squash commit `8e919d2`), deployed to main 2026-06-09 (deploy #495). Reproduced by `web/src/__tests__/TagMutationRace.test.tsx` (red before, green after).

**Severity:** Medium — a user pasting multiple space-separated tags at once (e.g. `1:1s Bill`) can silently lose one of them; the tag is never applied even though the POST succeeded.

**Symptom:** Adding multiple tags in one go on a **freshly-created** note sometimes shows only the second tag's pill (the first is missing). Surfaced as the intermittently-red `TagsJourney` E2E — **every** failure (deploys #485, #491×3, #493) was on a test doing `AddTagAsync("1:1s Bill")`; single-tag tests never failed. Worse under cold-start latency.

**Misdiagnosis first:** PR #203 raised the E2E tag-pill timeout 15s→45s on a cold-start-latency theory. Deploy #493 then failed **with the 45s applied** (`ToBeVisibleAsync with timeout 45000ms` in the log) — a pill that never renders in 45s isn't slow, it's missing. That overturned the latency theory and pointed at a render race. PR #205 reverts the 45s back to 15s.

**Root cause (confirmed by the reproduction test):** tag pills render optimistically — `useTagNote.onMutate` patches `keys.note`. But `patchTags` is `(old) => old ? {…old, tags: …} : old`, a **no-op when the note isn't cached yet**. On a freshly-created note whose initial `keys.note` GET is still in flight, the optimistic patch does nothing; that GET then resolves **tagless** (it was issued before the tag existed); and `onSettled` invalidated only `keys.tags`, never `keys.note` — so nothing refetched and the pill never appeared. A space-separated paste fires **two concurrent** mutations (the second re-reads the clobbered cache), so the first tag (`1:1s`) is the one lost. Cold start just widens the in-flight window.

**Fix:** `useTagNote`/`useUntagNote` `onSettled` now invalidate `keys.note(noteId)` **only when the optimistic patch couldn't apply** — i.e. `ctx.previous === undefined` (the note wasn't cached at `onMutate` time). When it *was* cached, optimism already holds, so the refetch is skipped to avoid churn and a stale-GET revert (doing it unconditionally first broke two existing tests). React Query coalesces the two concurrent `keys.note` invalidations into one refetch; the note-detail draft pattern (20-E) protects unsaved content/date edits from the refetch.

**Acceptance criteria:**
- [x] A failing test reproduces the race before the fix (two concurrent tag mutations fired while the initial `keys.note` GET is in flight; the open note ends up tagless) and passes after.
- [x] The fix only refetches `keys.note` when the optimistic patch couldn't apply (`ctx.previous` undefined) — no churn in the common cached path.
- [x] PR #203's 45s E2E timeout reverted to 15s (`AppPage.cs` back to its pre-#203 state).
- [x] Full frontend suite green (43 files / 402 tests).

**Key files:** `web/src/hooks/useTagMutations.ts`; tests `web/src/__tests__/TagMutationRace.test.tsx`; `tests/Browser.E2E/Pages/AppPage.cs` (#203 revert).

---

## BUG-15 — Forced through full Google sign-in on cold load (refresh cookie unused at bootstrap)

**Status:** Done — fixed in PR #209 (squash commit `05d927a`), deployed to main 2026-06-10 (deploy #500). Reproduced by the `cold-start silent refresh (BUG-15)` block in `web/src/__tests__/TokenRefresh.test.tsx` (red before, green after).

**Severity:** Medium — no data loss, but the user is repeatedly bounced through the full Google OAuth consent ("You're signing back in to note-taker-ai.com") during normal use, despite holding a valid 30-day refresh cookie. The user reports hitting this "regularly".

**Symptom:** After closing the tab and returning later, the app shows the Google sign-in / consent screen instead of restoring the session silently. Effectively the session lasts only ~1 hour (the Google ID-token lifetime) rather than the 30-day refresh-cookie lifetime BUG-11 was meant to deliver. A tab left open stays alive (the refresh timer fires); a cold load does not.

**Root cause (confirmed by code read):** the cold-start bootstrap never attempts a silent refresh against the `rt` cookie. On load, `loadPersistedToken()` discards the stored `id_token` once it is expired (`web/src/auth/tokenStore.ts:20-21`); `idToken` then initialises to `null` (`AuthContext.tsx:23-27`). Every refresh trigger is guarded on an *existing* non-null token, so none fire when there is no token:
- scheduled refresh timer — `AuthContext.tsx:82-86` (`if (!idToken) return`)
- tab-visible recheck — `AuthContext.tsx:90-110` (`if (!idToken) return`)
- 401-and-retry — `AuthContext.tsx:70-78`, only reachable on an API call that carries a token

The mount effect (`AuthContext.tsx:112-141`) only handles returning *from* a Google redirect (the PKCE `code` exchange); it does not call `attemptSilentRefresh()`. So with no valid in-memory token the gate renders sign-in → `signIn()` → full Google OAuth redirect. The silent-refresh mechanism itself works (`silentRefresh.ts:7`, same-origin `POST /api/auth/refresh` with `credentials: 'include'`); it is simply never invoked on a cold start. BUG-11 fixed the refresh *mechanism* but not the bootstrap that should use it.

**Expected behaviour:** On cold load, when there is no usable in-memory token (but a refresh cookie may exist), attempt a silent refresh **before** falling back to the sign-in gate. The user reaches the full Google sign-in only when the refresh token is genuinely absent, expired, or revoked. The session persists for the refresh cookie's lifetime (≈30 days), not ~1 hour.

**Repro:**
1. Sign in. Close the tab (or leave it long enough for the `id_token` to expire, ~1 hour).
2. Reopen the app cold (fresh load, not a backgrounded tab).
3. Observe the Google "You're signing back in" screen instead of a silently restored session — even though the 30-day `rt` cookie is still valid.

**Acceptance criteria:**
- [x] A failing test reproduces the gap before the fix: cold mount with an expired/absent persisted token but a refresh that *would* succeed ends up signed-in (currently ends up at the sign-in gate).
- [x] On mount — when `clientId` is set, `initialToken` is absent, there is no OAuth `code` in the URL, and there is no valid persisted token — the app calls `attemptSilentRefresh()` and adopts the returned token on success.
- [x] While the cold-start refresh is in flight the gate shows a loading state, not the sign-in button (no flash of the sign-in screen, no premature `signIn()`).
- [x] On refresh failure the sign-in gate is shown exactly as today (no regression to the genuinely-signed-out path).
- [x] Existing auth/token-refresh tests stay green (scheduled refresh, tab-visible recheck, 401-retry unchanged).
- [x] Optimistic-UI / effect-ordering invariant preserved: the in-memory token is still set before child data-fetch effects run (no reintroduction of the BUG-1 blank-screen race).

**Fix:** added a one-shot cold-start refresh in `AuthProvider`. `shouldBootstrapRefresh` is true when a clientId is set, no token was seeded (no `initialToken`, no valid persisted token), and there is no OAuth `code` in the URL; a mount effect then calls `attemptSilentRefresh()` and adopts the token on success. New `authLoading` gate state holds an accessible `<AuthLoading>` spinner while the refresh is in flight, so the sign-in screen never flashes; `idToken` stays null until the token arrives, preserving the BUG-1 token-before-first-fetch invariant.

**Key files:** `web/src/auth/AuthContext.tsx` (bootstrap effect + `authLoading`), `web/src/auth/context.ts` (`authLoading` on `AuthState`), `web/src/App.tsx` (`AuthLoading` gate), `web/src/components/App.module.css` (`.authSpinner`); tests `web/src/__tests__/TokenRefresh.test.tsx` (cold-start block), `web/src/__tests__/Auth.test.tsx`, `web/src/__tests__/SignInPage.test.tsx`. Related: [BUG-11] (refresh-token flow), [BUG-1] (effect-ordering / blank-screen race), [BUG-16] (per-login consent email).

---

## BUG-16 — Google emails the user on every login (`prompt=consent` forces a consent grant)

**Status:** Done — fixed in PR #215 (squash commit `0ecdb81`), deployed to main 2026-06-10 (deploy #504). Reproduced by `web/src/__tests__/ConsentPrompt.test.tsx` + `AuthUrl.test.ts` (red before, green after).

**Severity:** Low — no functional impact, but on every sign-in Google sends a "You used Sign in with Google to sign in to note-taker-ai.com … This email summarises the info that you shared" security notification. Atypical SSO behaviour; reads as noisy/suspicious to the user.

**Symptom:** Each time the user signs in, Google emails a sign-in/consent summary. A normal SSO app shows consent only on first authorisation, then re-authenticates silently without a new email.

**Root cause (confirmed by code read):** the OAuth auth URL hard-codes `prompt: 'consent'` on **every** request (`web/src/auth/pkce.ts:37`). `prompt=consent` forces Google to re-display the consent screen and record a **fresh consent grant** on each sign-in, which is what triggers the notification email. It was added in BUG-11 to guarantee Google returns a `refresh_token` (refresh tokens are only issued on a consent grant under `access_type=offline`). Compounded by [BUG-15]: because cold loads forced full sign-ins "regularly", the email fired roughly that often. Fixing BUG-15 reduces the frequency; this bug removes the per-login consent grant itself.

**Expected behaviour:** Consent (and its email) only on first authorisation — or when Google has no refresh token for the user. Returning users re-authenticate without a forced consent grant and without an email each time.

**Chosen approach — client first-auth flag (decided 2026-06-10):** request `prompt=consent` only when the client has no evidence a refresh token is on file; omit `prompt` otherwise (Google then re-authenticates a returning user silently, with no consent grant and no email — while still returning the existing session via `access_type=offline`). The evidence is a browser-local localStorage flag with a self-healing lifecycle so the client never ends up in a tokenless degraded session:

- **Flag = "a refresh token is on file" (`google_refresh_established`).** `signIn` sends `prompt=consent` iff the flag is **absent**.
- **Set** the flag on any token acquisition that proves a refresh token exists: a successful silent refresh (`handleRefreshSuccess`) and a successful interactive OAuth code exchange.
- **Clear** the flag whenever the refresh token is known gone/invalid: silent-refresh failure (`handleRefreshFailure`) and cold-start bootstrap-refresh failure.
- Net effect: consent (and the email) fires **only** when we genuinely lack a refresh token (first auth, or after the token expired/was revoked/cookie cleared) — exactly when Google must issue a new one. A returning user with a live `rt` cookie refreshes silently → no email. A user who clears only localStorage self-heals: the next cold-start silent refresh succeeds (cookie still present) and re-sets the flag, no consent prompt.
- **No backend change needed** for refresh-token retention: `/auth/token` already sets the `rt` cookie only when Google returns a non-empty `refresh_token` (`AuthEndpoints.cs:30`), so a `prompt`-less re-auth that returns no token never clobbers an existing cookie. Locked with a regression test.

**Repro:**
1. Sign in to the app (complete the Google flow).
2. Check the Google account's email — a "Sign in with Google" summary arrives.
3. Repeat sign-in → another email each time.

**Acceptance criteria:**
- [x] `buildAuthUrl(..., forceConsent)` emits `prompt=consent` when `forceConsent` is true and omits `prompt` when false; `access_type=offline` is sent in both cases.
- [x] `signIn` passes `forceConsent = !isRefreshEstablished()` — a returning user (flag set) gets no `prompt=consent`; a first-time user (flag absent) does.
- [x] The `google_refresh_established` flag is set on a successful silent refresh and on a successful interactive exchange, and cleared on **all** refresh-failure paths — scheduled, tab-visibility, cold-start bootstrap, **and the api-layer 401** (`setOnRefresh` null branch; the last was a Hawk catch — without it a fetch-driven 401 left the flag set and looped the session at ~1h).
- [x] The backend never clobbers an on-file refresh token with an empty one: `POST /auth/token` with a Google success that carries **no** `refresh_token` sets **no** `rt` cookie — regression test in `AuthTokenExchangeTests`.
- [x] Existing auth tests stay green (BUG-15 cold-start refresh, token refresh, sign-in/out).

**Key files:** `web/src/auth/pkce.ts` (`buildAuthUrl` `forceConsent`), `web/src/auth/AuthContext.tsx` (`signIn` decision + flag set/clear across `handleRefreshSuccess`/`handleRefreshFailure`/`setOnRefresh`/exchange/cold-start), `web/src/auth/tokenStore.ts` (flag helpers, fail-safe to force-consent); tests `web/src/__tests__/AuthUrl.test.ts`, `web/src/__tests__/ConsentPrompt.test.tsx`, `tests/Api.Integration/AuthTokenExchangeTests.cs`. The backend `/auth/token` non-clobber guard (`AuthEndpoints.cs:30`) needed no change. Related: [BUG-11] (refresh-token flow), [BUG-15] (cold-start silent refresh).

---

## BUG-17 — Concurrent multi-word tag add silently drops a tag (no handler retry on conflict)

**Status:** ✅ Done (PR #217, deploy #506, 2026-06-10). `NoteCommandHandler.ExecuteAsync` now wraps read→rebuild→handle→append in a bounded retry (4 attempts, ~170ms worst-case) on `ConcurrencyException`; `untagNote()` treats 404/409 as OK. Deploy #506 ran the `TagsJourney` E2E **14/14 green** — the previously change-independent flake is resolved.

**Severity:** Medium — a user pasting space-separated tags (e.g. `1:1s Bill`) loses one server-side; the lost tag's pill then resists removal (untag 404s and rolls back). Backend half of the flaky `TagsJourney` E2E; a real lost write. BUG-14 fixed the frontend optimistic-cache half; the events still race on the backend.

**Symptom:** Two near-simultaneous `POST /notes/{id}/tags` on the same note stream both read the same version; the second `AppendAsync` throws `ConcurrencyException` and the tag is dropped. The frontend treats the resulting 409 as success, so the UI shows a pill with no backing event. Removing that pill `DELETE`s a tag the stream never had → 404 → untag rollback re-inserts the phantom pill.

**Root cause (confirmed by code read):** `NoteCommandHandler.ExecuteAsync` does `ReadAsync → Rebuild → handle → AppendAsync(expectedVersion)` with **no retry** on `ConcurrencyException`. BUG-4 mapped the conflict to a clean 409 but never retried — so a benign race still loses the write. The aggregate is pure and tag commands are idempotent (`TagNote` no-ops a duplicate via 409, `UntagNote` 404s a missing tag), so re-reading and re-running the command on the fresh version is safe.

**Expected behaviour:** A benign concurrency race on a note write transparently retries (re-read, rebuild, re-run, re-append at the fresh version) and persists. Both concurrent tag adds end up on the note. A genuine persistent conflict still surfaces as 409 after bounded attempts.

**Scenarios (GWT):**
- Given a note tagged at version N, When two adds of different tags race and the first append wins, Then the handler retries the second on version N+1 and **both tags persist**.
- Given both tags persisted, When either tag is removed, Then the remove returns success (no 404 bounce-back).
- Given a frontend untag whose tag is already absent server-side, When `DELETE /notes/{id}/tags/{tag}` returns 404 or 409, Then the client treats it as success (no rollback, no phantom pill re-insert).
- Given a persistent (every-attempt) conflict, When the bounded retries exhaust, Then the conflict surfaces as 409 (BUG-4 behaviour preserved).

**Acceptance criteria:**
- [x] Two concurrent tag adds on the same note both persist server-side (handler retries the loser on the fresh version).
- [x] A subsequent remove of either tag succeeds — no 404 bounce-back.
- [x] The retry lives in the command handler; the aggregate stays pure (no clock/IO/retry in `Note`).
- [x] A persistent conflict still maps to 409 after bounded attempts (BUG-4 regression held).
- [x] Frontend `untagNote()` treats 404 and 409 as OK (matches `tagNote()` accepting 409), so removing an absent tag never rolls back and re-inserts a phantom pill.
- [x] A failing spec reproduces the dropped-write before the fix and passes after (`ConflictingEventStore` forces a one-shot conflict; handler retries and the tag persists).

**Key files:** `src/Api/CommandHandlers/NoteCommandHandler.cs` (`ExecuteAsync` retry loop), `web/src/api/tags.ts` (`untagNote` ok-statuses); tests `tests/Api.Integration/ExceptionMappingTests.cs`, `tests/Api.Integration/ConflictingEventStore.cs`. Related: [BUG-4] (conflict→409 mapping), [BUG-14] (frontend optimistic-cache half).

---

## BUG-18 — Removing an inline image (or any content edit) is silently not persisted

**Status:** Done — fixed in PR #232 (squash commit `3dd8b31`), deployed to main 2026-06-11 (deploy #520).

**Severity:** High — silent data loss. A user removes an inline image, leaves the note, reopens it, and the image is back. The same gap drops *any* content edit not followed by an editor blur.

**Symptom:** Remove an inline image via the ✕ control, click "Save", reopen the note — the image reappears. Reported alongside a 403 on the image URL ([BUG-19], cosmetic, separate).

**Root cause (confirmed from code + prod event history):** note content is persisted from **exactly one** place — the editor body's `onBlur` (`web/src/components/NoteView.tsx:502`, `onBlur={handleSaveContent}`). Nothing else saves it:
- The "Save" button (`NoteView.tsx:326`) calls `handleBack` → `onBack()` — it **navigates without saving**. It only works for typed text because moving focus to the button blurs the already-focused editor first.
- Removing an image (`ImageNodeView.tsx:19-20`) uses `onMouseDown={(e) => e.preventDefault()}` to preserve selection, which **keeps focus off the editor body**. `deleteNode()` updates the doc and sets `contentDraft` via `onUpdate`, but if the editor body was never focused (note just opened — focus is on the title input), **no blur fires**, so `handleSaveContent` never runs. `contentDraft` holds the removal in memory; navigating away discards it; the server keeps the image.
- There is no unmount flush and no `beforeunload` save.

**Prod evidence (note `b2400cfa-7ee3-4b26-a731-cf6bc40c3f32`, `notetaker-events`):** image added at v14 (06-11 07:26), note reopened/renamed at v15 (08:29) and v16 (08:58) with the image still present, removal finally persisted at v17 (09:02) — ~1.5h and several reopens after the user first tried to remove it. Classic flaky-save signature: the removal only stuck once a blur-save happened to fire.

**Why it shipped:** the 25-D E2E (`NoteImageJourney.Remove_…`) uploads then removes **without ever persisting the image into server content**, so the final content PUT is `"" == ""` — a backend no-op (`Note.HandleEditContent` returns `[]` on unchanged content) — and the test passes regardless of whether the save actually carried the removal. It never proves a *persisted* image gets removed.

**Expected behaviour:** Leaving a note (Save button, back, or unmount) persists any pending `contentDraft`. Removing an image, or any edit, survives reopen — independent of whether the editor body was focused/blurred.

**Repro:**
1. Open a note, add an image, and ensure it is saved to the server (blur the editor, reopen — image present in content).
2. Reopen the note; immediately hover the image and click ✕ (do not click into the editor text first).
3. Click "Save".
4. Reopen the note — the image is back.

**Acceptance criteria:**
- [x] A failing test reproduces the gap before the fix: an un-blurred content edit is lost on leave/unmount (`NoteView.test.tsx` "content flush on leave" — Save-flush and unmount-flush red before, green after).
- [x] Pending `contentDraft` is flushed when leaving the note — on the Save/back path **and** on unmount — not only on editor blur.
- [x] No double-save / no spurious save: a single ref-guarded `handleSaveContent` clears the draft ref before mutating, so blur+leave (or Save+unmount) can't double-fire; no save when there is no draft; no save when leaving via Delete (`deletingRef`).
- [x] Save failure restores the draft ref so a later leave retries the kept text rather than dropping it (Hawk catch — narrowed reincarnation of the same loss class).
- [x] E2E gap closed: `NoteImageJourney.Remove_…` now persists the image to the server before removing it (the old test removed a never-persisted image, a no-op PUT).
- [x] Existing note-content save/draft tests stay green (full frontend suite 475 green post-merge).

**Fix:** `NoteView` mirrors `contentDraft` into a ref and flushes it on leave (Save/back) and on unmount via one ref-guarded `handleSaveContent` (also the blur handler). The ref is cleared before mutating (dedup) and restored in `onError` (retry-on-leave). `deletingRef` (set in both delete entry points) skips the unmount flush when deleting. BUG-19 placeholder fix shipped in the same PR.

**Key files:** `web/src/components/NoteView.tsx` (ref-guarded `handleSaveContent`, unmount-flush effect, `deletingRef`); tests `web/src/__tests__/NoteView.test.tsx` (flush-on-leave block), `tests/Browser.E2E/Journeys/NoteImageJourney.cs` (persist-then-remove). Related: [BUG-19] (shipped together), 25-D (remove-inline-image slice).

---

## BUG-19 — Inline image flashes a 403 on every open (raw key rendered before resolve)

**Status:** Done — fixed in PR #232 (squash commit `3dd8b31`), deployed to main 2026-06-11 (deploy #520).

**Severity:** Low — cosmetic. A failed request + broken-image flash on each open; the image then loads once resolve completes. No data impact.

**Symptom:** On opening a note with an inline image, the browser logs `403` for e.g. `https://note-taker-ai.com/notes/notes/{noteId}/{imageId}.png` (note the doubled `notes/notes`). The image renders correctly a moment later.

**Root cause:** `ImageNodeView` (`web/src/components/ImageNodeView.tsx:13`) renders `<img src={src}>` where, on first paint, `src` is the bare S3 **key** (`notes/{noteId}/{img}.png`) loaded from content. The async `resolveImages` → `swapImageSrc` (`NoteEditor.tsx:204-227`) only replaces it with a presigned S3 URL after the round-trip. In the gap, the browser resolves the bare key **relative to the SPA route** `/notes/{id}` → `https://note-taker-ai.com/notes/notes/{noteId}/{img}.png` → 403 (no such route/object; S3 objects are only reachable via presigned URLs). The doubled `notes/notes` is the relative-URL resolution, not a malformed stored key (verified: stored key is the correct single-prefix `notes/{noteId}/...`).

**Expected behaviour:** No failed image request and no broken-image flash before resolve. The browser never fetches an unresolved key as a relative URL.

**Repro:**
1. Open a note with a saved inline image, DevTools Network open.
2. Observe a `403` on `…/notes/notes/{noteId}/{img}.png` on load, then the image appears.

**Acceptance criteria:**
- [x] No request is made for a bare image key on open: `ImageNodeView` renders a placeholder `<span>` while `isImageKey(src)` (or `src` is empty), so the browser never fetches the unresolved key as a relative URL.
- [x] Once resolve swaps in the presigned URL, the real `<img>` renders as before.
- [x] A `blob:` upload preview (not a bare key) still renders as an `<img>` immediately — `isImageKey` only matches stored keys (`ImageNodeView.test.tsx`).

**Fix:** `ImageNodeView` computes `unresolved = !src || isImageKey(src)` and renders a styled placeholder span instead of an `<img>` until `resolveImages` swaps the key for a presigned URL. The doubled `notes/notes` in the 403 URL was confirmed to be browser relative-URL resolution, not a malformed stored key.

**Key files:** `web/src/components/ImageNodeView.tsx`, `web/src/components/ImageNodeView.module.css` (`.placeholder`); tests `web/src/__tests__/ImageNodeView.test.tsx`. Related: [BUG-18] (shipped together), 25-B (resolve flow), 25-D (NodeView).

---

## BUG-21 — Note title silently lost when navigating in and out of a note

**Status:** Done — fixed in PR #258 (squash `279aef1`), deployed to main 2026-06-13 (deploy #547). See [docs/learnings/phase-bug21-note-title-draft-reconcile.md](../learnings/phase-bug21-note-title-draft-reconcile.md). Reported from the live app: a note that held a meeting-derived title ("Interview: Simon Kirkham (VP of Software Engineering)") showed an empty "Note title…" placeholder after navigating away and back.

**Severity:** High — silent, permanent data loss. The real title is overwritten with an empty string in the event stream, not merely mis-displayed.

**Symptom:** Open a note whose title was set (e.g. derived from a linked meeting), navigate out and back in, and the title field renders empty (placeholder). The blank then persists.

**Root cause (confirmed by code read):** two faults compound.
1. **Title is never reconciled with the authoritative `detail.title`.** In `NoteView.tsx` the title is `const [title, setTitle] = useState(initialTitle)` (line 66) — seeded **once** from the `initialTitle` prop and never resynced when `useNoteDetail` resolves. `initialTitle` is `navState?.initialTitle ?? notes.find((n) => n.noteId === noteId)?.title ?? ""` (`App.tsx:394`); navigation paths that pass no title (`onOpenNote(noteId)` — e.g. `MeetingsSection.tsx:260`, `App.tsx:334`) fall back to the card-cache title, and when that is empty/stale the field shows `""` even though the loaded `detail.title` holds the real title. Content and date use a draft pattern (`contentDraft ?? detail?.content`, `dateDraft ?? detail?.date`); **title has no equivalent** — it is the one editable field not backed by `detail`.
2. **The empty value is then persisted.** The title input auto-focuses on open (`NoteView.tsx:146-148`) and its `onBlur={(e) => onRename(noteId, e.currentTarget.value)}` (line 409) fires on the next click/navigation. `HandleRename` (`src/Domain/Notes/Note.cs:102-108`) has **no empty/whitespace guard** — `if (cmd.NewTitle == _title) return []` else emit `NoteRenamed(noteId, "")`. So a blur with the stale-empty value writes `NoteRenamed("")`, the optimistic patch wipes the card title too, and the title is gone permanently.

**Expected behaviour:** The title field always reflects the persisted `detail.title` once loaded (via a draft pattern mirroring content/date), so it never shows empty for a titled note; and a rename to empty/whitespace is rejected (or treated as a no-op) so the title can never be silently overwritten with blank.

**Repro:**
1. Open a note with a non-empty title (e.g. created from a meeting).
2. Navigate back to the list, then reopen the same note via a path that passes no title (linked-meeting "Open note", or the list when the card title is empty/stale).
3. Observe the title field empty; click into the body (blurs the title input).
4. Reopen — the title is now blank in the stream.

**Acceptance criteria (for the fix):**
- [x] A failing test reproduces the loss before the fix: opening a note whose `detail.title` is non-empty while `initialTitle` is `""` shows the real title, and a blur does not overwrite it with empty.
- [x] Title uses the draft pattern — displayed = `titleDraft ?? detail?.title ?? initialTitle`; a refetch never clobbers in-flight typing; draft resets on successful rename.
- [x] `HandleRename` rejects/no-ops an empty-or-whitespace title (domain guard — `string.IsNullOrWhiteSpace` → no event) — guarded by a domain spec — so blank can never be persisted.
- [x] Existing note title/rename and draft tests stay green.

**Fix:** title migrated to the draft pattern in `NoteView.tsx` — `title = titleDraft ?? detail?.title ?? initialTitle`, so it reconciles to the authoritative loaded title instead of being seeded once. `handleSaveTitle` (blur) discards the draft without PATCHing on empty/whitespace/unchanged, and keeps the typed title (with an error toast) on save failure. The rename now goes through a new keystone mutation `useRenameNoteDetail` (patches `keys.note` on success, invalidates `keys.noteCards` on settle — identical to `useEditContent`/`useSetNoteDate`), replacing the dead cards-only `useRenameNote` and the `onRename` prop chain through `App`/`NoteRoute`. Defence in depth: `Note.HandleRename` no-ops on `string.IsNullOrWhiteSpace(cmd.NewTitle)`.

**Key files:** `web/src/components/NoteView.tsx` (title draft + `handleSaveTitle`), `web/src/hooks/useNoteDetailMutations.ts` (`useRenameNoteDetail`), `web/src/hooks/useNoteMutations.ts` (removed `useRenameNote`), `web/src/App.tsx` (removed `onRename` chain), `src/Domain/Notes/Note.cs` (`HandleRename` guard); tests `web/src/__tests__/NoteView.test.tsx`, `tests/Domain.Specs/Notes/RenameNoteSpec.cs`. Related: [BUG-18] (same un-flushed-edit / draft-pattern family), 20-E (note-detail draft pattern).

---

## BUG-22 — Multi-tag add drops a pill under RYW-2 async reads — consistency-token slot overwritten by an older version

**Status:** ✅ Done — PR #262, deploy #551 (2026-06-13); surfaced on deploy #546. Resolves the reopened **[TI-19](../technical-improvements.md#ti-19-stabilise-the-flaky-tagsjourney-e2e-post-deploy-gate-fails-intermittently)** flaky `TagsJourney` E2E — #551 ran the `Browser.E2E` suite 20/20 green on the first attempt.

**Severity:** Medium — intermittent: a user pasting space-separated tags (e.g. `1:1s Bill`) sees one pill transiently fail to render after the optimistic UI reconciles against a too-early gated read. Self-heals on the next clean read/navigation, but it red-flags the post-deploy E2E gate and blocks unrelated merges (the "main's latest deploy must be green" rule).

**How it surfaced:** deploy #546 (PR #255, RYW-2) failed `deploy-test` twice and passed only on attempt 3:
| Attempt | Test | Symptom |
|---|---|---|
| 1 | `RemoveTag_GoneAfterNavigation` | `TimeoutException 30000ms` waiting for `Bill`'s remove button (pill never rendered) |
| 2 | `RemoveTag_PillDisappears` | `ToBeVisible 15000ms` — `1:1s` pill not visible |

Both are the _dropped-add_ signature (a pill from `AddTagAsync("1:1s Bill")` never renders), not a removal bug.

**Root cause (confirmed by code read):** PR #255 (RYW-2) made the whole Note aggregate **async** — the projector is the sole writer of note read models, each note write returns its stream version in `X-Consistency-Token`, and `GET /notes/{id}` gates on that token (`If-Consistent-With`). Tags are a note-aggregate flow, so a tag write captures a token. But:
1. `AddTagAsync("1:1s Bill")` fans out into **two concurrent same-stream POSTs**. The backend (BUG-17 retry) appends them at sequential versions → returns `note#id@N` and `note#id@N+1`.
2. Both responses call `captureNoteToken` → `setStreamToken(stream, token)`, which was **last-writer-wins with no version compare** (`web/src/api/consistencyTokens.ts`). Whichever HTTP response resolves **last** owns the single slot — so ~half the time the older `@N` wins.
3. The fresh-note reconcile path in `useTagMutations.onSettled` (invalidate `keys.note` when `ctx.previous === undefined`) fires a gated `GET /notes/{id}` carrying `If-Consistent-With: note#id@N`.
4. The server waits only until the projector folded version N (the first tag), then answers **fresh** (not `stale` — the token it was handed _is_ satisfied). The second tag (`@N+1`) may not be folded yet → response omits it → clobbers the optimistic pill. `gatedRead`'s stale-retry loop can't rescue it because the server never flags `stale`.

This is the CLAUDE.md guardrail in action: RYW-2 flipped the whole Note aggregate sync→async in one slice; the single-call RYW proof didn't cover the concurrent same-stream multi-write token case. Every historical TI-19 failure was on a test doing `AddTagAsync("1:1s Bill")`; single-tag tests never failed — consistent with this race.

**Fix:** keep the **highest** version in the token slot.
- `setStreamToken` keeps the higher version (the slot key already pins the stream; versions are monotonic, so a version compare is strictly correct).
- `setLatestToken` keeps max-version **only** when the stored token is the same stream — a write to a _different_ stream still moves the "latest write" pointer regardless of version (design #7).

**Repro (deterministic test):** `web/src/__tests__/noteConsistency.test.tsx` — two concurrent `tagNote` writes where the lower version resolves last leave the **higher** token in the slot; plus direct `setStreamToken`/`setLatestToken` version-ordering and cross-stream cases.

**Acceptance criteria:**
- [x] A test reproduces the regression: a lower same-stream version captured last must not win the slot (red before the fix).
- [x] `setStreamToken` keeps the higher per-stream version; a genuinely newer write still advances it.
- [x] `setLatestToken` keeps max-version for the same stream but replaces on a different stream (design #7 preserved).
- [x] Existing RYW note/todo consistency tests stay green.

**Key files:** `web/src/api/consistencyTokens.ts` (the fix); tests `web/src/__tests__/noteConsistency.test.tsx`. Related: [BUG-14], [BUG-17] (earlier inline-projection-era halves of the same flaky journey), RYW-2 (PR #255), [TI-19](../technical-improvements.md).

**Follow-up (done, separate PR):** the `TagsJourney` tag-pill assertions were made reload-tolerant — `AssertTagPillVisibleAsync`/`AssertTagPillAbsentAsync` now reuse `WaitVisibleWithReloadAsync` / a new `WaitHiddenWithReloadAsync`, so a still-warming projector re-sends the consistency token and re-gates instead of hard-timing-out (mirrors the RYW `AssertTodoVisibleAfterReloadAsync` pattern). The token-slot fix above is the correctness fix; this is its test-robustness complement.
