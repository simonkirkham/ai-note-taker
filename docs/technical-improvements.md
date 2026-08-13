# Technical Improvements

Technical, infrastructure, and developer-experience items to address in the future. These are **not user-facing features** — they're refactors, upgrades, CI/CD work, and hardening that keep the system healthy. Review this list when planning a phase or when an item becomes urgent.

For the other tracks see:

- **Features** → [docs/future-features.md](future-features.md)
- **Bugs** → [docs/phases/phase-bugs.md](phases/phase-bugs.md)
- **Minor tweaks & changes** → [docs/phases/phase-minor-changes.md](phases/phase-minor-changes.md)

Each entry records what it is, why it matters, where it was raised, and any dependency. **The Summary table below is the at-a-glance index — scan its Status column for what's outstanding, and keep that cell in sync when an item is actioned** (the detailed section for each item carries the full status + history).

## Summary

Status key: 🔲 **Open** · 🟡 **Partly done / mitigated** · ✅ **Done** (graduated to a phase, or actioned in place). Outstanding work is every 🔲 and 🟡 row.

**Every row re-verified against the codebase on 2026-08-09.** One item changed state — **TI-44 → ✅ Done** (its hypothesis was disproven; the symptom closed via BUG-31/BUG-48). Every other 🔲/🟡 row was confirmed still outstanding at the named code site; only stale line numbers, file paths, and counts were corrected. Rows below carry the evidence.

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
| TI-34 | Make Lambda naming specific & correct everywhere                                | 🔲 **Open — premise updated** — 27-D **shipped**, so the live functions ARE **Command + Query + Projector** Lambda (CDK ids correct). **15 files** still say "API Lambda"/"single Lambda" (re-grepped 2026-08-09), of which **7 are living docs** that actively mislead: `CLAUDE.md` (Stack: "behind a single Lambda"), `architecture.md`, `observability.md`, `roadmap.md`, `adr/README.md`, `adr/0009`, `guides/debugging-with-x-ray.md`. The other 8 are era-stamped (phase-12/18/25/27, learnings, workflow-log, this doc + its archive) and should stay |
| TI-35 | ReadyToRun-publish the API Lambda (AOT-precompile to cut first-request JIT)     | ✅ **Done** — #260, deploy #552. R2R live (IL_ONLY cleared on Api/AWSSDK/JwtBearer); part of the −39% cold-start cut. Pairs with TI-32 |
| TI-36 | Raise API Lambda memory 256→512 MB to cut residual cold-start CPU time          | ✅ **Done** — #270, deploy #562. 512 MB live (prod config confirmed); cold p50 4.82→2.24 s, warm 118→29 ms. End-to-end 7.92→2.24 s (−72%) |
| TI-37 | Capture **all** frontend errors in RUM — failed resource loads (`<img>` 403s) are invisible | ✅ **Done** — #268, deploy #557 (2026-06-13). Capture-phase `window` error listener forwards `<img>`/`<script>`/`<link>` load failures to RUM via `cwr('recordError')` (rides `JsErrorCount`); real JS errors skipped to avoid double-count. Dashboard widget retitled |
| TI-38 | Expected 409/404 outcomes log at `Error` on the ops dashboard — framework double-logs | ✅ **Done** — #267, deploy #556 (2026-06-13). Replaced `UseExceptionHandler` with a try/catch middleware that maps every exception itself, removing ASP.NET's `ExceptionHandlerMiddleware` from the pipeline — each request now logs exactly one line at the `Map()`-implied level (Warning for 409/404, Error once for 500s) |
| TI-39 | Chronic cold-start E2E flakiness red-gates nearly every deploy | ✅ **Done** — 2026-06-13. Was **four stacked causes**, not one (BUG-26 umbrella): projector cold-lag → fixed by a warm-up that **drains the projector to head** before the suite + 15 s global Expect timeout + reload-tolerant asserts **and actions**; plus two real bugs found en route ([BUG-27] lost-write contention, [BUG-29] projector image-purge IAM). Residual concurrent-multi-tag race carved out as [BUG-28] (quarantined). Write-up: [docs/learnings/deploy-gate-deflake-stacked-causes.md](learnings/deploy-gate-deflake-stacked-causes.md) |
| TI-40 | Scoped read-only AWS creds so a cloud routine can run `observability-review` automatically | 🔲 **Open** — raised 2026-06-13. The `observability-review` skill exists but a scheduled **cloud** agent can't reach prod (`--profile prod` is local-only), so a weekly automated sweep is impossible today. Add a least-privilege read-only CloudWatch-Logs/Metrics + RUM + X-Ray role (OIDC-federated, no static keys) the cloud runner can assume, connect GitHub, and wire the weekly routine |
| TI-41 | Fold the `GetActions` cross-stream re-poll into `ConsistencyGate` (existence wait)            | ✅ **Done** — #289, deploy #589 (2026-06-15) via **Option B**. `GetActions` had a hand-rolled `Task.Delay(100)×10` loop *beside* the gate to ride out note-vs-action cross-stream projector lag. Added `IConsistencyGate.WaitForPresenceAsync<T>` (bounded presence-poll, shares the version wait's interval/cap/delay/logging) and replaced the loop with it — the only `Task.Delay` flagged as a smell in the 2026-06-14 audit is gone |
| TI-42 | Residual E2E flake — post-reload cards list reads empty (`FilterBackNavigation`/`NoteDelete`/`NoteReadYourWrites`) | ✅ **Done — confirmed 2026-08-09** (fix PR #390, deploy #694). The projector-lag mechanism this item describes is closed, and the **two** post-fix hits prove it rather than contradict it: #703 (`NoteDelete`) and #714 (`FilterBackNavigation`) both show every cards read **gated and fresh** — so the gate worked — with `page.Url` on the **note-detail route**, i.e. an *absent* list, not a lagging one. That residual was a **different, navigation** defect, closed by [BUG-38] #418 (`SaveAndReturnAsync` now awaits the URL leaving `/notes/`) + [BUG-61] #425. Deploy **#720 is #418's own sha**, and both hits predate it. **21 consecutive clean deploys #720–#740**, per-attempt (`flake-watch.sh 695`), 38/40 across the whole window |
| TI-43 | Hard 120 s per-test E2E timeout so no test can hang the deploy gate                          | ✅ **Done** — PR #293, deploy #595 (2026-06-17). `E2EFactAttribute : FactAttribute(Timeout=120_000)` across all journeys. Closes the 44-min-hang class (PR #291). Verified it fires (xUnit `Timeout` is silently ignored when parallelization is disabled — confirmed via a throwaway probe) |
| TI-44 | Close BUG-31 layer 3 — note-detail read hangs `loadingDetail` ~30 s after reopen+edit         | ✅ **Done — hypothesis disproven, symptom closed** (re-verified 2026-08-09). Layer 3 was **not** a stuck gated read: the note held only the image, so removing it left content blank → the header renders `cancel-button` instead of `save-button` **by design**, and the click never resolved. Fixed in [BUG-31] (PR #397, deploy #701) by giving the note durable body text; journey **un-quarantined** (no `Skip` in `tests/Browser.E2E/`) and **6/6 clean** (#701–#706). The residual stale-refetch-blanks-a-note was carved out as [BUG-48] and is **Done** (#436). No 30 s `loadingDetail` UX cliff exists |
| TI-45 | `lazyChunkError` RUM event isn't alarmable — uses `recordEvent`, not `recordError`                | 🔲 **Open** — raised 2026-06-18 (Hawk nit, PR #300). 19-I1's `LazyNoteEditor` reports a failed editor-chunk import via `recordRumEvent('lazyChunkError', …)` → `cwr('recordEvent')`, which lands in the RUM log group (consistent with the `deadNoteLink` precedent) but does **not** increment `JsErrorCount` or fire the error-rate alarm. Deliberate at ship (meets the 19-I1 spec). Decide whether a failed editor load should be *alarming* — if so, route it through `recordError` like `rum.ts:reportResourceError`. Low urgency (lazy-chunk failures are rare and self-heal via the chunk-reload guard) |
| TI-46 | Pre-tokenize search fields into the `NoteSearchView` projection (search is O(notes × tokens × terms) per query) | 🔲 **Open** — raised 2026-06-22 (Hawk perf note, PR #312/BUG-35). The word-level ranker re-tokenizes every field (`Title`/`Body`/`FinalNotesText`/`ActionItemsText`/each tag) of **every** note on **every** query — a `GeneratedRegex.Split` + LINQ per field plus an O(token²) `Fuzz.Ratio` per token for terms ≥ 4 chars. Fine at current single-user scale and the 50-result cap; **do not act until measured** (per the measure-first guardrail). When the corpus grows, fold the token list into the `NoteSearchView` projection at fold-time (one event-version bump + rebuild) so the per-query regex cost disappears and ranking reads precomputed tokens. Low urgency — premature at present volume |
| TI-47 | Calendar auth: replace the out-of-band SSM minting tool with proper in-app OAuth + a per-user server-side refresh-token store | ✅ **Graduated → [Phase 34](phases/phase-34.md)** (2026-06-23) — absorbed as Phase 34's in-app-OAuth foundation (34-A: token store + connect flow; 34-D: retire the SSM path). _Original note:_ Both Google (Phase 9) and Microsoft (32-A) mint a refresh token via a one-shot CLI into a single SSM parameter — fine for this single-user app, wrong for multi-user. The real pattern: in-app "Connect calendar" → OAuth auth-code + PKCE → backend exchanges the code → refresh token persisted **per user keyed by `sub`** (graduates onto the existing `DynamoDbRefreshTokenStore`/auth-tokens table) → self-service "reconnect" banner on `invalid_grant`. Aligns with Phase 30's Google server-side-token-store direction. Low urgency while single-user; prerequisite for ever sharing the app |
| TI-48 | Multipart/chunked upload for long call recordings (33-A buffers the whole WAV in memory) | 🔲 **Open** — raised 2026-06-23 (Phase 33-A). The recording upload buffers every PCM chunk in memory for the whole meeting and PUTs one WAV on Stop (~1.9 MB/min at 16 kHz mono 16-bit → a 2 h meeting ≈ 230 MB, approaching the 500 MB advisory cap). Fine for the single-user MVP. When long meetings matter, stream to S3 via multipart upload (flush buffered chunks past a threshold) so memory stays bounded and the upload overlaps the recording instead of firing all-at-once on Stop. Low urgency |
| TI-49 | ICS feed SSRF: close the DNS-rebinding TOCTOU with a `ConnectCallback` | 🔲 **Open** — raised 2026-06-25 (Phase 34-E, Hawk #2). `IcsUrlValidator.IsAllowed` resolves the user-supplied feed host and rejects private/internal IPs, but `HttpClient` then re-resolves DNS independently for the actual GET — so a rebinding host that answers public at check-time and private (e.g. `169.254.169.254` metadata) at fetch-time slips through (time-of-check ≠ time-of-use). The *trivially* exploitable redirect vector **is** closed (`AllowAutoRedirect=false`) and a 5 MB body cap is in. Accepted as a residual for the single-user app (the only "attacker" is the owner pasting a hostile URL into their own server). Fix: a `SocketsHttpHandler.ConnectCallback` on both ICS clients that resolves once, validates the connected `IPEndPoint` against `IcsUrlValidator`, and dials that IP directly (preserving the Host header for SNI/vhost) — so the IP checked == the IP connected to. Low urgency. Documented inline in `IcsUrlValidator.cs` + `docs/phases/phase-34.md` (34-E) |
| TI-50 | ICS feed: cache the fetched/parsed feed instead of re-downloading every read | 🔲 **Open** — raised 2026-06-25 (Phase 34-E). `IcsFeedCalendarClient` (v1) re-downloads **and re-parses the entire ICS feed on every meetings read** — each Home load, day-navigation, and reminder check — with no server-side cache (10 s timeout). Fine at single-user scale, and a published ICS already lags Outlook by hours so frequent re-fetching adds little. When it matters, add a short in-memory cache keyed by URL+date with a small TTL (a few minutes) so repeated reads in the window reuse the parsed result. Low urgency. Documented inline in `IcsFeedCalendarClient.cs` (class header) + `docs/phases/phase-34.md` (34-E decision #5) |
| TI-51 | Authorize workspace mutations from the event stream, not the async `WorkspaceListView` | 🔲 **Open** — raised 2026-06-25 (Phase 36-A, Hawk #1); re-verified 2026-08-09 at `src/Api/Handlers/WorkspaceHandlers.cs:139` (the check lives in the **endpoint handlers**, not `WorkspaceCommandHandler`). All three workspace mutations (`RenameWorkspace`, `DeleteWorkspace`, `SetWorkspaceTheme` — lines 67/92/119) gate ownership via `OwnsAsync` → `IWorkspaceListStore.GetAllAsync` (the **async** projection). Right after `POST /workspaces` the projector can lag, so a legitimate owner can get a spurious **404** (BUG-30 class). It is **fail-closed** (a lagging projection can only false-*deny*, never cross-user-*grant*) and the UI gates the picker behind the consistency-gated `GET /workspaces`, so it's not reachable in the real flow — hence low urgency, not a security hole. Fix **all three together** (don't diverge one handler): authorize from the event stream on the Command Lambda — read the stream and check the `WorkspaceCreated` envelope's `Metadata.UserId == currentUser` (user id rides the event metadata, see `ProjectionUpdater.ApplyWorkspaceEventsAsync`). Pairs with TI-20 (`WorkspaceList` GSI). Low urgency |
| TI-52 | Keep the Projector Lambda warm to eliminate cold-start read-your-writes lag | 🔲 **Open** — raised 2026-06-30 (observability-review; deferred alternative to the [BUG-31] fix). The projector is a stream-triggered .NET Lambda with **no SnapStart and no keep-warm** (`NoteTakerStack.cs:673`, re-verified 2026-08-09), so after an idle gap (overnight/weekend) its first invocation cold-starts ~7 s while the read gate waits only 2 s → a fresh note reads missing/stale (11 gate timeouts/14 d in prod, at morning low-traffic hours). **BUG-31 is fixed the cheap way instead** — raise the `ConsistencyGate` cap 2 s→8 s so the reader tolerates the cold start (zero cost). This TI is the *durable* follow-up if the one-off cold spinner still bothers: keep the projector warm so cold reads stay fast. Two ways — (a) **scheduled ping**: an EventBridge rule invokes the projector every ~5 min with a synthetic event the handler no-ops → **~$0.00/month** but needs a warmer code path + is "almost always" warm (AWS can still reclaim between pings); (b) **provisioned concurrency = 1**: guaranteed warm, no code change, but **~$5.40/month 24/7** (~$3.60 active-hours-only) — recurring spend the "match resilience cost to scale" guardrail disfavours for a single-user app (cf. the 26-C canary revert). Prefer (a) if picked up. Low urgency — the gate-cap fix already removes the user-visible failure. |
| TI-53 | `desktop/tests/*.spec.ts` never run in CI — the desktop suites are hand-run only | ✅ **Done** — delivered by #430 (deploy #728), written up as [TI-58](#ti-58-desktop-specs-run-in-the-pr-gate). **Filed twice:** raised here 2026-08-06 (Hawk, PR #417) and again as TI-58 on 2026-08-07 during [BUG-56], because the register was not checked before adding. Kept as the original record; TI-58 carries the detail. |
| TI-54 | Every MCP tool failure logs as an `Error` with no exception detail — expected not-founds pollute the error view, real faults are undiagnosable | 🔲 **Open** — raised 2026-08-06 (observability-review). Both halves of the [TI-38] problem at once. The MCP SDK logs `"get_note" threw an unhandled exception.` (logger `ModelContextProtocol.Server.McpServer`) at **Error** for a deliberately-thrown `McpException` — i.e. for an *expected* business outcome. Verified live: calling `get_note` with a nonexistent GUID against prod on 2026-08-06 12:45:22 produced exactly the line, and the 2 prod Errors in the 14-day window (2026-08-05 12:03, 2026-08-06 08:05, `user_agent: Claude-User`) are the same benign shape. **Over-reporting:** every "note not found" from an MCP client shows up in the dashboard "All errors" widget as a backend Error. **Under-reporting (the worse half):** the line carries **no `exception_type` and no `stack_trace`**, so a *genuine* unhandled fault inside any MCP tool is byte-identical to a benign not-found and cannot be diagnosed at all. Fix: log MCP tool outcomes ourselves — map a deliberate `McpException` to Warning and log real exceptions with type + stack (an invocation filter around the tool call), or drop the `ModelContextProtocol.Server.McpServer` category out of the Error view and emit our own truthful line. **Deploy-time: neutral** (logging config only). Medium urgency — the MCP surface is now large (35-F reads + 41-A writes) and is currently a blind spot |
| TI-55 | MCP `/mcp` connector — per-`sub` rate limiting + bound the per-call projection scans | 🔲 **Open** — raised 2026-06-25 (35-F dual security review, both APPROVE; the two non-blocking LOW findings). An allowlisted OAuth token can issue unbounded `tools/call`s (`MCP_ALLOWED_CIDRS` is empty = allow-all in prod), and `list_notes`/`get_action_items` do a full-table `Scan` per call. Item 2 folds into TI-33/TI-20 (same `Scan`→`Query` change). Cost/latency, not confidentiality — the user filter is correct. |
| TI-56 | Alarm on `RefreshTokenStoreWriteFault` (sustained > 0) | 🔲 **Open** — raised 2026-07-29 (`obs-auth-login`, PR #411). The metric ships; the Phase 30 obs table specced the alarm, consciously deferred to avoid churning the DefaultPolicy/alarm-count infra assertions in the observability slice. Add the alarm on the existing `notetaker-alarms` SNS topic and update the alarm-count assertion in the same slice. |
| TI-57 | `TodoList` read model is not wired into `ProjectionRebuildHandler` (projector-maintained only) | 🔲 **Open** — raised 2026-06-25 (Hawk nit, PR #350/37-A). The whole `TodoList` projection (todo + action rows, and now `Position` from 37-A) is built only by the async projector; `ProjectionRebuildHandler` has no `ITodoListStore`/`TodoListProjection`, so a rebuild can't re-derive it from the event stream — breaking the "projections are rebuildable" guardrail for this one read model. Pre-existing (not introduced by 37-A). Fix: wire `TodoListProjection` into `ProjectionRebuildHandler` mirroring `WorkspaceListProjection`. Low urgency (projector is the steady-state writer; no backfill needed today) |
| TI-58 | Desktop specs run in the PR gate (headless + Electron under xvfb) | ✅ **Done** — this slice. Nothing ran `desktop/tests/` before: `pr.yml` had no desktop job and `publish-desktop.yml` packages without testing. BUG-52/53/56 all reached a user's machine as a result. |
| TI-59 | Windows desktop CI job — packaging + a REAL whisper-server smoke test | 🔲 **Open** — raised 2026-08-07 ([BUG-56]). Un-gate `whisperServer.integration.spec.ts` on `windows-latest` with a cached `base.en` + a fixed WAV, resolving the binary through the production resolver (`whisperServerBinPath()`, added by [BUG-56] / #426) exactly as production does. This is the tier that proves the live engine actually transcribes. |
| TI-60 | Packaged-installer journey with injected audio | 🔲 **Open** — raised 2026-08-07 ([BUG-56]). Drive the *packaged* app end to end with a known WAV pushed through a test seam (not a virtual-audio driver) and assert live transcript text appears within a latency budget. The only tier that would catch a live-latency regression. |
| TI-61 | **A routing test fails on a busy machine even though nothing is wrong with it**, costing a thrown-away run and — the expensive part — a fresh investigation to re-establish that it is not a regression | 🟡 **In Progress** — mitigated, not closed. PR #470 raised the local-only budgets; the test ran to **5780 ms against a 5000 ms ceiling** under contention where unloaded it is 293 ms. **Stays open because two other files are predicted to exceed the new budget** — see [TI-61](#ti-61-a-routing-test-fails-on-a-busy-machine) |
| TI-62 | `deploy.yml` still carries its own inline copy of the projector warm/drain bash | 🔲 **Open** — raised 2026-08-07 (alongside the on-demand E2E workflow). The warm-and-drain logic now lives in `scripts/warm-projector.sh`, used by `.github/workflows/e2e.yml`; `deploy.yml`'s `Warm the API + projector before E2E` step is a byte-for-byte duplicate of it. Deliberately NOT switched over in the same change: the merge queue was mid-flight through that exact workflow and a broken `deploy.yml` reds the shared gate for every slice and session. Two copies of a guardrail-critical step will drift — the drain is precisely what stops a cold projector red-gating the suite. Fix: replace the inline step with `bash scripts/warm-projector.sh` (same `API_URL`/`TOKEN` env), and verify on the next deploy that the step still logs `projector caught up to head`. Low risk, but do it on a quiet gate. |
| TI-63 | Move note analysis off the synchronous request path | 🔲 **Open** — raised 2026-08-07 (BUG-58). Analysis runs inside the **29s** Command Lambda: 90d of prod data shows command-hosted Converse calls at median 2.6s but 17.9 / 21.5 / 23.6 / 26.4s in the tail, with a further **3.0-5.9s** of sequential post-Bedrock appends (`TagNote` per tag, `AddActionItem` per action, each re-reading an 89KB stream). Four invocations hit exactly 29.0s in 14 days — killed. BUG-58's 23s client deadline converts those kills into a visible 503, but it cannot create budget that isn't there: **any analysis needing >23s+tail simply cannot complete synchronously**, and a kill part-way through the appends leaves a note with a new summary and tags but no action items, with no event marking it incomplete. Fix: run analysis asynchronously (job + poll, or a dedicated Lambda off a queue with a longer timeout, mirroring the TranscribeCompletion path that already has 60s), so duration stops being bounded by the API request. Medium urgency — the deadline makes the failure visible and retriable, so this is about the ~12-19% of analyses that are near or over budget, not about data loss. |
| TI-65 | **An action list, folder tree or workspace list can still snap back to an older copy moments after the user changes it** | 🟡 **Partly done** — raised 2026-08-08 (Hawk, PR #436 / [BUG-48]). The home note list shipped 2026-08-11 (PR #459); `getActions`, `getFolders` and `getWorkspaces` remain. Detail in [TI-65](#ti-65-the-other-three-gatedread-callers-can-still-store-a-stale-body-over-good-data) below. |
| TI-66 | Extract the read-rebuild-append retry shared by three command handlers | 🔲 **Open** — raised 2026-08-10 (Hawk, PR #446 / 50-B). `TodoOrderCommandHandler` now carries a third near-identical copy of read → rebuild → handle → append → catch `ConcurrencyException` → backoff+jitter → `WriteContentionException` on exhaustion (`NoteCommandHandler`, `TodoCommandHandler`, `TodoOrderCommandHandler`). The copies drifted once already: the todo-order one was simply **missing**, which is what made 50-B's paired writes race into a 409 the client silently drops. A shared `AppendWithRetryAsync` helper makes the retry the default rather than something each handler must remember. |
| TI-68 | **The pre-commit hook's vitest run is unreliable on WSL — capping worker threads makes it both reliable AND ~4x faster** | ✅ **Done** — PR #455, merged 2026-08-10. Raised 2026-08-10 (51-B). The hook runs the full 1030-test suite on every commit touching `web/`. Unconstrained on WSL it fails non-deterministically with scattered `Test timed out in 5000ms` errors on files that cannot fail for a real reason (`taskListMarkdownRoundTrip.test.ts` is a pure string function with no async at all). **Measured on 51-B, same commit, same tree:** unconstrained → 8 failed / 1214 s, then 33 failed / 835 s; `VITEST_MAX_THREADS=3` → 1030 passed / 154 s, but **3 is marginal** — a later run at 3 still failed (5 failed / 714 s, timeouts in `ContextMemoization`, `ListView`, `useDocumentTitle`, none touched by the change). `VITEST_MAX_THREADS=2` → **1032 passed / 139 s**, and was the only setting that passed first time. Across 51-B the hook blocked 5 commit attempts and cost ~90 min without ever finding a real fault. Capping is *faster*, not a tradeoff — over-subscribed vmThreads workers thrash on the Windows FS (`setup` alone was 9179 s cumulative in the failing run vs 872 s capped). Cost 3 blocked commit attempts, ~50 min, on a change that was green throughout. **Do NOT "fix" this by forcing `CI=true`** — that selects the `forks` pool, which `web/vite.config.ts` documents as segfaulting on WSL; tried during 51-B and it was worse (53 `Failed to start forks worker` errors, 44 of 97 files never ran). **Fix (PR #455):** set top-level **`maxWorkers`** in `web/vite.config.ts` for the non-CI branch only (CI uses `forks` and is unaffected), so every clone gets the reliable path without needing to know the env var. **Correction — this row originally prescribed `poolOptions.vmThreads.maxThreads`, which Vitest 4 REMOVED and accepts as a silent deprecated no-op**: written that way the cap looks configured, reviews as correct, and never applies. Caught only by reading the deprecation warning on a throwaway single-file run. Same shape as [BUG-65]'s guards that could not fire and [TI-67]'s never-emitting RUM events — do not follow the prescribed fix literally without checking the option still exists. **Cap is deliberately NOT derived from core count:** the contention is filesystem and concurrent-session bound, not CPU bound, so more cores do not buy more workers; 2 is the measured safe value, bounded below via `availableParallelism()` for small machines. **What the evidence actually supports — read this before designing another experiment.** The claim is *"capping prevents the contention"*, **not** *"capping survives contention"*. Two capped runs are 2+2=4 workers on a 16-core box, which is not a contended condition at all — so a capped-overlap experiment **cannot reproduce the failure by construction**, and two green capped runs are the expected result rather than a test of the fix. Proof is the asymmetry: uncapped+contended fails reproducibly (**3 independent runs, 2 sessions** — 8 failed/1214 s, 33 failed/835 s, 12 failed/1204 s), capped has **never** failed in 6 runs, including one at load 14.29 against a heavy competing suite (1043 passed/328 s) and one straight through the pre-commit hook first time (1043 passed/299 s). Two paired overlapping capped runs (2026-08-10 18:46:40 and 18:46:45) were both clean at 1043/0. |
| TI-69 | **Every push left a red X on the commit that meant nothing was broken — 162 of them — and the on-demand E2E runner they came from had never once been usable** | ✅ **Done** — raised 2026-08-10, fixed 2026-08-10 (PR #453). Every push, to `main` and to every slice branch alike, created a failing `E2E (on demand)` run with **zero jobs**: nothing ran, no test failed. **Cost:** every commit carried a false red mark — the signal that teaches people to stop reading CI — and the 10-clean-run flake bar still had no cheap way to be met, which is the exact job this workflow was added to do. **Cause:** `timeout-minutes: ${{ fromJSON(inputs.runs) * 4 + 15 }}` (line 61). GitHub Actions expressions have **no arithmetic operators**, so this is a *parse* error, not a runtime one — the file never loaded, `on:` was never read, and `workflow_dispatch` was never registered. An unparseable workflow is reported by GitHub as a zero-job failing run on push, named by its file path rather than its declared `name:`. Verbatim from the API on a dispatch attempt: `HTTP 422: failed to parse workflow: (Line: 61, Col: 22): Unexpected symbol: '+'`. **Corrects this row's original diagnosis, which was inferred from the run list alone:** no second workflow or repo setting ever added a push trigger, and it did not begin at 14:34Z on 2026-08-10 — **all 162 runs since the workflow was introduced in #429 on 2026-08-07 are this**, and there has never been a successful or dispatched run. The giveaway was available all along: `gh run view <id>` says *"This run likely failed because of a workflow file issue"*, and `gh workflow run` returns the parse error verbatim — neither was checked. **Fix:** compute the timeout in bash in a small `plan` job and pass it via `needs`, which *is* an allowed context in `timeout-minutes`; keep arithmetic out of `${{ }}`. Input validation moved there too, so a bad `runs` fails in ~20s rather than after Playwright install while the shared `deploy` concurrency group is held. **Proof:** the fixing branch's push produced no `e2e.yml` run — the first push in the repo's history not to — while a parallel branch pushed minutes later still did. **Verified end to end:** run [#166](https://github.com/simonkirkham/ai-note-taker/actions/runs/31408911704) is the workflow's first ever green run — `plan` sized the timeout, the suite ran, and the account guard printed `Target account 739754704263 matches E2E_TEST_ACCOUNT_ID.` after [PR #454] moved it to job level. |
| TI-70 | **Nothing stops a broken workflow file reaching `main`, so the next one also shows up as an unexplained red X on everyone's commits rather than as a failed check** | 🔲 **Open** — raised 2026-08-10, out of [TI-69]. That defect survived 3 days and 162 red marks, and was first written up with a confidently wrong root cause, because an unparseable workflow does not fail like a test: it produces a zero-job run named by its file path, attached to a push the workflow does not even subscribe to, with no annotation on the PR that introduced it. **Cost:** every commit in the repo carries a false red X until someone happens to run the one command that reveals the parse error, and the affected workflow silently does not exist in the meantime. **Fix direction:** run `actionlint` (single Go binary, ~2s, no runtime deps) over `.github/workflows/**` and `.github/actions/**` in `docs-check.yml`, which is the workflow that already exists to gate paths `pr.yml` ignores — note `pr.yml` paths-ignores nothing relevant here, but `docs-check.yml` is the cheaper host. There is no pre-commit hook to mirror it in (removed 2026-08-11), so CI is the only host, on the same terms as `check-doc-ids.sh` (CI is the real gate; the hook needs per-clone `core.hooksPath`). actionlint catches the exact class — expression syntax, unavailable contexts, unknown keys — plus shellcheck over `run:` blocks, of which this file has many. **Verify with:** re-introducing `${{ fromJSON(inputs.runs) * 4 + 15 }}` must fail the check. **Detail, and the checks that must run before this is archived, in [TI-70](#ti-70-what-must-be-true-before-ti-70-is-archived) below.** |
| TI-72 | **An API deployed by hand is measurably slower to answer its first request than the identical code shipped by CI, and nothing says so** | 🔲 **Open** — raised 2026-08-10 (Hawk, PR #457 / [TI-64]). Every documented by-hand publish — `README.md`, `CLAUDE.md` `## How to run` — omits `-r linux-x64 --self-contained false`, the flag pair `pr.yml:62` and `deploy.yml:168,523` use to ReadyToRun-precompile the API Lambda. TI-35 shipped R2R precisely to cut first-request JIT; a manual `cdk deploy` from a clone silently undoes it and leaves prod that way until the next CI deploy. **Fix:** make the documented publish match CI's flags exactly, and prefer a single `scripts/publish-lambdas.sh` the docs, the hook and the workflows all call, so the flags exist once. |
| TI-74 | **Move the same note twice while the sync is stuck and the second move snaps back — the first move used up that note's protection** | 🔲 **Open** — raised 2026-08-11 (Hawk, PR #459 / [TI-65]). Detail in [TI-74](#ti-74-the-stale-list-guards-budget-is-keyed-by-note-not-by-write) below. |
| TI-75 | **Switch workspace at the wrong moment and the app can show one workspace's notes under the other's name** | 🔲 **Open** — raised 2026-08-11 (Hawk, PR #459). Detail in [TI-75](#ti-75-gatedreads-retries-re-resolve-the-workspace-url-mid-gate) below. |
| TI-80 | **A broken workflow committed straight to `main` still reaches everyone unchecked — the new lint only ever runs on pull requests** | ✅ **Done** — raised 2026-08-11 (reviewer, PR #464 / [TI-70]), fixed 2026-08-12 (PR [#471](https://github.com/simonkirkham/ai-note-taker/pull/471), squash `14c6c034`). Two independent Hawk reviews, both **Approved with minor comments**, no must-fix in either; their should-fixes are filed as [TI-83] and [TI-84] rather than taken as further rounds. [TI-70] closes the PR route; this is the other one. `docs-check.yml` declared `on: pull_request` only, and `CLAUDE.md` routes doc edits directly to `main`, so a workflow file changed by a direct push was linted by nothing — the same 162-red-X outcome [TI-69] produced. The prescribed fix held: `push: branches: [ main ]` with the same `paths:` list, both jobs, one file changed. **One thing the row did not predict** — the `concurrency` group had to change too; detail in [TI-80](#ti-80-the-push-trigger-needed-a-concurrency-change-the-row-did-not-predict) below. **Verified, not asserted:** six pushes on `proof/ti80-push` produced no run when the branch was outside the filter, green when clean, **red on TI-69's actual line** (`parser did not reach end of input ... "*", "INTEGER"`, run 31542276296), green again with the guard's exit code deliberately swallowed while `doc-ids` stayed unchanged, and red again on revert. Full evidence in the PR comment. **The one gap the PR recorded as unproven — `main` specifically — closed on merge:** the squash commit was itself the first push to `main` under the new trigger, producing run [31572859601](https://github.com/simonkirkham/ai-note-taker/actions/runs/31572859601), `event=push`, `branch=main`, `workflows: success` in 7s. Nothing was inferred; the run exists. |
| TI-79 | **An agent waiting for a build or a test run to finish can hang forever without saying so, and stops answering anyone trying to reach it** | 🔲 **Open** — raised 2026-08-11 ([TI-70] session). Detail in [TI-79](#ti-79-a-wait-loop-that-scans-process-cmdlines-can-never-exit) below. |
| TI-85 | **The check that proves our read-your-writes probe still works can be fooled by a read the previous page started, so it could one day pass while proving nothing** | 🔲 **Open** — raised 2026-08-12 (Hawk, PR #473 / [BUG-79], classified should-fix; not blocking, and the reviewer said so). `AppPage.ObserveActionsReadTokenAsync` clears the probe **before** reloading, so its sampling window includes any read the outgoing page starts between the route being installed and the reload. In the ungated arm such a read still carries the token, which would report the control as gated and fail the check for a reason unrelated to what it tests. **Why it is a should-fix and not a must-fix:** the ungated path has never once reported a token across ~25 recorded runs (batches of 6/10, 5/10 and 10/10); every observed failure was the *gated* arm losing its seed, which is fixed. So this is a latent hole, not an active one. **Fix:** take a sequence-number boundary just before the reload and ignore anything recorded below it. The same change closes the sibling race on the ungated arm's `ryw.*` delete, which is a live-page write with the same exposure — do that deletion in an init script too, added first so the gated arm's later seed still wins. **Why it matters beyond this one test:** it is the same class as the bug the probe was built for — a measurement that looks like a property of the system turning out to be a property of when it was taken. |
| TI-82 | **247 merged branches sit on the remote because the documented merge step silently fails to delete them, and the docs said that failure was harmless** | 🔲 **Open** — raised 2026-08-11 ([TI-80] session, from the coordinator's measurement). Detail in [TI-82](#ti-82-the-documented-merge-step-deletes-neither-branch) below. |
| TI-78 | **A browser fault that happens late in a long session still goes unreported, and nothing says so** | 🔲 **Open** — raised 2026-08-11 ([TI-67] review). The injected RUM snippet in `.github/workflows/deploy.yml` never sets `sessionEventLimit`, so the client default of **200** applies: `canRecord()` is `session.record && !isLimitExceeded()`, and `isLimitExceeded()` is `session.eventCount >= 200`. With `telemetries: ["errors","performance","http"]` at `sessionSampleRate: 1`, HTTP and performance events alone can exhaust that inside one 30-minute session — after which **every** custom event is dropped silently (`sessionLimitExceeded++`, nothing logged). This lands hardest on exactly the signals [TI-67] just enabled, because faults tend to happen *after* someone has been working a while, and it is the same self-concealing shape TI-67 existed to fix. **Fix:** set `sessionEventLimit` explicitly in the snippet (0 = unlimited), and confirm by reading an event back late in a session rather than by reading the config. |
| TI-87 | **A dropped connection while installing dependencies paints a red X on a pull request that did nothing wrong** | 🔲 **Open** — raised 2026-08-13 (hit by [CHANGE-41], PR #475, run [31677449442](https://github.com/simonkirkham/ai-note-taker/actions/runs/31677449442)). The `desktop` job's `npm --prefix desktop ci` runs Electron's `postinstall`, which downloads the ~100 MB Electron binary from GitHub releases. One `RequestError: socket hang up` failed the job in 17 s; a plain re-run passed with nothing changed. **Same class as [TI-84]** — an unretried, uncached network fetch turning a transient blip into a red check — and the same two fixes apply: retries (`npm config set fetch-retries` does **not** cover Electron's own download; it reads `ELECTRON_GET_...` / needs a retry wrapper) and an `actions/cache` on the Electron download cache keyed by version, which also removes a ~60 s download from every run. **Worth fixing together with [TI-84]**, since one cache-and-retry pass covers both. **Bound the retry, don't just add one** — [TI-84]'s review found that a naive retry delay is a lower bound, not an upper one: a rate-limited response carrying `Retry-After: 120` makes the client wait the longer of the two and blow the job's timeout, converting a 6-second red X that *names the failed download* into a timeout that names nothing. Whatever retry this uses needs an explicit total-time cap. |
| TI-88 | **A merge can be waved through as safe and then refused seconds later, and the cleanup that follows can close the pull request** | 🔲 **Open** — raised 2026-08-13, hit live on PR [#469](https://github.com/simonkirkham/ai-note-taker/pull/469): the gate printed `GREEN — safe to merge`, the merge was refused ~3 s later on conflicts, and the branch cleanup that assumed it had landed auto-closed the PR. Detail in [TI-88](#ti-88-a-gate-verdict-has-an-expiry-and-the-window-between-reading-it-and-acting-on-it-is-where-it-fails) below. |
| TI-89 | **On a Mac, the self-test that guards the merge gate reports nine failures accusing the merge-gate logic, when the only thing wrong is the machine's `date` command** | 🔲 **Open** — raised 2026-08-13 (Hawk, PR [#469](https://github.com/simonkirkham/ai-note-taker/pull/469) / [TI-81], should-fix). Measured, not argued: `scripts/test-merge-gate.sh:84-85` builds its clock fixtures with `date -u -d '-45 minutes'`, which only GNU coreutils supports. Run against a `date` without `-d`, the suite prints **`MERGE-GATE SELF-TEST: FAILED`, 45 PASS / 9 FAIL**, and every failure message names orphaned run records rather than the clock. Fix: one guard that exits loudly if `date -u -d` is unsupported. CI is `ubuntu-latest`, so it costs nobody today. Detail in [TI-89](#ti-89-the-merge-gates-self-test-blames-the-merge-gate-when-the-machines-date-command-is-the-problem) below. |
| TI-91 | **The merge gate can say it is safe to merge while a deploy is genuinely running, if the clock on the machine reading it is more than ten minutes fast** | 🔲 **Open** — raised 2026-08-13. **Derived from reading `scripts/deploy-status.sh`, not from an observed miss** — and no reading taken afterwards could establish whether one has already happened. Detail in [TI-91](#ti-91-a-fast-clock-turns-the-merge-gates-stale-run-discount-into-a-fail-open) below. |
| TI-92 | **A tracking item can be half-archived — copied into the archive but never deleted from the live list — and nothing notices, because the check that catches exactly this looks only at bugs** | 🔲 **Open** — raised 2026-08-13. **34 TI ids sit in both files today**, all pre-existing, so finished work reads as outstanding on the one column the human scans. Detail in [TI-92](#ti-92-half-archived-ti-items-are-invisible-because-the-live-vs-archive-check-covers-bugs-only) below. |
| TI-94 | **A merge can quietly put back work someone deliberately deleted — no conflict, no marker, every check green — so a closed item reappears as open work and another session's finished change is undone** | 🔲 **Open** — raised 2026-08-13. **Three confirmed instances in one day; only one was visible to any existing check, and one sat on `main` for 10 straight commits.** Archiving is exactly the delete-versus-surrounding-context operation the `merge=union` driver resolves wrongly, so it will recur. Interim gate, usable today: zero deleted lines in the diff against the **merge base** on an append-only file — diffing against `origin/main` instead reads every line `main` gained since your branch point as your deletion (**86** falsely accused vs **0** real, same branch, measured). Detail in [TI-94](#ti-94-a-merge-silently-restores-a-deleted-section-and-nothing-detects-it) below. |

**2026-06-17 deploy-gate stabilisation session:** proved **10 consecutive green deploys** (#595 ×10). Root-caused and fixed a **44-min E2E suite hang** (PR #291's fire-and-forget response-body read on the reload loop) → replaced with a hang-proof, sync-only diagnostic (PR #292) and a **hard 120 s per-test cap** (**TI-43 done**, PR #293). **TI-42** cards-list flake did not recur in 13+ runs (not reproduced ≠ fixed; diagnostic now in place). **BUG-31** turned out to be three stacked causes — original image-reappear symptom fixed, `SaveAndReturnAsync` cards-refetch sync fixed (PR #297, suite-wide win), and a residual stuck-note-detail-read layer carved out as **TI-44**. Full write-up: [docs/learnings/e2e-gate-hang-and-the-diagnostic-that-caused-it.md](learnings/e2e-gate-hang-and-the-diagnostic-that-caused-it.md).

> Items carry stable IDs in claim order (the `ID` column above); each detailed section below repeats its ID. Do not cache the highest id here — it goes stale on every claim (it read `TI-71` when the table already held `TI-72`); read it off the table, or run the script. **Never hand-pick the next id — run `scripts/next-doc-id.sh ti`.** Reference an item as `TI-N`. The dep-audit `T#` tags are retained in parentheses for cross-reference with the audit report.

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
**Still open (re-verified 2026-08-09):** no rebuild/backfill step exists in any `.github/workflows` job; the manual post-deploy `POST /admin/projections/rebuild` remains the only path. P24 (the safe-rebuild dependency) and P23 have both shipped, so this is now unblocked and standalone — no longer "pairs with Phase 23".

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

**Still open (re-verified 2026-08-09):** `DynamoDbWorkspaceListStore` still does the cross-user `Scan`+`ConsistentRead`. **Phase 23 has shipped** without touching this store, so the original "fold into Phase 23-B" plan is moot — re-home as a standalone GSI slice, ideally batched with TI-33 (same change shape, same projection-table family).

**Raised in:** Hawk review of PR #207 (slice 23-A), 2026-06-10.
**Depends on:** —

---

## TI-23. Generalise append-retry-on-conflict beyond `NoteCommandHandler`

BUG-17 (PR #217) added a bounded retry-on-`ConcurrencyException` (re-read→re-run→re-append) to `NoteCommandHandler.ExecuteAsync` only. `ActionItemCommandHandler` shares the same optimistic-concurrency append but was left out: it interleaves projection writes with its append (not the clean read→handle→append cycle), and its streams are keyed per action item, so the BUG-17 multi-writer-on-one-stream race is far less likely there.

**Why worth doing:** the latent lost-write still exists for rapid concurrent writes to a single action-item stream (e.g. fast complete/reopen toggles). **Fix:** extract a shared `AppendWithRetry` helper (or a handler base method) so the retry is defined once and applied wherever the read→handle→append pattern lives, rather than duplicated. Do it only if a second handler needs it — don't abstract for one caller.

**Still open / deliberately deferred (re-verified 2026-08-09):** `ActionItemCommandHandler` confirms no retry by design (explicit code comment: concurrent writes to a single action stream are near-impossible in a single-user app, so a persistent conflict surfaces as a 409). Separately, **BUG-28 hardened the event store itself** — `DynamoDbEventStore.AppendAsync` now classifies a `TransactionConflict` as a retriable `ConcurrencyException` for *every* aggregate — so the missing piece here is purely the shared retry-*loop* extraction, still gated on a second caller actually needing it.

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

**Still open (re-verified 2026-08-09):** `web/src/__tests__/NoteEditor.test.tsx` now exists, but it covers the **link-scheme hardening** (19-J) and **BUG-24 resolve-before-parse** invariants — *not* this item's paste→presign→PUT upload-ordering invariant. The file is the natural home; add the two cases (a) and (b) above. (BUG-31, previously flagged here as a live related concern, is **Done** — PR #397, deploy #701 — so this item now stands alone.)

**Raised in:** Hawk review of PR #220 (25-B presign-first fix), 2026-06-11.
**Depends on:** —

---

## TI-33. `NoteCardList` reads via full-table `Scan` with `ConsistentRead`, not a per-user/workspace GSI + `Query`

`DynamoDbNoteCardListStore.QueryAllAsync` (`src/EventStore/Projections/DynamoDbNoteCardListStore.cs:130`) does a **paginated full-table `Scan` with `ConsistentRead = true`**, then sorts client-side by `CreatedAt`. It backs the notes-list GET. Same anti-pattern as **TI-20** (`WorkspaceList`), on the larger and faster-growing table.

**Evidence (prod X-Ray, 2026-06-12):** `Scan` on `notetaker-proj-notecardlist`, `scanned_count` 234, `content_length` 73,988, `ConsistentRead = true` → **840 ms** — and the count, latency, and read cost all grow O(all notes across all users).

**Two issues, both growing:**
1. **`Scan`, not `Query`** — reads the entire projection every request rather than a partition-keyed slice. The precedent fix (`NoteSearchView`) uses a `UserId-index` GSI + `Query`.
2. **`ConsistentRead = true` on a `Scan`** — doubles read cost + latency vs eventually-consistent and forbids serving the read off a GSI. The single-item path (`GetByNoteAsync`, line 114) also uses `ConsistentRead = true`. Check whether the *list* read genuinely needs strong consistency: post-27 the API reads projections the async Projector Lambda builds, and read-your-writes is handled by the `ConsistencyGate` polling the proj-position table — if the gate already guarantees freshness, the strong-consistent Scan is redundant cost. The single-entity RYW need (RYW-1) does not imply the whole-list read needs it.

**Fix:** add a `UserId` (or `WorkspaceId`) GSI to `notetaker-proj-notecardlist`; switch the list read to a per-user/workspace `Query`; drop `ConsistentRead` on the list path unless the gate analysis shows it is load-bearing.

**Still open (re-verified 2026-08-09):** `DynamoDbNoteCardListStore.QueryAllAsync` still does the full-table `Scan`+`ConsistentRead`. **Phase 23 has shipped** without it, so the "fold into Phase 23" plan is moot — re-home as a standalone GSI slice batched with TI-20 (same change shape, same table family) — doing both together amortises the GSI-backfill + rebuild. The `ConsistencyGate`-makes-strong-read-redundant analysis is still worth doing as part of that slice.

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

✅ **Done** — condensed history in [technical-improvements-archive.md#ti-42](technical-improvements-archive.md#ti-42-residual-cold-start-e2e-flake--notereadyourwritesjourneyrenamed_note_appears_in_the_cards_list-110). _(Stub retained so inbound links still resolve.)_

---

## TI-44. Close BUG-31 layer 3 — note-detail read stays `loadingDetail` ~30 s after reopen+edit

✅ **Done** — condensed history in [technical-improvements-archive.md#ti-44](technical-improvements-archive.md#ti-44-close-bug-31-layer-3--note-detail-read-stays-loadingdetail-30-s-after-reopenedit). _(Stub retained so inbound links still resolve.)_

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

## TI-65. The other three `gatedRead` callers can still store a stale body over good data

[BUG-48] proved the class: a RYW-gated read that exhausts its retries returns `X-Consistency: stale` — the projector's **older** state — and React Query stores it, overwriting fresher cached data. That fix covered **note detail only**.

| Caller | File | Exposure |
| --- | --- | --- |
| `getNoteCards` | `web/src/api/notes.ts` | ✅ **Done** — PR #459, 2026-08-11. |
| `getActions` | `web/src/api/actions.ts` | 🔲 Open. Same class, per-note scope. |
| `getFolders` | `web/src/api/folders.ts` | 🔲 Open. Same class; folder tree. |
| `getWorkspaces` | `web/src/api/workspaces.ts` | 🔲 Open. Same class; lowest blast radius. |

**Why this is not a copy-paste of the BUG-48 guard.** For a single entity, "keep what is cached" is strictly safer — the stale body is older on that one stream. For a **list**, holding the cache can pin a just-deleted row into view or hide a just-added one, and the list gate only ever waits on the *single* most-recently-written stream (design decision #7), so "stale" says much less about the rest of the list. Each caller needs its own decision, and `getNoteCards` may want the monotonic-position route instead.

### What shipped for `getNoteCards` (PR #459, 2026-08-11)

`getNoteCards` returns `{ cards, stale, gatedNoteId }`; on a stale read `useNoteCards` takes the **server body** as the new list and reconciles only the one row the gate was waiting on — cache lacks it → keep it out, cache has it → keep the cached row. Holding the whole cached list was rejected for exactly the reason above. Bounded by a 3-read budget per note, re-armed on a fresh read, with a `console.warn` on exhaustion so the guard is observable.

### Why that decision does NOT transfer to the remaining three

**Cards is the only one of the four whose optimistic writers use the server id** — `useCreateNote` inserts in `onSuccess`, so the gated id and the cached row agree. The other three patch the cache with a caller-supplied **temp id** first (`useAddAction`, `useCreateFolder`, `useCreateWorkspace`), where the same reconcile reads "cache lacks the gated row" and would **hide the thing just created**. `getFolders` is additionally a *tree*, so "the gated row" is not even well defined for a move. Each still needs its own decision; do not lift `useNoteCards`'s guard wholesale.

**Not proven in a real browser.** The `getNoteCards` guard is covered by 15 jsdom specs (red 5/9 before, 15/15 after, both fixes mutation-proven), but no E2E journey asserts it — same limit as the repo's "no fetch fires is unprovable in jsdom" learning.

**The durable fix** (also the cleanest for BUG-48's residual): `ConsistencyGate` already holds `lastSeq` (`src/Api/Consistency/ConsistencyGate.cs`). Carry it on `ConsistencyResult`, emit an `X-Consistency-Position` header, and have the client keep the higher position — the same monotonic shape `setStreamToken` already uses for tokens. That replaces every per-caller heuristic with one rule.

**Deploy-time delta:** none for the client-side guards; the header route is a backend change with no deploy-path impact.
**Raised in:** Hawk review of PR #436 (BUG-48), 2026-08-08.
**Depends on:** —

## TI-74. The stale-list guard's budget is keyed by note, not by write

**What the user hits:** drag a note into folder A while the projector is behind, then drag it into folder B before it catches up — the second move snaps back to A on the home list, because the note's protection allowance was already spent on the first move. Every note gets its own allowance, but a note gets only one allowance however many times the user changes it.

**Mechanism.** `useNoteCards`'s `HeldRow` is keyed on `noteId` and its `holds` count resets only when the *gated note changes* or a fresh read arrives. A second write to the **same** note inside one lag episode inherits the exhausted count, so the guard bails to the projector's older body on the first read after it.

**Why it is narrow.** It needs the same note written twice with no fresh read in between — i.e. the projector is provably wedged on that stream, which is the case the budget exists to bound in the first place ([BUG-27]: a write that never lands makes every later read stale forever). Reviewer called it non-blocking and did not hold the PR for it.

**Fix.** Key `HeldRow` on the whole consistency token (`note#<id>@<version>`) rather than the note id. A new write produces a new token, so it earns a fresh allowance, while a wedged token keeps the BUG-27 bound intact. One line plus a spec that writes the same note twice inside one episode.

**Deploy-time delta:** none — frontend only.
**Raised in:** Hawk review of PR #459 ([TI-65]), 2026-08-11.
**Depends on:** —

## TI-75. `gatedRead`'s retries re-resolve the workspace URL mid-gate

**What the user hits:** switch workspace in the second or two after a write and the app can answer with the *other* workspace's notes, stored under the workspace they left — so one workspace's list shows content that does not belong to it until something invalidates the cache.

**Mechanism.** `gatedReadResult` (`web/src/api/gatedRead.ts`) re-issues its retries through `scopedPath`, which reads the module-global workspace id at request time (`web/src/api/client.ts`). A switch between attempt 1 and attempt 3 sends the later attempts to `/w/<newWs>/…` while the result is still stored under the original query key. Shared by the note-detail and action flows, not just cards.

**Pre-existing, and now the remaining half.** PR #459 fixed the *cache* side for cards — the queryFn takes the `queryKey` React Query passes in rather than re-resolving `keys.noteCards` — so what is left is confined to `gatedRead`'s own retry loop. It predates that branch and is untouched by it.

**Fix.** Resolve the path **once**, before the retry loop, and re-send the identical URL on every attempt; or abort the gate outright when the active workspace changes mid-flight. Fix it in `gatedRead` so every caller inherits it, rather than papering over it in one caller.

**Deploy-time delta:** none — frontend only.
**Raised in:** Hawk review of PR #459, 2026-08-11.
**Depends on:** —

## TI-66. Extract the read-rebuild-append retry shared by three command handlers

**Problem:** `NoteCommandHandler`, `TodoCommandHandler` and now `TodoOrderCommandHandler` each carry their own copy of the same loop: read the stream → rebuild the aggregate → handle → append at the read version → catch `ConcurrencyException` → exponential backoff with jitter → `WriteContentionException` (503) once the budget is exhausted. Same constants, same comments, three places.

**Why it matters:** the copies have already drifted in the worst possible direction — `TodoOrderCommandHandler` had **no retry at all**. That went unnoticed until 50-B made its two writes race each other on the stable-id `todo-order#{workspaceId}` stream, where the loser's raw `ConcurrencyException` became a 409 the client treats as a duplicate and silently drops (BUG-27's class). A missing retry is invisible until concurrency arrives; making it opt-out rather than opt-in removes the whole failure mode.

**Fix:** extract `AppendWithRetryAsync(streamId, rebuild, handle, ct)` (or an equivalent seam) and route all three handlers through it, so a new handler gets the retry by default. Keep `NoteCommandHandler`'s extra concerns (existence check, ownership check, no-op short-circuit) as callbacks rather than folding them into the shared helper.

**Deploy-time delta:** none — pure refactor of existing handler code.
**Raised in:** Hawk review of PR #446 (50-B), 2026-08-10.
**Depends on:** —

---

## TI-91. A fast clock turns the merge gate's stale-run discount into a fail-open

**What it costs:** the gate prints `GREEN — safe to merge` while a deploy is still running, the merge lands on top of it, and the in-flight deploy is disrupted. **Derived from reading the script, not observed here.** No instance has been seen on this box, and — see below — none could be found afterwards even if it had happened.

**Why.** `age_minutes()` in `scripts/deploy-status.sh` computes `datetime.now(timezone.utc) - t`. Both `t` values it is handed are **GitHub-side** timestamps — the run record's `updatedAt` and each job's `completed_at` — while `now` is the **local** clock. The discount is then gated on `if age < STALE_MINUTES or job_age < STALE_MINUTES`, which blocks whenever either looks recent. `STALE_MINUTES = 10`.

| Local clock | Computed ages | Outcome |
| --- | --- | --- |
| Behind GitHub | Negative, so under the threshold | Blocks. Fail-**closed**, safe |
| Ahead by more than `STALE_MINUTES` (10) | Both inflated past the threshold | A genuinely running deploy is classified orphaned, discounted, and the gate prints safe to merge. Fail-**open** |

**The script already names this and does nothing about it.** The comment immediately above the clock test reads: *"Clock skew is a one-sided fail-open — a local clock more than STALE_MINUTES AHEAD discounts live runs — and two GitHub-side timestamps measured against one local `now` does nothing about that."* Documented is not guarded, and that is the row's point. [TI-81, archived](technical-improvements-archive.md#ti-81-an-orphaned-run-record-blocks-the-merge-gate-for-tens-of-minutes) built this discount precisely to avoid merging onto a live deploy; the clock is a route back to that outcome that bypasses every clause of the allow-list rather than defeating one.

**Reachability.** WSL2 clocks drifting after the host sleeps or hibernates is well-known platform behaviour, and this repo's gate runs on that box. **No instance has been observed here.** Measured just now for provenance: `gh api -i` returned `Date: Thu, 13 Aug 2026 08:21:34 GMT` and local `date -u` read the same second — no skew at the time of filing.

**It leaves no trace, which is the argument for fixing it rather than watching for it.** The gate prints GREEN with a plausible-looking age, the merge succeeds, and the only symptom is a disrupted deploy surfacing — if at all — as an unrelated flake much later. No reading taken afterwards can establish whether this has already happened.

**Docs-only merges are structurally immune, and that is what makes it dangerous.** `.github/workflows/deploy.yml` paths-ignores `docs/**`, `**/*.md` and `scripts/**` (verified on `origin/main`), so a docs- or scripts-only merge produces a `Repo Checks` run and never a deploy — nothing to disrupt, whatever the clock says. Exposure falls entirely on merges carrying backend or frontend changes, while the inert merges that dominate by volume here accumulate an unbroken record of correct-looking verdicts that means nothing. A session doing docs work reads that record and concludes the gate is sound.

**Two candidate fixes, neither picked:**

| # | Fix | What it buys |
| --- | --- | --- |
| a | Measure GitHub-side against GitHub-side — the API response carries a server `Date` header (confirmed present on `gh api -i`); using it as `now` makes the skew cancel | The comparison stops depending on the local clock at all |
| b | Refuse to discount when local `now` is implausible relative to the newest timestamp seen | A clock that cannot be trusted fails **loud**, in **both** directions, not only the negative one |

**Same family as [TI-88] and [TI-90]** — a gate reporting a state that is not the state now. [TI-88] is a stale mergeability flag and [TI-81] was a stale run record; this one is a sound record read against a wrong clock.

**Raised in:** 2026-08-13, from a read of `scripts/deploy-status.sh` on `origin/main`.

---

## TI-92. Half-archived TI items are invisible because the live-vs-archive check covers bugs only

**What it costs:** an item written into the archive but never deleted from the live table stays on the outstanding list forever, so anyone scanning the `Status` column to decide what is left reads finished work as open. CI fails the build for exactly this state on a bug and permits it silently on a technical improvement.

**Why.** `scripts/check-doc-ids.sh` lines 45–55 `comm -12` the ids in `docs/phases/phase-bugs.md` against the `## BUG-N` headings in `docs/phases/phase-bugs-archive.md` and fail when an id appears in both. There is **no equivalent for TI** (`technical-improvements.md` vs `technical-improvements-archive.md`) and none for CHANGE. The *duplicate*-id check higher up does cover all three prefixes; it is only the live-vs-archive half that is BUG-only.

**Measured 2026-08-13 — 34 TI ids have a row in the live table and an entry in the archive.** All pre-existing; none introduced today.

```bash
comm -12 \
  <(grep -oE '^\| *TI-[0-9]+ +\|' docs/technical-improvements.md | grep -oE 'TI-[0-9]+' | sort -u) \
  <(grep -oE '^## TI-[0-9]+' docs/technical-improvements-archive.md | grep -oE 'TI-[0-9]+' | sort -u)
```

TI-1, 2, 4, 5, 6, 8, 9, 10, 11, 12, 13, 14, 15, 16, 18, 19, 21, 22, 26, 27, 28, 29, 30, 31, 32, 35, 36, 37, 38, 39, 41, 42, 43, 44.

**The count is 34 and not 27, and the seven-id gap is itself part of the fix.** The existing BUG check matches `^\| BUG-[0-9]+ \|` — exactly one space before the closing pipe. This table pads its column, so a single-digit id is written `| TI-1  |` with two spaces and does not match. Copying the BUG regex verbatim to TI finds 27 of the 34 and silently misses TI-1, 2, 4, 5, 6, 8 and 9. The BUG check carries the same blind spot latently — it does not bite today only because every single-digit bug is already archived out of the live table.

**Part 1 — sweep the affected ids.** For each, decide whether the live row or the archive entry is the survivor, then delete the other.

**Part 2 — extend the live-vs-archive check to TI and CHANGE**, with a padding-tolerant pattern (`^\| *<PREFIX>-[0-9]+ +\|`) so it cannot miss a padded row. Note there is **no CHANGE archive file today** (`docs/phases/` has only `phase-bugs-archive.md`), so the CHANGE half guards a file that does not yet exist and must no-op cleanly when it is absent, exactly as the BUG block already does.

**Part 2 must be seen failing before it is trusted.** With 34 existing instances it should go red immediately on the current tree. If it goes green, the check is the defect — not the tree.

**Ordering and sequencing, both binding:**

1. Part 2 will fail CI on `main` until part 1 is done, so either sweep first or land the check together with the sweep in one change. A red shared gate blocks every session here, so an interim red is a real cost, not a formality.
2. The sweep must not start until PRs **#477, #478 and #479** have landed. It rewrites most of `docs/technical-improvements.md`, and `merge=union` on this file resolves concurrent *appends*, not a wholesale rewrite against branches holding their own rows — #478 ([TI-90]) and #479 ([TI-79]) are both in a fix round. Part 2 touches only a script and is independent of that constraint.

**Raised in:** 2026-08-13, from a read of `scripts/check-doc-ids.sh` on `origin/main`.

---

## TI-94. A merge silently restores a deleted section, and nothing detects it

**What it costs:** a merge can undo a deletion someone made on purpose. The content comes back, git reports no conflict, no marker is written, and every check passes — so a finished item reappears on the outstanding list carrying advice that no longer applies, and the session that deleted it is never told. One instance below reached `main` and stayed live for hours before a human spotted it by eye.

**Why it will keep happening:** `.gitattributes` sets `merge=union` on the three tracking tables so concurrent *appends* resolve instead of conflicting. CLAUDE.md documents union's bad case as "two branches editing the same row". **There is a second bad case with no guard: a deletion on one branch against surrounding context on another.** Union keeps both sides, so the deleted content is restored. Archiving is precisely that operation — delete a row and its section from the live doc while other branches hold context around them — so every archive action is an opportunity for this.

### The gate to use today, before any of the below is built

**On a file you are only appending to, the diff against the MERGE BASE must contain zero deleted lines.** One reading, no set arithmetic, no regex to get wrong. It catches a resurrection and an accidental clobber of someone else's work together, and unlike the heading-set diff it cannot be defeated by a padding mistake:

```bash
git fetch origin
MB=$(git merge-base origin/main HEAD)
git diff $MB HEAD -- docs/technical-improvements.md | grep '^-' | grep -v '^---'
```

**Against `origin/main` instead of the merge base the gate gives the WRONG answer, and the wrong form is the one you reach for first.** `git diff origin/main HEAD` reports every line `main` has gained since your branch point as a deletion *by you* — so a branch that deleted nothing is accused of deleting other people's work. Measured on `slice/ti-90-main-checked`, the same branch, same file, both forms:

| Form | Reading |
| --- | --- |
| `git diff origin/main <branch>`, `origin/main` = `0ea857c7` | **60 added / 86 removed** |
| `git diff $(git merge-base origin/main <branch>) <branch>` | **71 added / 0 removed** |

Every one of the 86 was TI-94's own filing landing on `main` after that branch point. Re-measured 2026-08-13 with `origin/main` one commit further on (`4fbf7286`) the wrong form reads **130 removed** — the false accusation *grows* with unrelated activity on `main`, which is the tell. The row's own closing warning applies to the row: **a check that accuses wrongly gets switched off**, and this one accused wrongly on its first real use.

**`git fetch origin` first is part of the gate, not hygiene.** A stale `origin/main` moves the merge base and gives a false pass — the same input-staleness that made `scripts/next-doc-id.sh` report a taken id as free when the local `origin/main` predated the claim. The script was right; its input was old. Fetch, then check, then commit, with nothing in between.

This filing was verified that way: the commit adding it shows **66 insertions and 0 deletions**.

**When you are revising your own earlier text the count is not zero, and the gate still works** — it just becomes "zero deletions of lines *someone else* wrote". Clear it by proving every deleted line came from your own prior commit, which is mechanical:

```bash
MB=$(git merge-base origin/main HEAD)
git diff $MB HEAD -- <file> | grep '^-' | grep -v '^---' | sed 's/^-//' > /tmp/del.txt
git show <your-sha> -- <file> | grep '^+' | grep -v '^+++' | sed 's/^+//' > /tmp/added.txt
while IFS= read -r l; do [ -n "$l" ] && grep -qxF "$l" /tmp/added.txt || echo "NOT MINE: $l"; done < /tmp/del.txt
```

The follow-up commit to this row deleted 7 lines and printed nothing — all 7 were its own. Do not weaken the gate to "deletions are fine when I expect them"; the expectation is the thing being tested.

**Do not read that escape hatch as escaping the ancestry constraint below — it inherits it.** "Traced to your own prior commit" is an ancestry question wearing different clothes: `<your-sha>` has to be an ancestor of `HEAD` and not of the merge base, or the trace proves nothing. What it escapes is *pattern-matching* — it never asks whether a line looks like a resurrection, it asks where the line came from — and that is why it is worth leading with. It does not escape needing the history.

Keep the heading-set diff below as the *diagnostic* — it names **what** came back — but lead with the deletion count, which answers **whether** anything did.

### The fix — an orphan-section check

**A `## TI-N` section in the live doc with no matching `| TI-N |` row is an orphan.** Two of the instances below were exactly that shape. One `comm -23`, no network, runs beside the existing checks in `scripts/check-doc-ids.sh`:

```bash
comm -23 \
  <(grep -oE '^## TI-[0-9]+' docs/technical-improvements.md | grep -oE 'TI-[0-9]+' | sort -u) \
  <(grep -oE '^\| *TI-[0-9]+ +\|' docs/technical-improvements.md | grep -oE 'TI-[0-9]+' | sort -u)
```

Four constraints on the implementation, each measured rather than assumed:

1. **It must run against the LIVE docs only, never the archives.** Measured on `origin/main` 2026-08-13: `technical-improvements-archive.md` has **42 `## TI-` sections and 0 table rows**; `phase-bugs-archive.md` has **73 `## BUG-` sections and 0 table rows**. The archives carry no table at all, so a rule written generically over "the doc pair" — the obvious way to write it, since the live-vs-archive check beside it takes both files — fires on **all 115 archive entries** and is red from birth. A check that is red from birth gets commented out, not fixed.
2. **The row pattern must tolerate column padding** — `^\| *TI-[0-9]+ +\|`, not the existing BUG check's single-space `^\| BUG-[0-9]+ \|`. Single-digit ids are written `| TI-1  |`, with two spaces, and the single-space pattern does not match them, so it reports a *false orphan* for every one of TI-1 through TI-9. Same blind spot [TI-92](#ti-92-half-archived-ti-items-are-invisible-because-the-live-vs-archive-check-covers-bugs-only) measures at seven ids.
   **This is not hypothetical — it happened while filing this item.** The first measurement of the baseline below used the single-space pattern and reported **2 orphan sections on `origin/main` (TI-3 and TI-7)**. Both were false: the rows exist, padded. The correct count is zero. So the instrument written to catch a check that cannot see what it seeks was itself, on its first run, a check that could not see what it sought — and it reported a confident number rather than an error. Treat the padded pattern as the requirement, not the preference, and re-read [`docs/learnings/a-mechanism-nobody-has-watched-work-is-not-working.md`](learnings/a-mechanism-nobody-has-watched-work-is-not-working.md) before trusting any count this check prints.
3. **It is disjoint from [TI-92](#ti-92-half-archived-ti-items-are-invisible-because-the-live-vs-archive-check-covers-bugs-only) part 2, not a variation of it.** They take different inputs: live-vs-archive compares **two files**; the orphan check compares **two structures within one file**. TI-92 part 2 is necessary but not sufficient here — it catches a section present in both files and misses an orphan whose archive entry is absent, which is what instance 1 was.
4. **Apply the same shape to `phase-bugs.md` and `phase-minor-changes.md`** — all three carry `merge=union` and all three are archived the same way.

**It must be seen red before it is trusted.** Baseline measured on `origin/main` at `b2acbfb1` with the command above: **zero orphan sections**. So it goes green on day one, and a check whose only observed output is green is untested.

**The positive control is a git blob, not a reconstruction.** `git show 4727672f:docs/technical-improvements.md` **is** the defect — the real file, at the real sha, on `main`. Run the check against that blob and it must print `TI-73` and nothing else. It is immutable, so it cannot rot. **Do not tidy it into a synthetic fixture:** a hand-written fixture is strictly weaker, because it proves the check matches something someone wrote to be matched rather than the shape a merge actually produced.

### Three confirmed instances, one of them visible to an existing check

All verified 2026-08-13 by measuring the repository, not quoted from a report. A fourth was reported and **could not be reproduced** — see the note at the end of this section.

**Instance 1 — shipped to `main` and stayed there for 10 consecutive commits.** Squash merge [`4727672f`](https://github.com/simonkirkham/ai-note-taker/commit/4727672f) (the [TI-81] merge, PR #469) **added `## TI-73. The pre-commit gate is unbounded across sessions` back** to `docs/technical-improvements.md`; the diff shows it as an added heading. TI-73 had been archived on 2026-08-11 and its section deleted, and union restored it during one of that branch's merges of `main`. Confirmed: **no live row for TI-73 at that commit** (`grep -c '^| TI-73 |'` = 0), so it sat as an orphan section — a closed item presented as open work, prescribing a fix for a pre-commit gate that no longer exists (`.githooks/` was deleted from `main` on 2026-08-11).

Measured span, by walking `git rev-list 4727672f~1..b2acbfb1` and testing each commit for section-present/row-absent: the orphan was on `main` in **10 successive commits over 55 minutes**, `4727672f` (08:34) through `f3218a71` (09:25), removed at `b2acbfb1` (09:29). Every one of those commits was green. It also propagated: both open slice branches picked it up from `main`, so a single silent restoration seeded ten commits and two branches. TI-73 is now absent from the live doc and present in the archive — the correct end state.

**Instance 2 — caught before it shipped, by eye.** PR [#477](https://github.com/simonkirkham/ai-note-taker/pull/477) rebased onto `main` twice. The first rebase produced duplicate TI-83 **and** TI-84 rows (2 of each) and `scripts/check-doc-ids.sh` caught it. `main` then moved to `10957a81`, which archived TI-84 — deleting both its row and its `## TI-84.` detail section. The second rebase, an hour later, **silently restored the entire `## TI-84.` section**: the resulting commit carries the section with **no matching row**, and only one TI-83 row, so the duplicate check printed OK. Nothing caught it; it was found by diffing section headings against `origin/main` by hand, and removed in a later amend. Pushing it would have undone another session's completed archive with every check green.

**Instance 3 — the only one an existing check would have caught, and only by luck.** The [TI-90] worktree (PR [#478](https://github.com/simonkirkham/ai-note-taker/pull/478)) reached commit `12cb3076` carrying **two `| TI-90 |` rows**. `scripts/check-doc-ids.sh`'s duplicate-id check catches this — but only because the restored content happened to be a *row*, which duplicates an id. Restore a *section* instead, as instances 1 and 2 did, and the same driver on the same file produces nothing for any check to see. **One in three, and the one is an accident of which half of the item came back.**

> **Durability of the controls.** Instances 2 and 3 live only in their worktrees' reflogs and **will expire**; instance 1's blob is on `main` and is permanent. Test against `4727672f`, and do not substitute a fixture for it.

**A fourth instance was reported and does not survive checking.** The report was a resurrected `| TI-84 |` row on the two open slice branches. Every commit carrying that row was tested with `git merge-base --is-ancestor 10957a81 <sha>`, and **none is a descendant of the archive commit** — so each is legitimate pre-archive ancestry, not a restoration. Likewise the TI-73 orphans on those branches are inherited from instance 1's span on `main`, not independent events. Recorded because the near-miss is the point: **a resurrection and ordinary pre-archive ancestry look identical in a `grep`, and only an ancestry test separates them.** Any check built here must test ancestry before it accuses, or it will generate false reports of exactly this kind — and a check that accuses wrongly gets switched off.

**Run the ancestry test PER BRANCH. It does not generalise, and the two branches in that fourth report split on it** — same artefact, opposite diagnosis, decided entirely by ancestry (re-run 2026-08-13, `git merge-base --is-ancestor 10957a81 <ref>`):

| Branch | Descends from `10957a81` (the TI-84 archive)? | Diagnosis |
| --- | --- | --- |
| `slice/ti-79-cmdline-wait-guard` (PR #479) | **NO** | pre-archive history — an inherited TI-84 row is legitimate, not a resurrection |
| `slice/ti-90-main-checked` (PR #478) | **YES** | post-archive — an inherited TI-84 row there **would** have been a resurrection |

**The failure mode, recorded because it happened here: a per-branch test cannot support a cross-branch conclusion.** One branch was tested and the verdict was stated for both. It came out right by luck — neither carried the row in the end — which is the worst way for it to come out, because it earns the method trust it has not got. Test every ref you name, or name only the ref you tested.

### Why nothing catches it today

`scripts/check-doc-ids.sh` has two checks and neither sees this shape:

- The **duplicate-id** check (`uniq -d` over rows) covers all three prefixes, but a resurrected *section* adds no row, so there is nothing to duplicate. Instance 2 passed it.
- The **live-vs-archive** `comm -12` check compares **BUG ids only** (script lines 45–55) — verified by reading the script. A resurrected `TI` section is invisible to it, and instance 1's TI-73 had no archive-side row to compare anyway.

It printed `doc ids OK` throughout instances 1 and 2, and caught instance 3 only because that one restored a row rather than a section.

### Other directions, as options not decisions

- **Extend the live-vs-archive check to TI and CHANGE** — this is **[TI-92](#ti-92-half-archived-ti-items-are-invisible-because-the-live-vs-archive-check-covers-bugs-only) part 2**, already specced there. Do not duplicate it. Necessary but not sufficient, per constraint 3 above.
- **Reconsider `merge=union` on these files, or narrow where it applies** — union was adopted because PR #414 re-conflicted three times in one day. Removing it trades silent restoration for frequent conflicts; narrowing it (union on the table region only, normal merge on the detail sections) keeps the benefit where appends happen and restores conflict markers where deletions happen. Unmeasured.
- **Correct the `merge=union` comment in `.gitattributes` in the same change** — it currently states that `scripts/check-doc-ids.sh` "runs in the pre-commit hook", so a reader concludes union's bad case is caught before a local commit. It is not: `.githooks/` was deleted from `main` on 2026-08-11 (`dba8fce8`, "Remove the pre-commit hook entirely, and every reference to it") and `git ls-tree -r origin/main` lists **0** files under `.githooks/`. Name `.github/workflows/docs-check.yml` as the only enforcement point. This is the documentation of the exact mechanism TI-94 is about, which is why it is here and not a row of its own.

### Sequencing

TI-94's check is **independent of TI-92's sweep and can land at any time** — it touches only `scripts/check-doc-ids.sh`, goes green on the current tree, and needs no doc rewrite. TI-92's 27+ row sweep must still wait behind PRs **#477**, **#478** and **#479**.

### A related current reading, recorded here to place it correctly

Three ids have a `## TI-` section in **both** the live doc and the archive: **TI-19, TI-42, TI-44**. All three trace to `8b3b0d15` (2026-06-29, `Revert "docs(scout): add per-slice Value statements to Phase 43"`), which re-added all three headings — pre-existing, not fresh resurrections. **This belongs to [TI-92](#ti-92-half-archived-ti-items-are-invisible-because-the-live-vs-archive-check-covers-bugs-only)'s sweep scope, not TI-94's**, and it is a different measurement from TI-92's headline 34: that 34 counts live *rows* against archive *sections*; this 3 counts live *sections* against archive *sections*. Both were re-measured 2026-08-13 and both are correct.

**Raised in:** 2026-08-13, from two observed instances — one on `main`, one on a branch.

---

## TI-89. The merge gate's self-test blames the merge gate when the machine's `date` command is the problem

**What it costs:** someone on a Mac runs the self-test that guards every merge, sees it red, and is pointed at the orphaned-run-record logic — which is fine. The real cause is two `date: illegal option -- d` lines printed far above the failures, with nothing connecting them. Time spent chasing a phantom bug in the one script every session has to pass. Costs nobody today: CI is `ubuntu-latest`.

**Why:** `scripts/test-merge-gate.sh:84-85` builds `STALE` and `FRESH` with `date -u -d '-45 minutes'`, a GNU coreutils extension. BSD `date` (macOS) rejects `-d`, both assignments capture the empty string, and every fixture's `updatedAt` becomes `""`. The gate then blocks on "the run record carried no readable updatedAt" — a correct refusal, reached by a path unrelated to what the case tests.

**Measured 2026-08-13, with `date` shadowed by a stub that rejects `-d`:**

| Run | Result |
| --- | --- |
| GNU `date` | `MERGE-GATE SELF-TEST: GREEN` — 54 PASS, 0 FAIL |
| `date` without `-d` | `MERGE-GATE SELF-TEST: FAILED` — 45 PASS, 9 FAIL, exit 1 |

The nine read like the gate is broken: `an orphaned record is discounted, and said so — exit 1, wanted 0; missing 'orphaned'`, `a job with no completed_at cannot establish that the run finished — missing 'no readable completed_at'`, `the caller inherits the discount, on one line — the discount did not survive the relay onto the MAIN DEPLOY line`. None mentions a clock.

**The review that raised this predicted the opposite outcome — that the suite would degrade into passing while asserting nothing.** It does not; it fails loudly, at the suite level, on nine cases. That is a better failure than the one predicted, and it is why this is a should-fix and not urgent. What survives the correction is the **accusation**: a broken check that names the wrong culprit is still a broken check, and the 45 cases that still say PASS include ones whose clock fixtures are now empty and are passing on an unrelated arm. Same family as the standing `CLAUDE.md` rule that a mechanism nobody has watched work is not working — here the instrument was watched, and the prediction about it was wrong.

**Fix:** one guard beside the assignments — compute `STALE`, and if it is empty, print `this suite needs GNU date (coreutils); on macOS: brew install coreutils and put gnubin on PATH` and exit non-zero. Loud and named beats nine failures that name something else.

**Verified NOT a gap — do not re-open it.** The same review also flagged that the `updated_at` staleness clock had no test pinning it, because on a re-run GitHub carries already-successful jobs into the new attempt with their **original** `completed_at`, leaving `updated_at` to decide alone (`deploy-status.sh:256-259` says exactly this in a comment). The fixture it asked for already exists: `test-merge-gate.sh:243-249`, "Clause 3's own red test — identical to #762 in every way except a fresh record", is stale jobs plus a fresh `updated_at`. Injecting the exact defect warned about — rewriting `if age < STALE_MINUTES or job_age < STALE_MINUTES` to drop the `age` term — reddened that case and failed the suite (53 PASS / 1 FAIL). The guard bites.

**A known limit, recorded so nobody files it as a defect:** a `skipped` job blocks the discount, so an orphaned record on a run carrying one keeps the original bug. This is conscious and tested (`a conclusion outside the allow-list blocks rather than being guessed at`) — it is the allow-list failing **closed**, which is the property the whole fix exists to have. Measured **1 skipped job in 125, across 25 runs**, and in that one instance it accompanied a failure that blocks regardless.

**Raised in:** 2026-08-13, Hawk's post-merge review of PR #469 ([TI-81, archived](technical-improvements-archive.md#ti-81-an-orphaned-run-record-blocks-the-merge-gate-for-tens-of-minutes)), two findings folded into one item.

---

## TI-88. A gate verdict has an expiry, and the window between reading it and acting on it is where it fails

**What it costs:** a merge is declared safe, refused seconds later, and the branch cleanup that normally follows a successful merge then deletes the remote branch — which **auto-closes the pull request**. Fully recoverable (re-push the sha, `gh pr reopen`), but it is a live path from one stale field to a closed PR, and the person hitting it has just been told the opposite by the gate.

**Observed live, 2026-08-13.** `scripts/merge-gate.sh 469` printed `MERGE GATE: GREEN — safe to merge PR #469`, with `MERGEABLE: ok (CLEAN)`. Roughly **three seconds later** `gh pr merge 469 --squash` was refused: `GraphQL: Pull Request has merge conflicts (mergePullRequest)`. Two commits (`504990a2`, `95ecf1ee`) had just been pushed directly to `main` in between. First-hand reading, both halves watched.

**Why:** GitHub computes a PR's mergeability **asynchronously**. Until it recomputes against the new `main`, the API keeps serving the previously-computed `MERGEABLE`/`CLEAN`. The gate therefore reads a value that is already stale — and, the part that matters, it **cannot distinguish "verified clean against current `main`" from "not yet rechecked"**. Both arrive as `MERGEABLE`/`CLEAN`.

**Distinct from its two neighbours — do not fold them together.** [TI-81] (archived) was a stale *run* record on the deploy gate. [TI-87] is a network blip on a dependency download. This is a stale *mergeability* flag on the PR gate, in a different script, with a different failure path.

**Same shape as [TI-81], and the shape is the reusable part:** a gate reporting a state that was true a moment ago and is not true now — a stale run record there, a stale mergeability flag here. See [TI-81 in the archive](technical-improvements-archive.md#ti-81-an-orphaned-run-record-blocks-the-merge-gate-for-tens-of-minutes). It is the same family as [TI-77] (`UNKNOWN` mergeability read as a conflict) and as the standing guardrail in `CLAUDE.md` about a mechanism nobody has watched work: a check that agrees with reality without being able to see it. TI-77 fixed *not yet computed*; this is *computed, then invalidated*.

**Two candidate fixes, neither picked:**

| # | Fix | What it buys |
| --- | --- | --- |
| a | Record `origin/main`'s sha at the moment the gate reads `MERGEABLE`, and re-check immediately before merging that the sha has not moved — fail **closed** if it has | The verdict can name what it was computed against, so a later step can tell it is void |
| b | Treat the verdict as having an expiry and re-run the gate **inside** the merge step, rather than as a separate earlier call | Closes the window rather than detecting movement inside it |

(b) removes the window; (a) keeps the two calls but makes the second able to see the first is void. Either way the gate must be able to say **which `main` it checked** — a verdict that cannot name its input cannot be re-validated.

**A second, operational rule this incident produced, independent of whichever fix is taken:** never run cleanup on the assumption an action succeeded. Verify the action landed, *then* clean up. Here the cleanup ran on the assumption the merge had happened, and turned a failed merge into a closed PR — the cleanup did more damage than the bug.

**Learnings:** [merge-gate-verdicts-expire.md](learnings/merge-gate-verdicts-expire.md).

**Raised in:** 2026-08-13, measured during [TI-81]'s own merge.

---

## TI-82. The documented merge step deletes neither branch

**What it costs:** the remote carries **247** `slice/`+`proof/` branches (measured 2026-08-11, after three were removed). Every `git fetch`, every branch autocomplete, every "is this still in flight?" question is paid against that list, and a genuinely-live branch is indistinguishable from 240 dead ones. `scripts/next-doc-id.sh` scans 305 remote refs to answer one question.

**Why it went unnoticed for so long: the doc said the failure was harmless.** `CLAUDE.md` → `## Workflow` step 11 stated that `gh pr merge --squash --delete-branch` deletes the *remote* branch and only its *local* cleanup fails (`'main' is already used by worktree`) — "this is harmless". It is not. When the local step errors, `gh` aborts the whole cleanup and **the remote branch survives silently**. Nobody checked, because the doc had already answered the question.

**The measurement (coordinator, 2026-08-11, five merges):**

| Branch | Remote after merge |
| --- | --- |
| `slice/ti-67-rum-custom-events` | still on remote |
| `slice/ti-65-gated-read-stale` | still on remote |
| `slice/ti-77-merge-gate-unknown` | still on remote |
| `slice/ti-70-actionlint` | gone — deleted by hand |
| `slice/ti-61-routing-flake` | gone — deleted by hand |

Three of five survived, and the two that did not are exactly the two deleted explicitly. **Done 2026-08-11:** `CLAUDE.md` steps 11 and 13 corrected (both deletes are now explicit, and step 11 no longer calls the failure harmless), and the three branches above deleted after confirming each was safe.

**Confirming a squash-merged branch is safe to delete — `git branch -r --merged` is the wrong test.** A squash merge never makes the branch tip an ancestor of `main`, so `--merged` lists none of these and `--is-ancestor` returns NO for all three; read naively that says "unmerged, do not delete". Two checks settle it instead:

1. `gh pr list --state all --head <branch>` → the PR is `MERGED` and names its squash commit; `git merge-base --is-ancestor <squash-sha> origin/main` confirms that commit is on `main`.
2. For the files the branch actually touched — `git diff --name-only $(git merge-base origin/main <tip>) <tip>` — check none still differs: `git diff --name-only origin/main <tip> -- <those files>`. A residual here is not automatically unmerged work; on both branches that showed one, the file had been changed by a *later* commit on `main` (#470, #464), which `git log <squash-sha>..origin/main -- <file>` shows in one line.

**Remaining work:** the other 247 are historical and were deliberately not swept. A sweep needs the two checks above run per branch — worth scripting (`scripts/prune-merged-branches.sh`, dry-run by default) rather than doing by hand, since the naive `--merged` filter is wrong for every squash-merged branch in the list and would report almost all 247 as unmerged.

**Raised in:** [TI-80] session, 2026-08-11, from the coordinator's measurement.
**Depends on:** —

---

## TI-80. The push trigger needed a concurrency change the row did not predict

**What it would have cost:** a broken workflow file reaching `main` unlinted **anyway**, with a run list that looks fine. The row's prescribed fix — `push: branches: [ main ]` with the same `paths:` list — is correct and is what shipped. But `docs-check.yml` keys its concurrency group `docs-check-${{ github.head_ref || github.ref }}` with `cancel-in-progress: true`. On a pull request `head_ref` is the branch, so runs are keyed per-PR. On a **push** `head_ref` is empty, so every push to `main` falls into **one** group — and the second merge landing a minute after the first **cancels the first's lint**. A cancelled run is not a failing run. Merges land minutes apart here routinely.

**Fix:** `docs-check-${{ github.head_ref || github.sha }}`. Pull-request behaviour is byte-identical (`head_ref` is non-empty there, so that operand never changes); each pushed commit gets its own group, so no push can cancel another and every commit reaching `main` is linted exactly once.

**Watched working, not argued.** Two commits pushed 5s apart on `proof/ti80-push`:

```
run 31542444491 failure created=22:26:50Z  workflows:failure 22:26:53->22:27:00
run 31542450478 success created=22:26:55Z  workflows:success 22:26:58->22:27:07
```

They overlapped and **both completed**. Under the old key the first — the one carrying the red — would have been cancelled at 22:26:55.

**The generalisable bit:** adding a trigger to an existing workflow inherits every workflow-level setting, and `concurrency` is the one that can silently convert a new red into no red at all. Check the concurrency key against the *new* event's contexts, not the old one's — `github.head_ref` is empty on a push, which turns a per-branch key into a global one without changing a character of it.

**Raised in:** [TI-80] implementation, 2026-08-11. **Fix:** PR [#471](https://github.com/simonkirkham/ai-note-taker/pull/471).
**Depends on:** —

---

## TI-79. A wait loop that scans process cmdlines can never exit

**What it costs:** the session goes quiet mid-task and stays quiet. Nobody is told it is stuck, it never reaches another tool round, and **queued messages cannot reach it** — so a peer or the human asking "are you alive?" gets nothing back. Recovery is killing the wrapper pid by hand. Adjacent to [TI-70]: both are guards over code `pr.yml` cannot see.

**Mechanism.** A wait built on scanning process command lines for a literal — `pgrep -f "<pattern>"`, or any `ps` / `/proc/*/cmdline` equivalent — **self-matches**. This harness runs each Bash tool call as `/bin/bash -c … && eval '<the entire command text>'`, so the wrapper's own cmdline contains whatever pattern was typed, and the scan always finds itself.

| Probe | Result on a completely idle box |
| --- | --- |
| `pgrep -fc 'qqq-isolated-nonsense-qqq'` | **1** |
| The same literal, confined to a script run as a bare path | 0 |

So `until ! pgrep -f "bin/eslint"; do sleep 15; done` never exits, whatever eslint does.

**Happened for real on 2026-08-11:** a reviewer agent wrote exactly that loop, the lint step finished, and the loop would have spun indefinitely.

**The one-shot form fails differently and worse.** It returns a plausible phantom — "the job is running" — when nothing is. The tell is an `etime` of 0-2 seconds against a job that should have been alive for minutes.

**`pgrep -f` is legitimate inside a committed script run as a bare path**, because no wrapper then carries the pattern. It is the *invocation* that is broken, not pgrep — see the same analysis under [TI-73](#ti-73-the-pre-commit-gate-is-unbounded-across-sessions), which needs a working process/load probe and is where this was first characterised. **Any check must therefore not reject hook-internal use.**

**Fix direction:** grep committed scripts for process-scanning waits **in `docs-check.yml`**, on the same terms as `check-doc-ids.sh`. Note the pre-commit hook was removed on 2026-08-11, so CI is now the only place such a check can live — there is no local hook to put it in.

**What it cannot cover, stated rather than implied.** The ad-hoc case: an agent typing the loop straight into a Bash call. No committed-file check reaches that, and **that is exactly where this happened**. A guard over `scripts/` is worth having, but the durable fix for the ad-hoc case is a written rule (wait on a pid, an exit status, a sentinel polled with `until grep -q … ; do sleep 20; done`, or a sha changing) plus this row to point at. Note also that `timeout N tail -f FILE | grep -m1 SENTINEL` does **not** return when the file stops growing.

**Related:** [docs/learnings/a-mechanism-nobody-has-watched-work-is-not-working.md](learnings/a-mechanism-nobody-has-watched-work-is-not-working.md) carries this as instance 2 and its live recurrence.

---

## TI-70. What must be true before TI-70 is archived

**Merged 2026-08-11** — PR [#464](https://github.com/simonkirkham/ai-note-taker/pull/464), squash `a43574e6`, deploy #763. **All seven rows ticked as of 2026-08-11**; row 7, the last and the only one testing the merged state, is recorded below. This section exists because the item's own subject is checks nobody watched run, so its own closing conditions must live somewhere durable rather than in a merged PR description nobody re-reads.

**Row 7 was ticked on 2026-08-11 by [TI-80]'s PR [#471](https://github.com/simonkirkham/ai-note-taker/pull/471)**, which was the predicted candidate — its diff is `docs-check.yml` and nothing else. The check was read *by name* out of `gh pr checks 471`, not inferred from a green PR (`pr.yml` also runs on `.github/**`, so green proves nothing here).

| # | Check | State |
| --- | --- | --- |
| 1 | The TI-69 line (`timeout-minutes: ${{ fromJSON(inputs.runs) * 4 + 15 }}`) fails the check **in CI** | ✅ PR #465, run 31475167456 — `parser did not reach end of input ...`, exit 1 |
| 2 | The same line fails it **in the pre-commit hook** | ✅ commit refused, `HEAD` unchanged |
| 3 | Green on the real tree, with shellcheck present (CI parity) | ✅ exit 0; re-run after the #463 merge resolution |
| 4 | **Injected defect** — disable the failure path and confirm the red case passes | ✅ `"$bin" -color \|\| true` → exit 0 with the defect still present; reverted |
| 5 | A PR whose diff is **only** `.github/workflows/**` gets a `workflows` run | ✅ PR #467 (base `proof/ti70-base`, head `proof/ti70-head`) — changed files = `[.github/workflows/e2e.yml]`, `workflows` pass. (The proof branch was cut before [TI-77] merged, so its `paths:` list is a **subset** of the shipped one — but it contains `.github/workflows/**`, the entry under test, and path filters are OR'd, so a superset cannot stop a glob matching.) |
| 6 | A workflow-only PR got **no** `Docs Check` run before this change | ✅ PR #466 — `gh run list` returns only `PR Checks` |
| 7 | **After merge:** the first real PR touching only `.github/workflows/**` shows a `Repo Checks / workflows` run | ✅ **2026-08-11, [TI-80]'s PR [#471](https://github.com/simonkirkham/ai-note-taker/pull/471)** — `gh pr view 471 --json files` = `[.github/workflows/docs-check.yml]`, one path, nothing else. `gh pr checks 471` lists the check **by name**: `workflows  pass  6s`, run [31541957717](https://github.com/simonkirkham/ai-note-taker/actions/runs/31541957717) (`event: pull_request`), alongside `doc-ids  pass  20s`. Not inferred from a green PR. Verified by the TI-80 session |

**All seven rows are ticked and [TI-80] has merged, so TI-70 is ready to archive — that is the next action on it, and it was deliberately not done here.** Terms: condense to one entry in [technical-improvements-archive.md](technical-improvements-archive.md), keep the `## TI-70` heading so inbound anchors resolve, delete the row and this section. Two things the archive entry must carry rather than drop: known limit **3** below is **permanent** (see it for why), and known limit **4** is now **closed** by [TI-80] — the gate runs on a direct push to `main`, watched doing so at run [31572859601](https://github.com/simonkirkham/ai-note-taker/actions/runs/31572859601).

Rows 1-6 were all demonstrated on a branch; row 7 was the only one that tested the merged `paths:` filter on `main`, which is the half TI-69 actually fell through.

**Known limits, so nobody assumes coverage that is not there:**

1. A TI-69-shaped defect **inside a composite action's `run:` block** is not caught. actionlint validates a local action's metadata (YAML parse, `runs.using`) via the workflow that `uses:` it, but never lints the shell inside it — measured, exit 0 on both an unused variable and an unquoted expansion.
2. An action referenced by **no** workflow is never looked at.
3. **`docs-check.yml` is the one workflow the gate cannot protect — and this is a permanent limit, not a to-do.** Broken, it does not load, so it cannot run the lint that would have caught it: the check is hosted by the file it would need to check, and no arrangement of triggers escapes that. True on both the pull-request and the push route, so [TI-80] does not change it. Nothing in the repo covers this file; the only defence is that a change to it is small, deliberate, and made by someone who has just read this line. Do not file it as work — carry it into the archive entry as a stated limit. Raised by Hawk on PR #471.
4. ~~**The gate never runs on a push to `main`.**~~ **CLOSED 2026-08-12 by [TI-80]** (PR [#471](https://github.com/simonkirkham/ai-note-taker/pull/471), squash `14c6c034`). The limit was real: `docs-check.yml` was `pull_request`-only, so a workflow file changed by a **direct commit to `main`** — the route `CLAUDE.md` explicitly uses for doc edits — was linted by nothing anywhere, `.githooks/pre-commit` having been deleted on 2026-08-11. **Watched closing:** TI-80's own merge commit was itself the first push to `main` under the new trigger, and produced run [31572859601](https://github.com/simonkirkham/ai-note-taker/actions/runs/31572859601) — `event=push`, `branch=main`, `workflows: success` in 7s. That is the `main` case TI-80's PR had honestly recorded as unproven, closed by the merge rather than by argument.

---

## TI-61. A routing test fails on a busy machine

**What it costs.** A CI run or a deliberate local suite run is thrown away on a test nobody
touched. The expensive part is not the run — it is that the next person has to re-derive from
scratch that it is not a regression. That has now happened at least twice.

**The measurement that settles it.** Under deliberate contention (32 CPU spinners, no other
suites, `ratio1` 1.97 rising to 2.91):

| Test | median | max | ceiling |
| --- | --- | --- | --- |
| `Back returns to the home screen` | 3966 ms | **5780 ms** | 5000 ms |
| `opening a note pushes a /notes/:id URL` | 2334 ms | 3379 ms | 5000 ms |
| `Forward reopens the note` | 1840 ms | 2949 ms | 5000 ms |

The binding test exceeds the ceiling on its own, and sits at 79% of it even when it passes.
Unloaded and alone it is 293 ms — the box's effective speed varies by 10-56x, and a fixed
wall-clock deadline cannot tell "slow machine" from "hung test" across that range. A per-test
timeout exists to catch hangs, not to assert machine speed.

### Still open: two files are predicted to exceed the new budget

This is why the row is 🟡 and not ✅. Ranking every test file by its slowest test (full suite,
unloaded — relative durations rank the same without contention):

| slowest test | file | |
| --- | --- | --- |
| 2455 ms | `staleDetailRefetch.test.tsx` | work-bound |
| 2437 ms | `staleCardsRefetch.test.tsx` | work-bound |
| 1125 ms | `Routing.test.tsx` | work-bound — the file that has actually been failing |
| 1039 ms | `HomeSearch.test.tsx` | **discount** — 4 real `setTimeout` sleeps, which do not inflate under CPU starvation |

`Routing` inflated 1125 -> 5780 ms (~5.1x) under deliberate contention. **The same multiple on
2455 ms is ~12500 ms, which exceeds the 12000 ms budget PR #470 sets.** Both files are genuinely
work-bound — no fake timers, no sleeps — so they should inflate the same way.

**Remedy, when one of them fails — do this, not something else:**

1. Reproduce it under deliberate contention and record the *measured* worst duration.
2. Raise `LOCAL_TEST_TIMEOUT_MS` in `web/vite.config.ts` to **that file's worst x2**.
3. **Do not raise it pre-emptively.** ~12500 ms is an extrapolation; neither file has been measured
   under contention. Sizing a budget off an unmeasured multiple is the error this investigation
   refused three times (a role-query theory that measured 15 ms, an underpowered 2/10-vs-0/10 A/B,
   and a reviewer's suggested 25000 ms). A measured number is checkable six months later; a guess
   is indistinguishable from a measurement, including in whether it was already too small.

**Post-merge observation owed, and by whom.** Nothing about this fix is verifiable from a green
deploy — the change only takes effect on a *locally contended* run, which CI never performs. The
observation that would prove it is a local full-suite run under load that previously failed and now
passes; that was taken before merge (control red at 5000 ms, candidate 0 failures / 60 under
identical contention). **No further observation is owed, and no future session should record this
as Done on the strength of a deploy** — the row closes only when the two files above have been
measured, or when they have gone long enough without failing that the exposure is judged closed.

**Fix.** `testTimeout` 12000 (= worst observed 5780 x2) and `asyncUtilTimeout` 4000
(= longest succeeding wait 1735 x2), **local only**, mirroring the existing `LOCAL_MAX_THREADS`
precedent. CI keeps 5000/1000 — it runs the frontend job alone on native Linux, so a genuine
hang still fails there. `testBudgets.test.ts` asserts the split in both directions, so CI is its
own positive control against the raised budget leaking into it.

### Corrections to the original row — it was wrong on every specific

The row as filed on 2026-08-06 said the failing assertion was `findByTestId('note-title-input')`
after `window.history.forward()`, missing its 1000 ms budget because the *render* was slow.
Measured, none of it holds:

| The row said | Measured |
| --- | --- |
| `Forward reopens the note` | Every reproduction failed in **`Back returns to the home screen`** |
| `findByTestId(...)`, 1000 ms budget | `Test timed out in 5000ms` — the **per-test** budget, a different ceiling |
| the render misses the window | The render is fine. `<h1>{heading}</h1>` has no data gate; one pass of the role query costs **15 ms** under load |
| "second observation of the same failure" (34-C) | **Unverified, and now withdrawn.** The cited `token-log.md` entry names no test at all — only "the one flake (Routing.test)". It was an inference presented as an observation |

The row's own arithmetic was the tell: the steps *before* the failing assertion ran 2.65x their
unloaded time while the assertion blew a >9x anomaly. A uniformly slower box cannot produce that.

### Withdrawn: the poll-vs-mutation theory, and the 48-site claim built on it

An intermediate diagnosis held that `waitFor` on a non-DOM value (`window.location.pathname`) is
structurally worse under starvation, because RTL's MutationObserver cannot see a non-DOM value
and only the 50 ms poll remains. **Measured head to head, it is backwards:** poll `backWait`
165 ms against mutation `backWait` 199 ms. The 1735 ms figure that made the theory look
overwhelming came from a run carrying three other sessions' suites; alone on the box the same
step is 165 ms. It was contention, not the wake mechanism.

Consequently **the count of 48 `waitFor(pathname)` sites across 9 files is a scope measurement,
not 48 defects**, and `OpenNoteTabs.test.tsx` (23 of them) is *not* predicted to be the next
casualty on that basis. If the mechanism is a fixed deadline against variable machine speed,
exposure scales with **total test duration**, not with the number of pathname waits.

### Read the load figures as period-specific

Every figure here was gathered while the pre-commit hook still ran full suites on every commit
across parallel sessions. That hook was removed the same night (`dba8fce8`), so ambient load on
this box will be materially lower from now on. The numbers are real, but nobody should read
`ratio1` 2.28 as this machine's resting state — which makes 12000 ms more conservative than it
looks, and that is the right direction for a budget whose only job is to catch a genuine hang.
