# Technical Improvements

Technical, infrastructure, and developer-experience items to address in the future. These are **not user-facing features** — they're refactors, upgrades, CI/CD work, and hardening that keep the system healthy. Review this list when planning a phase or when an item becomes urgent.

For the other tracks see:

- **Features** → [docs/future-features.md](future-features.md)
- **Bugs** → [docs/phases/phase-bugs.md](phases/phase-bugs.md)
- **Minor tweaks & changes** → [docs/phases/phase-minor-changes.md](phases/phase-minor-changes.md)

Each entry records what it is, why it matters, where it was raised, and any dependency. **The Summary table below is the at-a-glance index — scan its Status column for what's outstanding, and keep that cell in sync when an item is actioned** (the detailed section for each item carries the full status + history).

## Summary

Status key: 🔲 **Open** · 🟡 **Partly done / mitigated** · ✅ **Done** (graduated to a phase, or actioned in place). Outstanding work is every 🔲 and 🟡 row.

| ID    | Item                                                                           | Status                                                                                                                                  |
| ----- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| TI-1  | Decide on a server-state library (TanStack/SWR) vs hand-rolled                 | ✅ Done — ADR 0010 (stay hand-rolled)                                                                                                   |
| TI-2  | Stricter TypeScript compiler flags beyond `strict`                             | ✅ Done — → Phase 19 (19-B/19-C)                                                                                                        |
| TI-3  | Frontend state-management hygiene — colocation + Context perf                  | 🟡 Partly — Context perf done (19-D); **colocation Open** (ongoing convention)                                                          |
| TI-4  | Core Web Vitals — bundle budget + CLS + transitions                            | ✅ Done — → Phase 19 (19-I)                                                                                                             |
| TI-5  | Network resilience — retry transient failures with backoff                     | ✅ Done — 20-G                                                                                                                          |
| TI-6  | XSS hardening — allowlist URL schemes on `href`/`src`                          | ✅ Done — → Phase 19                                                                                                                    |
| TI-7  | ESLint `jsx-a11y` + `import` rules + `@/` alias                                | 🟡 **Partly** — `@/` alias, `import-x/order`, **jsx-a11y (19-F3)**, **typed-lint (19-B `recommendedTypeChecked`)** all done; only `import-x/no-unresolved`/`no-cycle` (needs `eslint-import-resolver-typescript`) remain |
| TI-8  | Migrate `App.css` to CSS Modules                                               | ✅ Done — 14-P                                                                                                                          |
| TI-9  | Upgrade GitHub Actions to Node.js 24                                           | ✅ Done                                                                                                                                 |
| TI-10 | Resolve ESLint warnings in `AuthContext.tsx`                                   | ✅ Done — #172                                                                                                                          |
| TI-11 | Add `cdk synth` to the pre-commit hook                                         | ✅ Done — #208                                                                                                                          |
| TI-12 | Split the single API Lambda (CQRS + async projectors)                          | ✅ Done — → Phase 27 (Stage 1)                                                                                                          |
| TI-13 | Reduce Lambda SnapStart costs                                                  | ✅ Done                                                                                                                                 |
| TI-14 | Break down the monolithic `App.css`                                            | ✅ Done — 14-P (merged into the CSS-Modules migration)                                                                                  |
| TI-15 | Add a shared modal focus-trap utility                                          | ✅ Done — #211                                                                                                                          |
| TI-16 | Make the projection-rebuild endpoint robust                                    | ✅ Done — → Phase 24                                                                                                                    |
| TI-17 | Auto-backfill a new projection on deploy                                       | 🔲 **Open** — still a real gap (no rebuild step in `.github/workflows`); P24 dependency now cleared. P23 shipped, so re-home as a standalone deploy-job step / next projection-adding slice |
| TI-18 | Rebuild emits delete tombstones for `NoteSearchView`                           | ✅ **Done** — Phase 24-B upsert-and-reconcile prunes deleted notes + hard-deletes stale tombstones                                       |
| TI-19 | Stabilise the flaky `TagsJourney` E2E                                          | ✅ **Done** — correctness fix [BUG-22](phases/phase-bugs-archive.md#bug-22--multi-tag-add-drops-a-pill-under-ryw-2-async-reads--consistency-token-slot-overwritten-by-an-older-version) (deploy #551, E2E 20/20 first-try); residual test-robustness follow-up closed — tag-pill assertions now reload-tolerant |
| TI-20 | `WorkspaceList` reads via full table Scan, not a per-user GSI                  | 🔲 **Open** — confirmed still `Scan`+`ConsistentRead` (`DynamoDbWorkspaceListStore`); P23 shipped without it, so "fold into P23" is moot — re-home as a standalone GSI slice (pair with TI-33) |
| TI-21 | CI pipeline hygiene — skip no-op deploys, cancel superseded, cache Playwright  | ✅ Done                                                                                                                                 |
| TI-22 | Skip backend publish + `cdk deploy` on frontend-only pushes                    | ✅ Done — `detect-changes` gate (2026-06-11)                                                                                            |
| TI-23 | Generalise append-retry-on-conflict beyond `NoteCommandHandler`                | 🔲 **Open (deliberately deferred)** — `ActionItemCommandHandler` has no retry by design (single-user app). BUG-28 already added store-level `TransactionConflict`→`ConcurrencyException` for all aggregates; only the shared retry-loop extraction is left — do it only if a 2nd handler needs it |
| TI-24 | `deploy-production` hangs at "Configure AWS credentials"                       | 🟡 Mitigated — `timeout-minutes` shipped (#222); **root cause Open**                                                                    |
| TI-25 | Add a `NoteEditor` component test for the image-ordering invariant             | 🔲 **Open** — `NoteEditor.test.tsx` now exists (link-hardening + BUG-24 resolve-before-parse) but does **not** cover the 25-B paste→presign→PUT invariant (no `blob:`/unmapped `src` reaches `onChange`; PUT failure removes the node); add those cases |
| TI-26 | Zero-downtime deployments — frontend stale-chunk 404s; backend canary/rollback | ✅ Done — → Phase 26                                                                                                                    |
| TI-27 | Frontend build Node 20 → 24 + lockfile regen (dep-audit T1)                    | ✅ Done — #237, deploy #528                                                                                                             |
| TI-28 | ASP.NET 10 servicing + AWS SDK patch bumps (dep-audit T7)                      | ✅ Done — #241, deploy #530                                                                                                             |
| TI-29 | Vite 5 → 7 + Vitest 2 → 4 (dep-audit T2)                                       | ✅ Done — #245, deploy #535 (held at Vite 7; Vite 8 now GA = future)                                                                    |
| TI-30 | React 18 → 19 (dep-audit T3)                                                   | ✅ Done — #246, deploy #536 (zero code changes)                                                                                         |
| TI-31 | TypeScript 5.6 → 6.0 (dep-audit T4)                                            | ✅ Done — #249, deploy #539 (dropped deprecated `baseUrl`)                                                                              |
| TI-32 | Prime the ASP.NET pipeline before the SnapStart snapshot (first-request ~7 s)   | ✅ **Done** — #260, deploy #552. Priming hook live; cold p50 7.92→4.82 s (−39%, n=7 prod). Residual CPU gap → TI-36                  |
| TI-33 | `NoteCardList` reads via full-table `Scan` + `ConsistentRead`, not a GSI/Query  | 🔲 **Open** — confirmed still `Scan`+`ConsistentRead` (`DynamoDbNoteCardListStore`); ~840 ms at 234 rows, O(all notes). P23 shipped without it — re-home as a standalone GSI slice with TI-20; also re-check whether `ConsistencyGate` makes the strong read redundant |
| TI-34 | Make Lambda naming specific & correct everywhere                                | 🔲 **Open — premise updated** — 27-D **shipped**, so the live functions ARE **Command + Query + Projector** Lambda (CDK ids correct). But ~20 docs + `CLAUDE.md` still say "API Lambda"/"the Lambda"/"single Lambda"; audit + reconcile to the post-27-D names |
| TI-35 | ReadyToRun-publish the API Lambda (AOT-precompile to cut first-request JIT)     | ✅ **Done** — #260, deploy #552. R2R live (IL_ONLY cleared on Api/AWSSDK/JwtBearer); part of the −39% cold-start cut. Pairs with TI-32 |
| TI-36 | Raise API Lambda memory 256→512 MB to cut residual cold-start CPU time          | ✅ **Done** — #270, deploy #562. 512 MB live (prod config confirmed); cold p50 4.82→2.24 s, warm 118→29 ms. End-to-end 7.92→2.24 s (−72%) |
| TI-37 | Capture **all** frontend errors in RUM — failed resource loads (`<img>` 403s) are invisible | ✅ **Done** — #268, deploy #557 (2026-06-13). Capture-phase `window` error listener forwards `<img>`/`<script>`/`<link>` load failures to RUM via `cwr('recordError')` (rides `JsErrorCount`); real JS errors skipped to avoid double-count. Dashboard widget retitled |
| TI-38 | Expected 409/404 outcomes log at `Error` on the ops dashboard — framework double-logs | ✅ **Done** — #267, deploy #556 (2026-06-13). Replaced `UseExceptionHandler` with a try/catch middleware that maps every exception itself, removing ASP.NET's `ExceptionHandlerMiddleware` from the pipeline — each request now logs exactly one line at the `Map()`-implied level (Warning for 409/404, Error once for 500s) |
| TI-39 | Chronic cold-start E2E flakiness red-gates nearly every deploy | ✅ **Done** — 2026-06-13. Was **four stacked causes**, not one (BUG-26 umbrella): projector cold-lag → fixed by a warm-up that **drains the projector to head** before the suite + 15 s global Expect timeout + reload-tolerant asserts **and actions**; plus two real bugs found en route ([BUG-27] lost-write contention, [BUG-29] projector image-purge IAM). Residual concurrent-multi-tag race carved out as [BUG-28] (quarantined). Write-up: [docs/learnings/deploy-gate-deflake-stacked-causes.md](learnings/deploy-gate-deflake-stacked-causes.md) |
| TI-40 | Scoped read-only AWS creds so a cloud routine can run `observability-review` automatically | 🔲 **Open** — raised 2026-06-13. The `observability-review` skill exists but a scheduled **cloud** agent can't reach prod (`--profile prod` is local-only), so a weekly automated sweep is impossible today. Add a least-privilege read-only CloudWatch-Logs/Metrics + RUM + X-Ray role (OIDC-federated, no static keys) the cloud runner can assume, connect GitHub, and wire the weekly routine |
| TI-41 | Fold the `GetActions` cross-stream re-poll into `ConsistencyGate` (existence wait)            | ✅ **Done** — #289, deploy #589 (2026-06-15) via **Option B**. `GetActions` had a hand-rolled `Task.Delay(100)×10` loop *beside* the gate to ride out note-vs-action cross-stream projector lag. Added `IConsistencyGate.WaitForPresenceAsync<T>` (bounded presence-poll, shares the version wait's interval/cap/delay/logging) and replaced the loop with it — the only `Task.Delay` flagged as a smell in the 2026-06-14 audit is gone |
| TI-42 | Residual E2E flake — post-reload cards list reads empty (`FilterBackNavigation`/`NoteDelete`/`NoteReadYourWrites`) | 🟢 **Fixed pending confirmation** — PR #390, deploy #694 (2026-07-01, green attempt 1). **Root cause was NOT workspace-context (all failed reads were correctly `/w/__default__/`)**: after a reload the app had already consumed+cleared the sessionStorage RYW token, so `GET /notes/cards` went out **ungated** and merely *raced* the async projector (`200`/empty for the full 30s); the reload-tolerant assert's 2.5s per-attempt timeout was also below the 8s server gate cap, aborting even a gated read mid-converge. Fix (test-only): re-inject the captured note-write token as `If-Consistent-With` on every post-reload cards read (so the read WAITS for the projector), raise the per-attempt timeout to 9s, and log `X-Consistency` per read so any residual is provable. **Confirm over the next several deploys** (flake was ~2/15, so one green ≠ proof). Follow-up: the sibling ungated-reload helpers (`WaitVisibleWithReloadAsync`, `AssertCardTagVisibleAfterReloadAsync`) carry the same latent race — generalise if they flake |
| TI-43 | Hard 120 s per-test E2E timeout so no test can hang the deploy gate                          | ✅ **Done** — PR #293, deploy #595 (2026-06-17). `E2EFactAttribute : FactAttribute(Timeout=120_000)` across all journeys. Closes the 44-min-hang class (PR #291). Verified it fires (xUnit `Timeout` is silently ignored when parallelization is disabled — confirmed via a throwaway probe) |
| TI-44 | Close BUG-31 layer 3 — note-detail read hangs `loadingDetail` ~30 s after reopen+edit         | 🔲 **Open** — raised 2026-06-17. The 3rd of BUG-31's stacked causes (layers 1-2 fixed). Post-removal `save-button` is `disabled={loadingDetail}` and `useNoteDetail` stays `isLoading` ~30 s → `ClickAsync` times out (~1/4). A stuck/slow gated note-detail read; needs evidence-through-the-thrown-message instrumentation. Also a potential real UX cliff (save disabled 30 s) |
| TI-45 | `lazyChunkError` RUM event isn't alarmable — uses `recordEvent`, not `recordError`                | 🔲 **Open** — raised 2026-06-18 (Hawk nit, PR #300). 19-I1's `LazyNoteEditor` reports a failed editor-chunk import via `recordRumEvent('lazyChunkError', …)` → `cwr('recordEvent')`, which lands in the RUM log group (consistent with the `deadNoteLink` precedent) but does **not** increment `JsErrorCount` or fire the error-rate alarm. Deliberate at ship (meets the 19-I1 spec). Decide whether a failed editor load should be *alarming* — if so, route it through `recordError` like `rum.ts:reportResourceError`. Low urgency (lazy-chunk failures are rare and self-heal via the chunk-reload guard) |
| TI-46 | Pre-tokenize search fields into the `NoteSearchView` projection (search is O(notes × tokens × terms) per query) | 🔲 **Open** — raised 2026-06-22 (Hawk perf note, PR #312/BUG-35). The word-level ranker re-tokenizes every field (`Title`/`Body`/`FinalNotesText`/`ActionItemsText`/each tag) of **every** note on **every** query — a `GeneratedRegex.Split` + LINQ per field plus an O(token²) `Fuzz.Ratio` per token for terms ≥ 4 chars. Fine at current single-user scale and the 50-result cap; **do not act until measured** (per the measure-first guardrail). When the corpus grows, fold the token list into the `NoteSearchView` projection at fold-time (one event-version bump + rebuild) so the per-query regex cost disappears and ranking reads precomputed tokens. Low urgency — premature at present volume |
| TI-47 | Calendar auth: replace the out-of-band SSM minting tool with proper in-app OAuth + a per-user server-side refresh-token store | ✅ **Graduated → [Phase 34](phases/phase-34.md)** (2026-06-23) — absorbed as Phase 34's in-app-OAuth foundation (34-A: token store + connect flow; 34-D: retire the SSM path). _Original note:_ Both Google (Phase 9) and Microsoft (32-A) mint a refresh token via a one-shot CLI into a single SSM parameter — fine for this single-user app, wrong for multi-user. The real pattern: in-app "Connect calendar" → OAuth auth-code + PKCE → backend exchanges the code → refresh token persisted **per user keyed by `sub`** (graduates onto the existing `DynamoDbRefreshTokenStore`/auth-tokens table) → self-service "reconnect" banner on `invalid_grant`. Aligns with Phase 30's Google server-side-token-store direction. Low urgency while single-user; prerequisite for ever sharing the app |
| TI-48 | Multipart/chunked upload for long call recordings (33-A buffers the whole WAV in memory) | 🔲 **Open** — raised 2026-06-23 (Phase 33-A). The recording upload buffers every PCM chunk in memory for the whole meeting and PUTs one WAV on Stop (~1.9 MB/min at 16 kHz mono 16-bit → a 2 h meeting ≈ 230 MB, approaching the 500 MB advisory cap). Fine for the single-user MVP. When long meetings matter, stream to S3 via multipart upload (flush buffered chunks past a threshold) so memory stays bounded and the upload overlaps the recording instead of firing all-at-once on Stop. Low urgency |
| TI-49 | ICS feed SSRF: close the DNS-rebinding TOCTOU with a `ConnectCallback` | 🔲 **Open** — raised 2026-06-25 (Phase 34-E, Hawk #2). `IcsUrlValidator.IsAllowed` resolves the user-supplied feed host and rejects private/internal IPs, but `HttpClient` then re-resolves DNS independently for the actual GET — so a rebinding host that answers public at check-time and private (e.g. `169.254.169.254` metadata) at fetch-time slips through (time-of-check ≠ time-of-use). The *trivially* exploitable redirect vector **is** closed (`AllowAutoRedirect=false`) and a 5 MB body cap is in. Accepted as a residual for the single-user app (the only "attacker" is the owner pasting a hostile URL into their own server). Fix: a `SocketsHttpHandler.ConnectCallback` on both ICS clients that resolves once, validates the connected `IPEndPoint` against `IcsUrlValidator`, and dials that IP directly (preserving the Host header for SNI/vhost) — so the IP checked == the IP connected to. Low urgency. Documented inline in `IcsUrlValidator.cs` + `docs/phases/phase-34.md` (34-E) |
| TI-50 | ICS feed: cache the fetched/parsed feed instead of re-downloading every read | 🔲 **Open** — raised 2026-06-25 (Phase 34-E). `IcsFeedCalendarClient` (v1) re-downloads **and re-parses the entire ICS feed on every meetings read** — each Home load, day-navigation, and reminder check — with no server-side cache (10 s timeout). Fine at single-user scale, and a published ICS already lags Outlook by hours so frequent re-fetching adds little. When it matters, add a short in-memory cache keyed by URL+date with a small TTL (a few minutes) so repeated reads in the window reuse the parsed result. Low urgency. Documented inline in `IcsFeedCalendarClient.cs` (class header) + `docs/phases/phase-34.md` (34-E decision #5) |
| TI-51 | Authorize workspace mutations from the event stream, not the async `WorkspaceListView` | 🔲 **Open** — raised 2026-06-25 (Phase 36-A, Hawk #1). All three workspace-mutation handlers (`RenameWorkspace`, `DeleteWorkspace`, `SetWorkspaceTheme`) gate ownership via `OwnsAsync` → `IWorkspaceListStore.GetAllAsync` (the **async** projection). Right after `POST /workspaces` the projector can lag, so a legitimate owner can get a spurious **404** (BUG-30 class). It is **fail-closed** (a lagging projection can only false-*deny*, never cross-user-*grant*) and the UI gates the picker behind the consistency-gated `GET /workspaces`, so it's not reachable in the real flow — hence low urgency, not a security hole. Fix **all three together** (don't diverge one handler): authorize from the event stream on the Command Lambda — read the stream and check the `WorkspaceCreated` envelope's `Metadata.UserId == currentUser` (user id rides the event metadata, see `ProjectionUpdater.ApplyWorkspaceEventsAsync`). Pairs with TI-20 (`WorkspaceList` GSI). Low urgency |
| TI-52 | Keep the Projector Lambda warm to eliminate cold-start read-your-writes lag | 🔲 **Open** — raised 2026-06-30 (observability-review; deferred alternative to the [BUG-31] fix). The projector is a stream-triggered .NET Lambda with **no SnapStart and no keep-warm** (`NoteTakerStack.cs:642`), so after an idle gap (overnight/weekend) its first invocation cold-starts ~7 s while the read gate waits only 2 s → a fresh note reads missing/stale (11 gate timeouts/14 d in prod, at morning low-traffic hours). **BUG-31 is fixed the cheap way instead** — raise the `ConsistencyGate` cap 2 s→8 s so the reader tolerates the cold start (zero cost). This TI is the *durable* follow-up if the one-off cold spinner still bothers: keep the projector warm so cold reads stay fast. Two ways — (a) **scheduled ping**: an EventBridge rule invokes the projector every ~5 min with a synthetic event the handler no-ops → **~$0.00/month** but needs a warmer code path + is "almost always" warm (AWS can still reclaim between pings); (b) **provisioned concurrency = 1**: guaranteed warm, no code change, but **~$5.40/month 24/7** (~$3.60 active-hours-only) — recurring spend the "match resilience cost to scale" guardrail disfavours for a single-user app (cf. the 26-C canary revert). Prefer (a) if picked up. Low urgency — the gate-cap fix already removes the user-visible failure. |
| TI-53 | `desktop/tests/*.spec.ts` never run in CI — the desktop suites are hand-run only | ✅ **Done** — delivered by #430 (deploy #728), written up as [TI-58](#ti-58-desktop-specs-run-in-the-pr-gate). **Filed twice:** raised here 2026-08-06 (Hawk, PR #417) and again as TI-58 on 2026-08-07 during [BUG-56], because the register was not checked before adding. Kept as the original record; TI-58 carries the detail. |
| TI-54 | Every MCP tool failure logs as an `Error` with no exception detail — expected not-founds pollute the error view, real faults are undiagnosable | 🔲 **Open** — raised 2026-08-06 (observability-review). Both halves of the [TI-38] problem at once. The MCP SDK logs `"get_note" threw an unhandled exception.` (logger `ModelContextProtocol.Server.McpServer`) at **Error** for a deliberately-thrown `McpException` — i.e. for an *expected* business outcome. Verified live: calling `get_note` with a nonexistent GUID against prod on 2026-08-06 12:45:22 produced exactly the line, and the 2 prod Errors in the 14-day window (2026-08-05 12:03, 2026-08-06 08:05, `user_agent: Claude-User`) are the same benign shape. **Over-reporting:** every "note not found" from an MCP client shows up in the dashboard "All errors" widget as a backend Error. **Under-reporting (the worse half):** the line carries **no `exception_type` and no `stack_trace`**, so a *genuine* unhandled fault inside any MCP tool is byte-identical to a benign not-found and cannot be diagnosed at all. Fix: log MCP tool outcomes ourselves — map a deliberate `McpException` to Warning and log real exceptions with type + stack (an invocation filter around the tool call), or drop the `ModelContextProtocol.Server.McpServer` category out of the Error view and emit our own truthful line. **Deploy-time: neutral** (logging config only). Medium urgency — the MCP surface is now large (35-F reads + 41-A writes) and is currently a blind spot |
| TI-55 | MCP `/mcp` connector — per-`sub` rate limiting + bound the per-call projection scans | 🔲 **Open** — raised 2026-06-25 (35-F dual security review, both APPROVE; the two non-blocking LOW findings). An allowlisted OAuth token can issue unbounded `tools/call`s (`MCP_ALLOWED_CIDRS` is empty = allow-all in prod), and `list_notes`/`get_action_items` do a full-table `Scan` per call. Item 2 folds into TI-33/TI-20 (same `Scan`→`Query` change). Cost/latency, not confidentiality — the user filter is correct. |
| TI-56 | Alarm on `RefreshTokenStoreWriteFault` (sustained > 0) | 🔲 **Open** — raised 2026-07-29 (`obs-auth-login`, PR #411). The metric ships; the Phase 30 obs table specced the alarm, consciously deferred to avoid churning the DefaultPolicy/alarm-count infra assertions in the observability slice. Add the alarm on the existing `notetaker-alarms` SNS topic and update the alarm-count assertion in the same slice. |
| TI-57 | `TodoList` read model is not wired into `ProjectionRebuildHandler` (projector-maintained only) | 🔲 **Open** — raised 2026-06-25 (Hawk nit, PR #350/37-A). The whole `TodoList` projection (todo + action rows, and now `Position` from 37-A) is built only by the async projector; `ProjectionRebuildHandler` has no `ITodoListStore`/`TodoListProjection`, so a rebuild can't re-derive it from the event stream — breaking the "projections are rebuildable" guardrail for this one read model. Pre-existing (not introduced by 37-A). Fix: wire `TodoListProjection` into `ProjectionRebuildHandler` mirroring `WorkspaceListProjection`. Low urgency (projector is the steady-state writer; no backfill needed today) |
| TI-58 | Desktop specs run in the PR gate (headless + Electron under xvfb) | ✅ **Done** — this slice. Nothing ran `desktop/tests/` before: `pr.yml` had no desktop job and `publish-desktop.yml` packages without testing. BUG-52/53/56 all reached a user's machine as a result. |
| TI-59 | Windows desktop CI job — packaging + a REAL whisper-server smoke test | 🔲 **Open** — raised 2026-08-07 ([BUG-56]). Un-gate `whisperServer.integration.spec.ts` on `windows-latest` with a cached `base.en` + a fixed WAV, resolving the binary through the production resolver (`whisperServerBinPath()`, added by [BUG-56] / #426) exactly as production does. This is the tier that proves the live engine actually transcribes. |
| TI-60 | Packaged-installer journey with injected audio | 🔲 **Open** — raised 2026-08-07 ([BUG-56]). Drive the *packaged* app end to end with a known WAV pushed through a test seam (not a virtual-audio driver) and assert live transcript text appears within a latency budget. The only tier that would catch a live-latency regression. |
| TI-61 | `Routing.test.tsx > Forward reopens the note` fails under CPU contention during a local full-suite run | 🔲 **Open** — raised 2026-08-06 (49-B verification). **Second observation of the same failure with the same cause**, previously seen on 34-C (`docs/token-log.md:166`) and never filed. Both times a `dotnet build` ran concurrently with `vitest run`; the test passes in isolation and on a clean full-suite run, so it is load-induced, not a regression. Mechanism: the assertion after `window.history.forward()` is `findByTestId('note-title-input')`, whose default 1000 ms timeout is short relative to this file's ~1.8 s under contention — the `waitFor` on `window.location.pathname` before it already succeeded, so it is the *render* that misses the window, not the navigation. It is **not** a deploy-gate flake (CI runs the frontend job alone), so it costs only local verification time — but it costs it every time, and re-deriving "not a regression" from scratch is the expensive part. Fix options: raise this file's async timeout explicitly, or await the route transition rather than racing the default. Low urgency; the cheap win is that this row exists so the next person does not re-investigate. |
| TI-63 | Move note analysis off the synchronous request path | 🔲 **Open** — raised 2026-08-07 (BUG-58). Analysis runs inside the **29s** Command Lambda: 90d of prod data shows command-hosted Converse calls at median 2.6s but 17.9 / 21.5 / 23.6 / 26.4s in the tail, with a further **3.0-5.9s** of sequential post-Bedrock appends (`TagNote` per tag, `AddActionItem` per action, each re-reading an 89KB stream). Four invocations hit exactly 29.0s in 14 days — killed. BUG-58's 23s client deadline converts those kills into a visible 503, but it cannot create budget that isn't there: **any analysis needing >23s+tail simply cannot complete synchronously**, and a kill part-way through the appends leaves a note with a new summary and tags but no action items, with no event marking it incomplete. Fix: run analysis asynchronously (job + poll, or a dedicated Lambda off a queue with a longer timeout, mirroring the TranscribeCompletion path that already has 60s), so duration stops being bounded by the API request. Medium urgency — the deadline makes the failure visible and retriable, so this is about the ~12-19% of analyses that are near or over budget, not about data loss. |

**Outstanding — TI-46 added 2026-06-22 (pre-tokenize search fields, premature until measured); TI-45 added 2026-06-18 (lazy-chunk error not alarmable); TI-42/43/44 added 2026-06-17:** TI-17 Auto-backfill projection on deploy (P24 dependency cleared; still no deploy step); TI-20 `WorkspaceList` GSI (re-home — P23 shipped without it); TI-23 Generalise append-retry (deliberately deferred; store-level conflict handling already in via BUG-28); TI-25 `NoteEditor` ordering test (file exists but covers 19-J/BUG-24, not the 25-B invariant); **TI-33 `NoteCardList` Scan→GSI** (re-home with TI-20); **TI-34 Lambda naming audit** (premise inverted — 27-D shipped, three live Lambdas); **TI-40 read-only creds for automated cloud observability-review**; **TI-42 residual cards-list E2E flake (workspace-context-on-reload)**; _(partly)_ TI-7 ESLint `import-x/no-unresolved`/`no-cycle` only (jsx-a11y + typed-lint now done via 19-F3/19-B); TI-3 state-mgmt colocation; TI-24 deploy-credentials root cause. **TI-41 (`GetActions` cross-stream presence wait) is done — #289, deploy #589, 2026-06-15. TI-39 (chronic E2E deploy-gate flakiness) is done — 2026-06-13, four stacked causes incl. [BUG-27]/[BUG-29]; residual [BUG-28] carved out. A **5th** cause (action-add existence check on the async `NoteDetail` projection) surfaced later under green-streak reruns and was fixed `fab63aa` (2026-06-16); the remaining `NoteReadYourWrites` cards-list flake is tracked as **TI-42**. The 2026-06 cold-start trio (TI-32 priming + TI-35 ReadyToRun + TI-36 512 MB) is done — #260/#270, deploys #552/#562 — cold p50 7.92→2.24 s (−72%). The 2026-06 observability triad (TI-37 RUM resource-error capture, TI-38 error-log-level, BUG-23 rebuild-timeout 503) is done — #267/#268/#269, deploys #556/#557/#558; the 2026-06 dependency upgrade audit (T1/T7/T2/T3/T4 = TI-27/28/29/30/31) is fully cleared.**

**2026-06-17 deploy-gate stabilisation session:** proved **10 consecutive green deploys** (#595 ×10). Root-caused and fixed a **44-min E2E suite hang** (PR #291's fire-and-forget response-body read on the reload loop) → replaced with a hang-proof, sync-only diagnostic (PR #292) and a **hard 120 s per-test cap** (**TI-43 done**, PR #293). **TI-42** cards-list flake did not recur in 13+ runs (not reproduced ≠ fixed; diagnostic now in place). **BUG-31** turned out to be three stacked causes — original image-reappear symptom fixed, `SaveAndReturnAsync` cards-refetch sync fixed (PR #297, suite-wide win), and a residual stuck-note-detail-read layer carved out as **TI-44**. Full write-up: [docs/learnings/e2e-gate-hang-and-the-diagnostic-that-caused-it.md](learnings/e2e-gate-hang-and-the-diagnostic-that-caused-it.md).

> Items carry stable IDs `TI-1`–`TI-31` in document order (the `ID` column above); each detailed section below repeats its ID. Reference an item as `TI-N`. The dep-audit `T#` tags are retained in parentheses for cross-reference with the audit report.

> **Dependency upgrade audit (2026-06-11):** full inventory + LTS recommendations in [docs/dependency-audits/dependency-upgrade-audit-2026-06.md](dependency-audits/dependency-upgrade-audit-2026-06.md). High + medium-urgency items (T1, T7, T2, T3, T4) are **all ✅ done** (TI-27/28/29/30/31). Low-urgency items (T5 lint-tooling batch, T6 Tiptap 3.26, T8 CDK 2.258, T9 Playwright 1.60, T10 xUnit v3) stay in the audit doc until picked up.

---

> **Done items are condensed in [technical-improvements-archive.md](technical-improvements-archive.md)** (one terse entry each, IDs/anchors preserved). The Summary table above stays the full index; only **open / partly-done** items keep a detailed section below.

---

## TI-3. Frontend state-management hygiene — colocation + Context performance

**Context-performance half ✅ Done** as **[Phase 19-D](phases/phase-19.md)** (2026-06-05): `AuthContext`/`ToastContext` provider values memoised, Auth actions `useCallback`-wrapped. **Colocation half — Open:** state colocation (keep state nearest its consumer; prefer component composition over Context for prop drilling) stays an ongoing convention, not a slice — candidate to fold into the `frontend-react` skill if it recurs in review.

**Raised in:** Frontend standards research 2026-06-04 (react.dev useContext / KCD colocation).
**Depends on:** —

---

## TI-7. ESLint `jsx-a11y` (blocked on ESLint 10) + `import` rules follow-up + `@/` alias

**Status of the three originals (Phase 14):**

- **`@/` path alias** — ✅ **Done** (Phase 14-Q): `resolve.alias` in `vite.config.ts` + tsconfig `paths`.
- **Import ordering** — ✅ **Done** (Phase 14-R), but via **`eslint-plugin-import-x`** (the maintained, flat-config-native fork), NOT `eslint-plugin-import` — the latter peer-caps at ESLint 9 and the project is on **ESLint 10**. Only `import-x/order` was enabled.
- **`eslint-plugin-jsx-a11y`** — ✅ **Done (Phase 19-F3, PR #236)**: the ESLint-10 peer-cap was the deferral reason, but it is only an _install-time_ constraint — the plugin runs fine on ESLint 10. Resolved with a **scoped `package.json` `overrides`** pinning jsx-a11y's eslint peer to the root eslint (`eslint-plugin-jsx-a11y` → `eslint: "$eslint"`), which keeps `npm ci` green **without** the repo-wide `--legacy-peer-deps` that the 14-S/T deferral was avoiding. Adopted `recommended` at `error`, backlog triaged. Remove the override once jsx-a11y ships a v10 peer range.

**Remaining work (this item):**

1. **`import-x/no-unresolved` + `import-x/no-cycle`** — the original AC also named "catch unresolved/circular imports", which 14-R did not enable (needs `eslint-import-resolver-typescript` wired for the `@/` alias; `no-cycle` can be noisy). Add these on a follow-up pass. **This is the only remaining work in this item.**
2. **Typed-lint family — ✅ Done (Phase 19-B).** `web/eslint.config.js` adopts `...tseslint.configs.recommendedTypeChecked` with `parserOptions.project` wired, enabling `no-floating-promises`/`no-misused-promises`, `no-non-null-assertion`, `no-explicit-any`/`no-unsafe-*`, `prefer-nullish-coalescing`/`prefer-optional-chain`. The async-promise and `!`/`any` gaps are now machine-enforced.
   **Why it matters:** a11y and import-hygiene enforcement turn "please remember" into "the build fails if you don't." `react-hooks` + `import-x/order` + typed-lint are now active; only `no-unresolved`/`no-cycle` remain.
   **Raised in:** Frontend standards review 2026-06-03; updated after Phase 14-Q/R/S/T (ESLint-10 plugin-ecosystem gap discovered).
   **Depends on:** nothing external — `jsx-a11y` shipped via 19-F3 (scoped `overrides`); the remaining import-resolver rules and typed-lint (19-B) are unblocked.

---

## TI-17. Auto-backfill a new projection on deploy (new projections ship empty)

**What:** A deploy creates a new projection's table but **never populates it** — there is no automatic rebuild — so a newly-shipped projection holds only entities written _after_ the deploy. The feature reads empty in prod while every test passes. The current mitigation is a manual post-deploy `POST /admin/projections/rebuild` (now a mandatory Scribe step + CLAUDE.md guardrail for projection-adding slices), but that is human-triggered and was missed once.

**Confirmed in prod, 2026-06-08:** Phase 22 search returned **no results** because `notetaker-proj-notesearchview` had 1 of ~12 live notes — the 22-A deploy created the table but nothing rebuilt it. A manual rebuild fixed it.

**Why it matters:** silent, repeats for _every_ future projection, and the symptom (feature returns nothing) looks like a code bug, not an ops gap.

**Fix options:** (1) detect new projection tables in the deploy job and POST the rebuild automatically (idempotent) after deploy; or (2) a deploy step that diffs the projection set and rebuilds only the new ones (needs the rebuild-robustness fix so a bulk rebuild can't partial-fail). Pairs with the rebuild-robustness item.
**Still open (reviewed 2026-06-16):** no rebuild/backfill step exists in any `.github/workflows` job; the manual post-deploy `POST /admin/projections/rebuild` remains the only path. P24 (the safe-rebuild dependency) and P23 have both shipped, so this is now unblocked and standalone — no longer "pairs with Phase 23".

**Raised in:** Phase 22 search backfill, 2026-06-08.
**Depends on:** ~~Phase 24~~ — **done**; now unblocked.

---

## TI-19. Stabilise the flaky `TagsJourney` E2E (post-deploy gate fails intermittently)

✅ **Done** — condensed history in [technical-improvements-archive.md#ti-19](technical-improvements-archive.md#ti-19-stabilise-the-flaky-tagsjourney-e2e-post-deploy-gate-fails-intermittently). _(Stub retained here so the inbound `phase-bugs.md` link still resolves.)_

---

## TI-20. `WorkspaceList` reads via full table Scan, not a per-user GSI

`DynamoDbWorkspaceListStore.GetAllAsync` does a paginated cross-user `Scan` (`ConsistentRead = true`) and is called on **every** `GET /workspaces`, every rename (`ApplyRenamedAsync` re-scans to point-update one row), and every ownership check (`OwnsAsync`). The closest precedent, `NoteSearchView`, uses a `UserId-index` GSI + `Query` for exactly this access pattern.

**Why it's fine for now:** workspaces-per-user is tiny (low single digits), so the scan reads a handful of rows. **Why it's worth fixing:** it is an architectural inconsistency that scales O(all users' workspaces), and `ApplyRenamedAsync` loads the whole table to update one known row.

**Fix:** add a `UserId` GSI to `notetaker-proj-workspacelist` and switch reads to a per-user `Query`; give the rename path a point `Get`/re-upsert instead of a scan.

**Still open (reviewed 2026-06-16):** `DynamoDbWorkspaceListStore` still does the cross-user `Scan`+`ConsistentRead`. **Phase 23 has shipped** without touching this store, so the original "fold into Phase 23-B" plan is moot — re-home as a standalone GSI slice, ideally batched with TI-33 (same change shape, same projection-table family).

**Raised in:** Hawk review of PR #207 (slice 23-A), 2026-06-10.
**Depends on:** —

---

## TI-23. Generalise append-retry-on-conflict beyond `NoteCommandHandler`

BUG-17 (PR #217) added a bounded retry-on-`ConcurrencyException` (re-read→re-run→re-append) to `NoteCommandHandler.ExecuteAsync` only. `ActionItemCommandHandler` shares the same optimistic-concurrency append but was left out: it interleaves projection writes with its append (not the clean read→handle→append cycle), and its streams are keyed per action item, so the BUG-17 multi-writer-on-one-stream race is far less likely there.

**Why worth doing:** the latent lost-write still exists for rapid concurrent writes to a single action-item stream (e.g. fast complete/reopen toggles). **Fix:** extract a shared `AppendWithRetry` helper (or a handler base method) so the retry is defined once and applied wherever the read→handle→append pattern lives, rather than duplicated. Do it only if a second handler needs it — don't abstract for one caller.

**Still open / deliberately deferred (reviewed 2026-06-16):** `ActionItemCommandHandler` confirms no retry by design (explicit code comment: concurrent writes to a single action stream are near-impossible in a single-user app, so a persistent conflict surfaces as a 409). Separately, **BUG-28 hardened the event store itself** — `DynamoDbEventStore.AppendAsync` now classifies a `TransactionConflict` as a retriable `ConcurrencyException` for *every* aggregate — so the missing piece here is purely the shared retry-*loop* extraction, still gated on a second caller actually needing it.

**Raised in:** Hawk review of PR #217 (BUG-17), 2026-06-10.
**Depends on:** —

---

## TI-24. `deploy-production` hangs at "Configure AWS credentials"

**Mitigated 2026-06-11** — added `timeout-minutes: 5` to the `Configure AWS credentials` step in **both** deploy jobs (`deploy-test` + `deploy-production`). A silent 30+ min hang now fails fast and is recovered by a rerun, so it no longer blocks a green main indefinitely. Root cause still **unconfirmed** (capture the step log next time it hangs); a version bump or step-level retry remains a possible follow-up.

The `deploy-production` job in `deploy.yml` intermittently (~half of deploys during Phase 25) **hung at the `Configure AWS credentials` step** for 30+ minutes with no progress and no error, before any Lambda/CDK deploy started. The step uses `aws-actions/configure-aws-credentials@v6` with **static access keys** (`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`) — so the hang is the action validating those keys via `sts:GetCallerIdentity`, stalling on a transient STS/network blip (not OIDC `AssumeRole`, and not a broken role/trust — other deploys with the same secrets succeed). The only recovery found before the timeout was `gh run cancel <id> && gh run rerun <id>`, which clears it on a fresh runner.

**Why it mattered:** each hang cost ~30 min of dead wall-clock and blocked the merge→deploy→merge loop for parallel slices; it bit 25-A/B/C deploys repeatedly. **Remaining follow-ups (optional):** pin/bump `aws-actions/configure-aws-credentials`; add a step-level retry so it self-heals without a manual rerun; or root-cause the STS-endpoint flakiness from a captured step log.

**Raised in:** Phase 25 pipeline (repeated deploy hangs), 2026-06-11. **Actioned (timeout):** same day.
**Depends on:** —

---

## TI-25. Add a `NoteEditor` component test for the image upload/serialize ordering invariant

Phase 25-B shipped (then fixed) an **ordering bug** that every unit test passed and only the deploy-time E2E (`NoteImageJourney`) caught: the image node was inserted with a `blob:` src _before_ its stable key was mapped, so a save during the upload window dropped the image. The fix (presign-first) re-encodes the load-bearing invariant — _seed the `src→key` map before inserting the node_ — as two adjacent statements in `NoteEditor.tsx` with **nothing pinning the order below the slow deploy E2E gate**. The pure `noteImages.test.ts` covers only the rewrite helpers.

**Why it matters:** a future refactor of `NoteEditor` could reorder seed-vs-insert and silently reintroduce the data-loss bug; CI wouldn't catch it until a ~15-min deploy E2E (which itself flakes/hangs). **Fix:** a `NoteEditor.test.tsx` (RTL + mocked `presignUpload`/`fetch`) asserting (a) `onChange` is never called with a `blob:`/unmapped src during a paste→presign→PUT sequence — the first `onChange` after insert already carries the key; and (b) on PUT failure the node is removed and `onChange` re-fires without the key. Tiptap-in-jsdom made this non-trivial, so it was deferred from the slice.

**Still open (reviewed 2026-06-16):** `web/src/__tests__/NoteEditor.test.tsx` now exists, but it covers the **link-scheme hardening** (19-J) and **BUG-24 resolve-before-parse** invariants — *not* this item's paste→presign→PUT upload-ordering invariant. The file is the natural home; add the two cases (a) and (b) above. Note BUG-31 (removed image still shows after reopen) is a live, related concern that a stronger `NoteEditor` test layer may help surface.

**Raised in:** Hawk review of PR #220 (25-B presign-first fix), 2026-06-11.
**Depends on:** —

---

## TI-33. `NoteCardList` reads via full-table `Scan` with `ConsistentRead`, not a per-user/workspace GSI + `Query`

`DynamoDbNoteCardListStore.QueryAllAsync` (`src/EventStore/Projections/DynamoDbNoteCardListStore.cs:57`) does a **paginated full-table `Scan` with `ConsistentRead = true`**, then sorts client-side by `CreatedAt`. It backs the notes-list GET. Same anti-pattern as **TI-20** (`WorkspaceList`), on the larger and faster-growing table.

**Evidence (prod X-Ray, 2026-06-12):** `Scan` on `notetaker-proj-notecardlist`, `scanned_count` 234, `content_length` 73,988, `ConsistentRead = true` → **840 ms** — and the count, latency, and read cost all grow O(all notes across all users).

**Two issues, both growing:**
1. **`Scan`, not `Query`** — reads the entire projection every request rather than a partition-keyed slice. The precedent fix (`NoteSearchView`) uses a `UserId-index` GSI + `Query`.
2. **`ConsistentRead = true` on a `Scan`** — doubles read cost + latency vs eventually-consistent and forbids serving the read off a GSI. The single-item path (`GetByNoteAsync`, line 50) also uses `ConsistentRead = true`. Check whether the *list* read genuinely needs strong consistency: post-27 the API reads projections the async Projector Lambda builds, and read-your-writes is handled by the `ConsistencyGate` polling the proj-position table — if the gate already guarantees freshness, the strong-consistent Scan is redundant cost. The single-entity RYW need (RYW-1) does not imply the whole-list read needs it.

**Fix:** add a `UserId` (or `WorkspaceId`) GSI to `notetaker-proj-notecardlist`; switch the list read to a per-user/workspace `Query`; drop `ConsistentRead` on the list path unless the gate analysis shows it is load-bearing.

**Still open (reviewed 2026-06-16):** `DynamoDbNoteCardListStore.QueryAllAsync` still does the full-table `Scan`+`ConsistentRead`. **Phase 23 has shipped** without it, so the "fold into Phase 23" plan is moot — re-home as a standalone GSI slice batched with TI-20 (same change shape, same table family) — doing both together amortises the GSI-backfill + rebuild. The `ConsistencyGate`-makes-strong-read-redundant analysis is still worth doing as part of that slice.

**Raised in:** Prod latency investigation, 2026-06-12 (X-Ray trace analysis).
**Depends on:** — (pairs with TI-20).

---

## TI-34 — Make Lambda naming specific & correct everywhere

**What:** Audit every reference to "Lambda" / "the function" across CDK ids, `CLAUDE.md`, ADRs, phase docs, and code comments, and make each one specific to the function it means. There are now **two** Lambdas, so generic "the Lambda" is ambiguous.

**Correct names — current state (27-D shipped):** the deployment now has **three** functions: **Command Lambda** (`CommandFunction` — writes + side-service GETs + admin rebuild), **Query Lambda** (`QueryFunction` — reads), and **Projector Lambda** (`ProjectorFunction` — async stream consumer). The CDK construct ids are already correct.

**Premise updated (reviewed 2026-06-16):** the original wording said "do NOT rename to Command Lambda — the split hasn't happened (27-C reverted; only Todo async)." **That is now obsolete — 27-D shipped** (prod confirmed: `CommandFunction` + `QueryFunction` + `ProjectorFunction`). So the audit's job has *inverted*: the lingering generic "API Lambda" / "the Lambda" / "single Lambda" references now describe a state that no longer exists and should be reconciled to the three real names (or kept as deliberate historical wording inside era-stamped ADR/learnings/phase docs).

**Scope:** ~20 docs + `CLAUDE.md` still carry "API Lambda"/"the Lambda"/"single Lambda" (grep 2026-06-16). Audit each, distinguishing (a) present-tense references that should become Command/Query/Projector, from (b) historical references inside dated docs (phase-1/7.5/9/12/18, ADR 0009, learnings) that correctly describe the single-Lambda era and should stay.

**Why:** ambiguity with three live functions; pre-split names used for the present state now actively mislead.
**Raised in:** user request, 2026-06-12. **Premise corrected:** 2026-06-16 (27-D shipped).
**Depends on:** — (27-D done).

---

## TI-40. Scoped read-only AWS creds so a cloud routine can run `observability-review` automatically

**Goal:** a hands-off **weekly** `observability-review` (sweep deployed signals → triage → file bugs/TI) running as a scheduled **cloud** agent, with no human in the loop and no standing security risk.

**Why it's blocked today.** The `observability-review` skill ships (2026-06-13), but a scheduled routine runs as a **cloud** CCR session in Anthropic's infra — it has **no access to the local machine**, where prod AWS auth lives (`--profile prod`, acct 642653037268). So a cloud run can't query CloudWatch Logs / Metrics / RUM / X-Ray at all; it can only degrade to a "run it locally" reminder. The skill already handles that degraded path, but the real value (automated sweep) needs cloud-reachable creds. The chosen cadence is **weekly** (see the cadence decision, 2026-06-13).

**Scope of work:**
1. **Read-only IAM role (CDK, prod account).** A dedicated role granting *only* telemetry-read, region-scoped to eu-west-2 where the API supports it:
   - `logs:` StartQuery, GetQueryResults, StopQuery, FilterLogEvents, GetLogEvents, DescribeLogGroups, DescribeLogStreams
   - `cloudwatch:` GetMetricData, GetMetricStatistics, ListMetrics, DescribeAlarms, GetDashboard, ListDashboards
   - `rum:` GetAppMonitor, GetAppMonitorData, ListAppMonitors, BatchGetRumMetricDefinitions
   - `xray:` GetServiceGraph, GetTraceSummaries, BatchGetTraces, GetTraceGraph
   - **Explicitly NO** DynamoDB / event-store / S3 / SSM access. The review reads telemetry, never user data — consistent with the skill's "IDs/types/counts only, never note content" rule. Add it as a standalone role (this is an external-principal role, not a Lambda `GrantX`).
2. **Federate, don't store static keys.** Prefer the cloud runner assuming the role via **OIDC** (short-lived creds, role trust policy scoped to the runner's OIDC subject). Only if OIDC is unavailable, fall back to a long-lived access key for a read-only IAM user held as a routine secret — least preferred; document the rotation owner if so.
3. **Connect GitHub for the cloud env** (`/web-setup` or the Claude GitHub App) so the routine can read the repo and **open a PR** with filed findings. Prefer a PR over a direct `main` commit for an unattended agent, so a human reviews what it files before merge.
4. **Wire the weekly routine** (the `schedule` skill): cron weekly (Mon 09:00 Europe/London = `0 8 * * 1` UTC, or 09:00 UTC in winter — confirm at creation), prompt = run `observability-review` over the last 7 days and open a PR with any new verified findings + a one-line summary.

**Security/cost:** read-only, telemetry-only, region-scoped, no data-plane access; short-lived OIDC creds preferred. Weekly cadence → negligible cost. The one real risk is credential sprawl — mitigated by least-privilege + federation + no static keys.

**Acceptance:** a scheduled cloud run, with no local machine involved, queries prod CloudWatch/RUM, files any new verified finding as a PR to `phase-bugs.md`/`technical-improvements.md`, and posts the one-line summary — and the role can do nothing beyond reading telemetry (verify with an explicit deny-by-omission check: a `dynamodb:`/`s3:` call from the role is denied).

**Raised in:** Cadence decision for the new `observability-review` skill, 2026-06-13 — option C (the only path to a *real* automated cloud sweep; options A/B were local-run / reminder-only). 
**Depends on:** the `observability-review` skill (done); GitHub connected for the cloud env.

---

## TI-42. Residual cold-start E2E flake — `NoteReadYourWritesJourney.Renamed_note_appears_in_the_cards_list` (~1/10)

🔲 **Open** — raised 2026-06-16.

**Context.** Hunting the chronic deploy-gate flake (the continuation of TI-39), the **dominant** cause was `ActionReadYourWritesJourney`: `ActionItemCommandHandler.HandleAsync(AddActionItem)` checked note existence against the **async `NoteDetail` projection**, which lags right after `POST /notes`, so an action added immediately after create raced it → `NoteNotFoundException` → 404 → the action was never written → the journey timed out at 32 s. Fixed in `fab63aa` (existence guard now reads the note **event stream**, ConsistentRead — same source as `NoteAuthorizer`). **Proven over 9 consecutive cold-projector reruns** (deploy #590 attempts 1–9; pre-fix the streak died at attempt 3).

**The residual.** Attempt **10/10** failed on a *different* journey — `NoteReadYourWritesJourney` (create → rename → reload → assert the renamed card in the cards list), ~1/10. **Pre-existing**, not introduced by the fix.

**Server side proven healthy** (test-env CloudWatch, account 739754704263, the deploy gate's env — **not** `--profile prod`):

| Signal | Finding |
|---|---|
| Rename write | Succeeded (no `NoteNotFoundException` for the real notes; the 404 cluster was the expected `ErrorResponsesSpec` negative tests) |
| `ConsistencyGate` | **Zero STALE** in the window — every gated read released `Fresh` |
| Projector | Folded `NoteRenamed` with 123–325 ms lag, no errors |
| Write ordering | `StreamProjector` writes the projection **before** advancing `proj-position` (no position-before-projection race) |

**Leading hypothesis — workspace context on reload.** The only gate-independent server filter is `GetNoteCards`’s `currentWorkspace.Includes(c.WorkspaceId)`. If the frontend’s workspace context after reload isn’t `__default__`, the server filters the card out — gate still `Fresh`, projector healthy, card "missing." Consistent with the in-flight workspace branches (`fix/workspace-switcher-overflow`, `slice/ti-39-warmup-workspace-fix`, `slice/27-ryw3b-folder-workspace`); likely overlaps that work.

**Next step (needs live evidence — the per-run data clear destroys retro evidence).** Instrument `GetNoteCards` to log the **requested workspace id + matched/total card counts**, re-run the green streak, and catch a failure live. If it confirms a workspace mismatch, fix the reload-time workspace context (coordinate with the workspace agents). Then resume the streak to **10+ consecutive green**.

**Update 2026-06-17 — did not recur in 13+ consecutive green runs; safe diagnostic now in place.**

- Across two green-streak runs (deploy #595 ×10 + #596/#599 confirmation reruns) the cards-list flake **did not reproduce once**. It is not proven *fixed* (no failing run to confirm the workspace hypothesis), only **not reproduced** — the TI-39 projector warm-up/drain may have effectively settled it.
- A **client-side** evidence channel is now committed (PR #292, `AppPage.cardsRequestLog`): a Playwright response listener records the **synchronous `.Url`** of every `/notes/cards` read (never the body — see the hang lesson below), and `AssertNoteVisibleInListAfterReloadAsync` throws a descriptive message on the deadline carrying `page.Url` + rendered card titles + the recorded `/w/{wsId}/notes/cards` request URLs. So the *next* failure surfaces the requested workspace prefix directly in the gh run log (the E2E account has no readable CloudWatch). This replaces the original "instrument `GetNoteCards` server-side" step, which is unreadable from that account.
- **Cost lesson (PR #291 → #292):** the first cut of this diagnostic read the response **body** (`response.TextAsync()`) in a fire-and-forget handler. On the reload loop, `ReloadAsync()` aborts in-flight requests and `TextAsync()` on an aborted response **hangs forever** → it hung the whole E2E suite **44 min** (deploy #592) before manual cancel. Record **only synchronous request properties** (`.Url`, `.Status`, `.Request.PostData`) in any E2E response listener — never the body. Also: xUnit **swallows `Console.WriteLine` on passing tests** and never flushes a hung test, so route diagnostics through the **thrown exception message** (which `--log-failed` shows), not `Console`. See the learnings write-up.

**Update 2026-07-01 — recurred on deploy #686 (Phase 46-A), both cold attempts, with an empty cards list.** Attempt 1 failed `FilterBackNavigationJourney.Filter_OpenNote_Back_RestoresFilter`, attempt 2 failed `NoteDeleteJourney.Deleted_note_is_not_in_list_after_navigating_back_manually` — **different journeys, identical symptom**: `cards(0)=[]` (the *entire* list empty) with 5×`200 /notes/cards`, all correctly `/w/__default__/`.

**RESOLVED 2026-07-01 (PR #390, deploy #694 green attempt 1) — the workspace-context hypothesis was WRONG.** The failed reads all targeted `/w/__default__/` correctly; the list was empty because the read was **ungated and racing the projector**, not scoped to the wrong workspace. Mechanism (confirmed from code + the #686 logs):
- The E2E helper `AssertNoteVisibleInListAfterReloadAsync` reloads then asserts the card. Its own comment claimed the post-reload `GET /notes/cards` "carries the sessionStorage-persisted token" and re-gates — **but it usually doesn't**: `gatedRead` clears the RYW token on the first fresh read, and the pre-reload home fetch consumes it, so after the reload `getLatestToken(noteCards)` is null → the cards read goes out with no `If-Consistent-With` → the server gate no-ops → `200`/empty returned immediately. The helper then just polls that ungated read for 30s, hoping the projector catches up. `cards(0)=[]` = the one just-created note not yet folded (empty because the pre-E2E clear wiped everything else).
- Compounding: the per-attempt `ToBeVisibleAsync(Timeout=2500)` was **below** the 8s server gate cap (BUG-31), so on the occasions the token *did* survive, the next reload aborted the gated read before it could converge — self-defeating.
- **Not** cold-start: the deploy gate's warm-up already warms the projector at suite start ("caught up after 1 poll" in both #686 attempts) and the suite writes continuously, so the projector is warm throughout. Keep-warm (TI-52) is a separate *prod* cold-read concern and was correctly NOT used here.

**Fix (test-only, no prod/infra change):** capture the note-write `X-Consistency-Token` from the response header; re-inject it as `If-Consistent-With` on every post-reload cards read via a Playwright route so the read **waits** for the projector; raise the per-attempt timeout to 9s (above the 8s cap); enrich the failure diagnostic with per-read `X-Consistency` + the injected token so any residual is provable, not guessed. **Confirm over the next several deploys** (flake was ~2/15; #694 green attempt-1 is one data point, not proof).
**Follow-up (Hawk):** the sibling ungated-reload cards helpers `WaitVisibleWithReloadAsync` (backs `ClickNoteInListAsync`) and `AssertCardTagVisibleAfterReloadAsync` carry the identical latent race (2.5s cap, no re-gate) — generalise the re-gate if they surface.
**Deploy-time delta:** none.
**Raised in:** TI-39 green-streak proof, 2026-06-16. **Resolved:** PR #390, 2026-07-01.

---

## TI-44. Close BUG-31 layer 3 — note-detail read stays `loadingDetail` ~30 s after reopen+edit

🔲 **Open** — raised 2026-06-17. Spun out of the BUG-31 investigation (see [phase-bugs.md BUG-31](phases/phase-bugs.md)).

**What:** with BUG-31's first two flake layers fixed (original image-reappear symptom via RYW systemic changes; `SaveAndReturnAsync` cards-refetch sync via PR #297), a **third** layer remains (~1/4): the post-removal `ClickAsync("save-button")` times out 30 s because the button is `disabled={loadingDetail}` (`NoteView.tsx:401`) and `useNoteDetail`'s `isLoading` stays true ~30 s after reopen+edit. A **stuck/slow gated note-detail read** (RYW/async-projection class) — 30 s is anomalous (the `ConsistencyGate` should bound a gated read to seconds, then serve `stale`).

**Why it matters:** it keeps the BUG-31 journey quarantined, so "all E2E tests run" is not literally true; and if `loadingDetail` can genuinely hang 30 s in prod, the save button is disabled for the user that whole time — a real UX cliff, not only a test issue.

**Next step:** instrument the note-detail read with the evidence-through-the-thrown-message pattern (no response-body reads — see the TI-42 hang lesson) to capture *why* `isLoading` stays true: a cold/stuck gated `GET /notes/{id}`, a retry storm, or a strict-mode 2nd `save-button` match. Then fix and fully un-quarantine BUG-31.

**Deploy-time delta:** none yet (investigation).
**Raised in:** BUG-31 layer-3 evidence (deploy #599), 2026-06-17.
**Depends on:** —

---

## TI-54. MCP tool failures log as `Error` with no exception detail

Every MCP tool failure — expected or genuine — reaches CloudWatch as the same opaque line, so the error view is simultaneously noisy and blind.

**What the log actually says**, and all it says:

```
level:   Error
name:    ModelContextProtocol.Server.McpServer
message: "get_note" threw an unhandled exception.
```

No `exception_type`. No `stack_trace`. No indication of which of the two very different situations produced it.

**Verified live, 2026-08-06 12:45:22** — calling `get_note` against prod with a nonexistent GUID (`00000000-0000-4000-8000-00000000dead`) produced exactly that line. `NoteMcpTools.GetNote` throws `McpException("Note not found.")` **by design** for a missing or non-owned note; the SDK logs the deliberate throw at Error. The two prod Errors in the 14-day sweep window (2026-08-05 12:03 and 2026-08-06 08:05, `user_agent: Claude-User`) are the same benign shape — they are not faults.

**Two problems, one cause:**

1. **Over-reporting.** An expected "note not found" from an MCP client appears in the `notetaker-ops` "All errors" widget as a backend Error, alongside real faults. Same class as [TI-38] (the framework double-logging expected conflicts at Error), on a different framework.
2. **Under-reporting — the more important half.** A *genuine* unhandled exception inside any MCP tool (a null deref, a store failure, a serialization bug) logs the **identical** line with no type and no stack. It is indistinguishable from the benign case and carries nothing to diagnose it with. The MCP surface is large — 35-F reads plus 41-A writes — and is currently a monitoring blind spot.

**Fix direction** (either, not both):

- Add an MCP tool-invocation filter that logs outcomes truthfully: a deliberate `McpException` at **Warning** (expected business outcome, per the project's Warning-vs-Error convention), any other exception at **Error** with `exception_type` and `stack_trace` populated.
- Or suppress the `ModelContextProtocol.Server.McpServer` category from the Error level in `LoggingConfig` and emit our own line around the tool call.

The first is preferable — it fixes the blind spot rather than hiding the noise.

**Deploy-time delta:** none — logging configuration and a filter; no IAM, no infra, no traffic-shifting.
**Raised in:** observability-review, 2026-08-06.
## TI-55. MCP `/mcp` connector — per-`sub` rate limiting + bound the per-call projection scans

From the 35-F dual security review (both APPROVE; these were the two non-blocking LOW findings):

1. **Per-`sub` rate limiting.** `POST /mcp` is gated by OAuth + an optional IP allowlist (`MCP_ALLOWED_CIDRS`, currently empty = allow-all in prod). An allowlisted token can issue unbounded `tools/call`s. Add a lightweight ASP.NET `RateLimiter` keyed on the `sub` claim on the `/mcp` route, **and** populate `MCP_ALLOWED_CIDRS` with Anthropic's egress ranges in prod (the `McpAllowlistMiddleware` already supports it — it's a no-op until ops fills it in).
2. **Bound the per-call scans.** `NoteMcpTools.list_notes`/`get_action_items` call `QueryAllAsync` (full-table `Scan` + in-process `UserId`/workspace filter) on every call — O(all users) per request, the practical abuse path combined with (1). `search_notes` already uses the per-user GSI (`QueryByUserIdAsync`). **Folds into [TI-33](#ti-33-notecardlist-reads-via-full-table-scan-with-consistentread-not-a-per-userworkspace-gsi--query) / TI-20** (same `Scan`→`Query` change on the same tables) — adding a `QueryByUserIdAsync` there fixes the MCP tools too. The filter is correct (confidentiality is not at risk); this is cost/latency.

**Deploy-time delta:** none material (a rate-limiter middleware + a GSI-backed query; the GSI backfill is the TI-33/20 cost).
**Raised in:** 35-F security audit (PR #345), 2026-06-25.
**Depends on:** TI-33 / TI-20 for item 2.

## TI-56. Alarm on `RefreshTokenStoreWriteFault` (sustained > 0)

The `obs-auth-login` slice (PR #411) shipped the `RefreshTokenStoreWriteFault` metric (a durable-token store write failed on `/auth/token` or `/auth/refresh` rotation → the user silently loses long-lived sign-in). The Phase 30 obs table specced an **alarm on sustained > 0**; the metric ships, the alarm was consciously deferred to here to avoid churning the DefaultPolicy/alarm-count infra assertions in the observability slice.

- Add a CloudWatch `Alarm` on `NoteTaker/Domain` `RefreshTokenStoreWriteFault` (Sum, dimensionless), threshold > 0 over ~2×5min, wired to the existing `notetaker-alarms` SNS topic.
- Guard the alarm-count infra assertion (`InfraAssertionsTests`) — adding an alarm changes the expected count; update it in the same slice.
- Consider a companion low-severity view: a rising `SessionRefresh{Outcome=no_cookie|rejected}` rate is the "forced to re-authenticate" signal (already graphed on the `notetaker-ops` "Sign-ins & forced re-auth" widget); an alarm here is optional (it is user-experience, not a fault).

**Deploy-time delta:** none material (one alarm construct; no IAM, no traffic-shifting).
**Raised in:** `obs-auth-login` (PR #411), 2026-07-29 — deferred from the Phase 30 obs table.

## TI-58. Desktop specs run in the PR gate

_Duplicate of [TI-53](#summary), which was filed for the same gap on 2026-08-06 and missed when this was raised. TI-53 is the original; this section is the delivery record._

Before it, **nothing anywhere ran `desktop/tests/`**. `pr.yml` had `backend`/`frontend`/`eventstore` jobs and zero references to `desktop/`; `publish-desktop.yml` builds the installer on `windows-latest` but runs no tests. The entire Electron shell — IPC wiring, the local-transcription engine, packaging config — was proven only by whatever a human ran locally. [BUG-52], [BUG-53] and [BUG-56] all reached a user's machine through that gap.

- New `desktop` job on `ubuntu-latest`: `npm ci` (web + desktop) → `npm --prefix desktop run build` → `xvfb-run npm run test:e2e`.
- Ubuntu, not Windows: every spec is pure logic, config assertions, or Electron-under-xvfb. `web/` is a real dependency — `run build` stages the frontend into `desktop/web-dist`, which `server.spec.ts`/`shell.e2e.ts` serve and assert against.
- The real-binary specs self-skip when their env vars are unset, so this job stays fast; proving the actual binaries is [TI-59].
- **This closes the pure/headless gap only.** `whisperBinPath()` branches on `process.platform`, and an ubuntu runner always takes the Linux arm — so the Windows-specific half of the BUG-56 risk class is still uncovered until [TI-59]. Verified green on the first run: 77 passed, 5 skipped (the env-gated real-binary specs), 1m00s, fully parallel with `backend`.

**Deploy-time delta:** none — PR-side only, runs parallel to the existing jobs. No change to `deploy.yml`.
**Raised in:** [BUG-56], 2026-08-07.

## TI-59. Windows desktop CI job — packaging + a real whisper-server smoke test

The lesson of [BUG-56] is **not** "we needed more runners". `whisperServer.integration.spec.ts` already exercised the real `whisper-server` binary and passed — because it took the binary from a hand-supplied `WHISPER_SERVER_BIN` while production resolved `whisperBinPath()`. The test and the app disagreed about which binary production uses, and nothing asserted the production wiring. So the load-bearing requirement here is:

> **The smoke test must resolve the binary through the production resolver — the same code path production uses — not through a hand-supplied env var.** A test that reaches its dependency by a private route proves only that the dependency works, never that the app reaches it.

- `windows-latest` job (PR-side or nightly): `npm run fetch:whisper`, cache the pinned `base.en` (~140 MB) by manifest sha, feed a committed fixed WAV, assert real transcript text comes back.
- Assert the staged `resources/whisper/` contains both required binaries and that the packaged (asar) layout resolves them — the packaged path, not the dev path, is where [BUG-56] hid.
- Windows runners bill at higher minutes than ubuntu and are slower to start; if PR-side proves too slow, run nightly on `main` and on any PR touching `desktop/`.

**Deploy-time delta:** none if PR-side or nightly. Do **not** put it in the deploy gate — it would tax every deploy for a desktop-only signal.
**Raised in:** [BUG-56], 2026-08-07.
**Depends on:** TI-58.

## TI-60. Packaged-installer journey with injected audio

The tier that catches what [TI-59] cannot: latency and the whole capture→engine→transcript→note path, against the artefact the user actually installs.

- Drive the **packaged** app (not `npm run dev`) via Playwright's `_electron` API, push a known WAV through the pipeline, and assert live transcript text appears within a latency budget (BUG-53's target was ~3–4 s perceived).
- **Inject PCM through a test seam rather than installing a virtual-audio-cable driver.** The driver route needs an admin install on the runner and is brittle; a seam that feeds the same buffer the capture worklet would produce bypasses the driver entirely while still exercising the engine, the reducer, the IPC and the renderer.
- A latency assertion here is what turns "the live path works" into "the live path is still fast", which is the property BUG-53 shipped and BUG-56 showed we could not detect losing.

**Deploy-time delta:** none — nightly or on-demand, never in the deploy gate.
**Raised in:** [BUG-56], 2026-08-07.
**Depends on:** TI-59.
