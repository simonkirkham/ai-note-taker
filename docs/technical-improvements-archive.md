# Technical Improvements — Archive (Done items)

Condensed history of **completed / dropped** technical-improvement items, moved out of [technical-improvements.md](technical-improvements.md) to keep the live doc to the Summary table + open work. One terse entry per item; IDs and headings are preserved so inbound `#ti-N` links still resolve. Full per-item history is in git and the linked PRs/learnings.

Live doc (open items + the index): [technical-improvements.md](technical-improvements.md).

---

## TI-1. Decide on a server-state library (TanStack Query / SWR) vs hand-rolled hooks — and record it

✅ [ADR 0010](adr/0010-server-state-strategy.md) (14-W) — **deferred, stay hand-rolled** (a library would hide the server-state mechanics this learning repo wants to keep). Later reversed by Phase 20 / [ADR 0012](adr/0012-adopt-tanstack-query-server-state.md).

## TI-2. Stricter TypeScript compiler flags beyond `strict`

✅ → [Phase 19](phases/phase-19.md) (19-B `noImplicitOverride`, 19-C `noUncheckedIndexedAccess` → `exactOptionalPropertyTypes`).

## TI-4. Core Web Vitals — bundle budget gate + CLS sizing + non-urgent transitions

✅ → [Phase 19](phases/phase-19.md) (19-I — lazy-load Tiptap + transcribe-streaming, CI bundle-size budget, CLS sizing, `useTransition`/`useDeferredValue`). Targets (field, 75th pct): LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1.

## TI-5. Network resilience — retry transient failures with backoff

✅ Phase **20-G**. `apiFetch` retries transient failures (5xx / 429 / network drop) with exponential backoff + full jitter, honours `Retry-After`, capped 3 attempts. **Reads only** — writes are optimistic-with-rollback (`mutations.retry:false`); retrying a PUT/DELETE only delays rollback and a POST risks a duplicate create. Subsumed the old 19-H.

## TI-6. XSS hardening — allowlist URL schemes on user-derived `href`/`src`

✅ → [Phase 19](phases/phase-19.md) (19-J — Tiptap Link extension allowlists schemes, rejects `javascript:`/`data:`). Stored-XSS vector the HTML-body DOMPurify guard didn't cover (it sanitises bodies, not anchor hrefs).

## TI-8. Migrate `App.css` to CSS Modules

✅ Phase 14 (14-P, 2026-06-03). `App.css` deleted; `:root` tokens + `[data-theme]` blocks + a new `--space-*` scale → `styles/tokens.css`, reset/base → `styles/global.css`; every component owns a co-located `*.module.css`; `clsx` added. Shipped component-by-component (14-E…14-P) under the Vitest/RTL + E2E net. Same work as TI-14.

## TI-9. Upgrade GitHub Actions to Node.js 24

✅ 2026-06-04. Every action across `deploy.yml`/`eval.yml`/`pr.yml` bumped to its node24 major. Non-obvious floors: `upload-artifact` needs **v6+** (v5 still node20) and `aws-credentials` needs **v6**. The frontend **build** Node (`setup-node` `node-version`) stayed at 20 here — that's a separate decision, graduated later as TI-27.

## TI-10. Resolve ESLint warnings in `web/src/auth/AuthContext.tsx`

✅ PR #172, 2026-06-04. Split `AuthContext`/`useAuth` → `context.ts` (named `context.ts`, not `authContext.ts`, to dodge a case-collision on the case-insensitive `/mnt/c` FS) and `ToastContext`/`useToast` → `toastContext.ts`, restoring Fast Refresh; fixed the OAuth-exchange effect deps. No behaviour change.

## TI-11. Add `cdk synth` to the pre-commit hook

✅ 2026-06-10. `.githooks/pre-commit` runs `dotnet publish src/Api` + `cdk synth --quiet` — extended by TI-64 (below) to publish the Projector and TranscribeCompletion assets too — but **only when infra-affecting files are staged** (`src/Infrastructure/`, `src/Api/`, `*.sln`/`*.csproj`/`*.props`/`*.targets`, `cdk.json`) — docs/web/tests-only commits skip it. Uses the global `cdk` CLI, matching CI; no AWS creds needed.

## TI-12. Split the single API Lambda into individual Lambdas (CQRS + async projectors)

✅ → [Phase 27](phases/phase-27.md) (Stage 1 — CQRS write/read split + async projectors; 27-A…27-D). Stage 2 (per-context command Lambdas) and stream-replay rebuild stay out of scope. Full rationale in [ADR 0009](adr/0009-split-lambdas-cqrs-async-projectors.md).

## TI-13. Reduce Lambda SnapStart costs

✅ 2026-06-03. Cost is almost entirely **snapshot-cache storage** (`SnapStart-Cached-GB-S`, billed per GB of `MemorySize`), not restores/compute; version accumulation self-cleans (orphan snapshots expire after 14 days). SnapStart kept on (cold starts ~10–25/day, restores ~400–650 ms vs multi-second .NET cold init). The lever was memory: dropped `ApiFunction` 512→256 MB (~3× over peak). _Partly reversed by TI-36 (256→512 for cold-start CPU)._

## TI-14. Break down the monolithic `App.css` into a proper CSS architecture

✅ Phase 14 (14-P) — same work as **TI-8**; the 2,807-line global stylesheet is gone (token layer + base layer + per-component CSS Modules). Line-number references in old planning docs no longer apply.

## TI-15. Add a shared modal focus-trap utility and apply it across all dialogs

✅ 2026-06-10. `useFocusTrap(ref, { onClose })` (`web/src/hooks/useFocusTrap.ts`) — captures `activeElement`, focuses first focusable, cycles Tab/Shift+Tab within, restores focus on unmount. Applied to `MeetingPicker` + `SessionExpiredBanner`. Also supplies the shared utility [Phase 19-F](phases/phase-19.md) would otherwise have built.

## TI-16. Make the projection-rebuild endpoint robust (it 500s + partial-rebuilds under burst)

✅ → [Phase 24](phases/phase-24.md) (24-A/B/C). Was: delete-all-first + unbounded `Task.WhenAll` on a 5s client → a cold table throttled → 500 + silent partial rebuild. Fixed by bounded+retried writes, a longer admin-path timeout, upsert-and-reconcile (no delete-first window), and operability (per-projection summary, fault metric/alarm, overlapping-rebuild guard).

## TI-18. Rebuild emits delete tombstones for `NoteSearchView` (rebuild soft-deletes; live hard-deletes)

✅ Phase 24-B. Rebuild now matches the live hard-delete: excludes deleted notes from the upsert set **and** reconciles (enumerates the live table, diffs the `NoteId` set, deletes orphan tombstones). The 80 historical tombstones prune on the next rebuild.

## TI-19. Stabilise the flaky `TagsJourney` E2E (post-deploy gate fails intermittently)

✅ Re-resolved by **[BUG-22](phases/phase-bugs-archive.md#bug-22--multi-tag-add-drops-a-pill-under-ryw-2-async-reads--consistency-token-slot-overwritten-by-an-older-version)** (PR #262, deploy #551, 2026-06-13) — first first-try 20/20 E2E pass since the async cutover. Long arc: surfaced as a cold-start flake; misdiagnosed as latency (a 15→45 s timeout bump disproved it — a near-deterministic "element never appears" is a **missing render**, not slow latency); the real defect was a concurrent same-stream multi-tag **lost write** (BUG-14 → BUG-17 retry-on-conflict → BUG-22 token-max-version under RYW-2). Tag-pill assertions made reload-tolerant (`WaitVisibleWithReloadAsync`/`WaitHiddenWithReloadAsync`). The flake repeatedly red-gated unrelated docs/CI deploys, which is what proved it change-independent.

## TI-21. CI pipeline hygiene — skip no-op deploys, cancel superseded PR runs, cache Playwright

✅ 2026-06-10. (1) `tests/Analysis.Eval/**` → `deploy.yml` `paths-ignore` (eval harness never ships in the artifact; `eval.yml` still builds it). (2) Per-PR `concurrency` group on `pr.yml` (`cancel-in-progress`) — does **not** touch `deploy.yml` (deploys must never cancel). (3) `actions/cache@v5` on `~/.cache/ms-playwright`. **Rejected:** mirroring the eval `paths-ignore` into `pr.yml` — it would produce a near-empty check list the merge gate reads as false-green.

## TI-22. Skip backend publish + `cdk deploy` on frontend-only pushes

✅ 2026-06-11. `detect-changes` job (`dorny/paths-filter`) sets `backend=true` for `src/**`/`cdk.json`/`*.sln`; the publish + `cdk deploy` steps gate on it. Stack outputs now resolved via `aws cloudformation describe-stacks` (not the cdk `--outputs-file`) so they exist on both paths. **Deploy-time: −~5 min/pipeline on frontend-only slices, recurring, no standing cost.** Touches `deploy.yml` only — `pr.yml` stays full (avoids the false-green pitfall).

## TI-26. Zero-downtime deployments — frontend stale-chunk 404s; backend has no canary/rollback

✅ → [Phase 26](phases/phase-26.md). 26-A (frontend two-pass upload, no `--delete`, immutable hashed assets, entry-point-only invalidation, S3 lifecycle GC) + 26-B (`vite:preloadError` reload safety net) shipped. **26-C (backend CodeDeploy canary) shipped then reverted same-day** — ~5 min/deploy + serialised deploys, not worth the protection for a single-user app ([deploy-time-is-a-first-class-cost](learnings/deploy-time-is-a-first-class-cost.md)).

## TI-27. Frontend build Node 20 → 24 + regenerate lockfile (dep-audit T1)

✅ PR #237, deploy #528, 2026-06-11. `node-version 20→24` across `deploy.yml`/`pr.yml`; `@types/node ^20→^24`; lockfile regenerated on Node 24. Two traps ([node-24-build-upgrade](learnings/node-24-build-upgrade.md)): the lockfile/npm skew is **bidirectional** (regenerating on older-than-CI npm pruned `@emnapi/*` entries CI wanted → `npm ci` fail); `@types/node@24` dropped a transitive `lib` ref providing ES2022 `Array.at()` to the test typecheck (fixed by making `tsconfig.test.json`'s `lib` explicit).

## TI-28. ASP.NET 10 servicing + AWS SDK patch bumps (dep-audit T7)

✅ PR #241, deploy #530, 2026-06-11. 11 `.csproj`-only bumps, no source changes. Security driver: `JwtBearer 10.0.0→10.0.9` (exact-pinned, so it does **not** float with the SDK). The only *minor* bump (`Amazon.Lambda.AspNetCoreServer.Hosting`, the APIGW↔ASP.NET adapter) is exercised only by post-deploy smoke, not PR CI — confirmed live by deploy #530.

## TI-29. Vite 5 → 7 + Vitest 2 → 4 (dep-audit T2)

✅ PR #245, deploy #535, 2026-06-11. `vite ^5→^7`, `vitest ^2→^4`, `@vitejs/plugin-react ^4→^5`. **Held at Vite 7, not the now-GA Vite 8** (LTS-not-bleeding-edge). Test-only fallout: Vitest 4 builds mocks via `Reflect.construct` (arrow `mockImplementation`s for `new`-ed classes throw "not a constructor" → use `function`); `restoreAllMocks()` no longer clears `vi.mock`-factory call history (use `vi.clearAllMocks()` in `beforeEach`). Lesson: don't `prettier --write` whole files in a dep bump (churned ~800 lines; the hook doesn't enforce prettier).

## TI-30. React 18 → 19 (dep-audit T3)

✅ PR #246, deploy #536, 2026-06-11. `react`/`react-dom ^18.3.1→^19.2.7` + `@types/*`. **Zero code changes** — a pre-scan found no React-19 breaking patterns (`createRoot` already used; no string refs, `defaultProps`, `propTypes`, `findDOMNode`, legacy context). Bundle grew ~1005→1056 kB → deferred to the 19-I bundle-budget gate. Re-run `tsc -p tsconfig.test.json` after any `@types/*` major.

## TI-31. TypeScript 5.6 → 6.0 (dep-audit T4)

✅ PR #249, deploy #539, 2026-06-11. `typescript ^5.6→^6.0` + `typescript-eslint ^8.59→^8.61`. One migration: TS 6.0 makes `baseUrl` a deprecation **error** (TS5101) — **removed `baseUrl`** rather than silencing it (the `@/*` value is `./`-relative so it resolves identically). **⚠️ Do not re-add `baseUrl`.** Closed the 2026-06 dependency audit (T1/T7/T2/T3/T4 all done).

## TI-32. Prime the ASP.NET request pipeline before the SnapStart snapshot

✅ #260, deploy #552, 2026-06-13. The snapshot is taken before any request, so the **first** request to a restored env paid ~7 s of JIT/assembly-load/DI/routing/serializer warmup live (proven by a near-empty `tagindex` handler burning the same ~7 s). Fix: a `BeforeSnapshot` hook (`RegisterSnapStartPriming`, guarded on `AWS_LAMBDA_FUNCTION_NAME`) warms the DynamoDB health-check path + an STJ serialize into the snapshot. Cold p50 **7.92→4.82 s (−39%)** with the paired TI-35. Residual ~4.3 s CPU → TI-36. Pairs with TI-35.

## TI-35. ReadyToRun-publish the API Lambda (AOT-precompile to cut first-request JIT)

✅ #260, deploy #552, 2026-06-13. `<PublishReadyToRun>true</PublishReadyToRun>` gated on a RID (plain `dotnet build`/`test`/local `cdk synth` stay portable IL); deploy publish gains `-r linux-x64 --self-contained false` (framework-dependent on the managed runtime; the ubuntu runner is linux-x64, matching the x86_64 Lambda). Removes JIT of our assemblies + heavy NuGet deps that TI-32 priming can't reach. **Deploy-time: +~30–90 s per backend publish, recurring** — explicitly accepted. Projector left on IL (cold start not user-visible).

## TI-36. Raise API Lambda memory 256 → 512 MB to cut residual post-restore CPU time

✅ #270, deploy #562, 2026-06-13. After TI-32+TI-35, ~4.3 s of post-restore **CPU** remained on the 256 MB / ~0.145 vCPU budget (Lambda allocates vCPU proportional to memory). 512 MB → cold p50 **4.82→2.24 s**, warm 118→29 ms. End-to-end across the trio: **7.92→2.24 s (−72%)**. Cost: the bill is almost all SnapStart cache (per-GB), so 512 MB ~doubles it to ~$16.8/mo — driven by **deploy frequency**, falls as dev slows. Deploys drive cost, not cold-start *frequency* (14 deploys vs 59 cold starts/24 h). 1024 MB (~1.5 s) available if ever worth +~$17/mo.

## TI-37. Capture all frontend errors in RUM — failed resource loads are invisible

✅ PR #268, deploy #557, 2026-06-13. A failed `<img>`/`<script>`/`<link>` load fires a resource-level `error` event, not a JS exception or fetch/XHR — so RUM's `errors`/`http`/`performance` telemetry all missed it (and these go S3→CloudFront direct, bypassing the API logs → invisible end-to-end). Fix: a capture-phase `window` error listener (`installResourceErrorHandler`) forwards them via `cwr('recordError')` (rides `JsErrorCount`); real JS errors skipped to avoid double-count. Visibility only — does **not** fix the underlying image 403 (BUG-19/BUG-24).

## TI-38. Expected 409/404 outcomes are logged at `Error`, drowning real 500s on the dashboard

✅ PR #267, deploy #556, 2026-06-13. `app.UseExceptionHandler` registers ASP.NET's `ExceptionHandlerMiddleware`, which logged every caught exception at **Error** *before* our handler re-mapped it to 409/404 at Warning → every mapped exception double-logged. Fix: replaced it with a try/catch middleware that maps every exception itself and writes the response, removing the framework middleware from the pipeline — exactly one log line per request at the `Map()`-implied level.

## TI-39. Stabilise the chronic cold-start E2E flakiness that red-gates nearly every deploy

✅ 2026-06-13. Was **four stacked causes**, not one (the BUG-26 umbrella): projector cold-lag → a warm-up that **drains the projector to head** before the suite + a 15 s global Expect timeout + reload-tolerant asserts **and actions**; plus two real bugs found en route — [BUG-27](phases/phase-bugs.md) (lost-write contention → retriable 503) and [BUG-29](phases/phase-bugs.md) (projector image-purge IAM). Residual concurrent-multi-tag race carved out as [BUG-28]. A later **5th** cause (action-add existence check on the async `NoteDetail` projection) fixed in `fab63aa`; residual cards-list flake → TI-42. Write-up: [deploy-gate-deflake-stacked-causes](learnings/deploy-gate-deflake-stacked-causes.md). Get **per-attempt** failure data before inferring another fix — a flaky gate is often several stacked causes.

## TI-41. Fold the `GetActions` cross-stream re-poll into `ConsistencyGate` (existence wait)

✅ #289, deploy #589, 2026-06-15 (Option B). `GetActions` had a hand-rolled `Task.Delay(100)×10` loop *beside* the gate: the gate waits on the **action** stream's position but ownership reads the **note** `NoteDetail` projection (a different stream — DynamoDB Streams give no cross-key order), so the action can fold before the note → spurious 404. Added `IConsistencyGate.WaitForPresenceAsync<T>` (bounded presence-poll sharing the version wait's interval/cap/delay/logging) and replaced the loop — now virtual-time-testable and observable. Rejected: a multi-position token (write path doesn't know the note version) and denormalising the owner into the action projection (costs an event version + rebuild).

## TI-42. Residual cold-start E2E flake — `NoteReadYourWritesJourney.Renamed_note_appears_in_the_cards_list` (~1/10)

✅ PR #390, deploy #694 (2026-07-01); **confirmed closed 2026-08-09**. Took **three** diagnoses to land, and the first two were wrong in instructive ways.

1. **"Workspace context on reload" — wrong.** Every failed read was correctly `/w/__default__/`. Hypothesis formed with no failing-run evidence; the per-run data clear had destroyed it.
2. **"Ungated read racing the projector" — right, and fixed.** The helper's comment claimed the post-reload `GET /notes/cards` re-gated on the sessionStorage RYW token, but `gatedRead` clears the token on the first fresh read and the pre-reload home fetch consumed it → the read went out **ungated**, `200`/empty for the full 30 s. Compounding: the 2.5 s per-attempt timeout was **below** the 8 s server gate cap, so a reload aborted even a gated read mid-converge. Fix (test-only): a Playwright route re-injects the captured note-write token as `If-Consistent-With` on every cards read; per-attempt timeout raised to 9 s; per-read `X-Consistency` logged so any residual is **provable, not guessed**.
3. **The residual was never this item.** Two hits followed the fix — #703 (`NoteDeleteJourney`) and #714 (`FilterBackNavigationJourney`). The diagnostic added in (2) is what settled it: every cards read was **gated and fresh**, so the gate worked; `page.Url` was the **note-detail route**, so `cards(0)=[]` was an *absent* list, not a lagging one. A **navigation** defect — `SaveAndReturnAsync` returned on the Sidebar-mounted `new-note-button`, visible on every route, so it could return while still on the note screen. Closed by [BUG-38] #418 (await the URL leaving `/notes/`) + [BUG-61] #425. Deploy **#720 is #418's own sha** and both hits predate it; **21 consecutive clean deploys #720–#740**, counted per-attempt with `scripts/flake-watch.sh 695` (38/40 across the whole window).

**Lessons.** (a) A diagnostic that records *why* a read succeeded (`X-Consistency`) is what let the next failure be attributed to a different subsystem instead of re-blaming this one. (b) `X-Consistency=none/fresh` reads as "no header" — the server sets it **only** on a stale read, so absent means fresh; easy to misread as "no token was sent." (c) Its first cut read the response **body** in a fire-and-forget handler and hung the suite **44 min** (deploy #592) — record only synchronous request/response properties, never the body ([TI-43] capped the class).

**Follow-up (still latent):** the sibling ungated-reload cards helpers `WaitVisibleWithReloadAsync` (backs `ClickNoteInListAsync`) and `AssertCardTagVisibleAfterReloadAsync` keep the identical 2.5 s-cap, no-re-gate shape — generalise the re-gate if they surface.

## TI-44. Close BUG-31 layer 3 — note-detail read stays `loadingDetail` ~30 s after reopen+edit

✅ 2026-08-09 — **the item's own hypothesis was wrong; the symptom is closed.** Raised 2026-06-17 as "a stuck gated note-detail read leaves `save-button` `disabled={loadingDetail}` for 30 s — and a real UX cliff in prod." Neither held. The real cause: the journey's note held **only** the image, so removing it left content empty and `NoteView` renders `cancel-button` instead of `save-button` **by design** (the blank-note case `NoteView.test.tsx` covers), so `SaveAndReturnAsync`'s click never resolved. Fixed in [BUG-31](phases/phase-bugs.md) (PR #397, deploy #701) by giving the note durable body text so `hasContent` stays true — a **deterministic** fix, not a timing one. Journey un-quarantined and **6/6 clean** (#701–#706). The genuinely-racy residual (a stale gated refetch blanking an existing note) was carved out as [BUG-48] and fixed in #436. Lesson: a "slow read" diagnosis inferred from a click timeout was really a **conditional render** — check what the element *is* before assuming why it is slow.

## TI-43. Hard per-test E2E timeout so no single test can hang the deploy gate

✅ PR #293, deploy #595, 2026-06-17. `E2EFactAttribute : FactAttribute { Timeout = 120_000 }` across all journeys — caps the 44-min-hang class (PR #291's body-reading diagnostic). **120 s** chosen: reload-tolerant helpers allow 30 s each and Tags journeys chain 2–3 → ~90 s legit worst case. **Verified it fires** — xUnit's `Timeout` is silently ignored when parallelization is disabled; confirmed with a throwaway probe (load-bearing precondition: no `xunit.runner.json`, no `DisableTestParallelization`).

## TI-64. Pre-commit `cdk synth` fails in every fresh worktree — only `src/Api` is published

✅ PR #457, 2026-08-10. The first commit in every new slice died several minutes in — **after** the whole test suite had already run — with `Cannot find asset at …/src/Projector/…/publish`, and read as "my change broke CDK" rather than "this worktree was never fully published". The hook published only `src/Api`; the stack has packaged three Lambda assets since 27-B (Projector) and 33-B1 (TranscribeCompletion). `.githooks/pre-commit` now publishes the other two **when their artefact is absent** — `cdk synth` fingerprints an asset directory but never validates its contents, so a fresh worktree pays ~48 s once and every later commit pays two `test -f` calls. `cdk synth` still always runs; nothing is skipped. `CLAUDE.md` (`## How to run`, `## Worktrees`) and `README.md` shipped in the same merge, because all three still prescribed publishing only `src/Api` — a manual `cdk synth`/`cdk deploy` from a clone hit the identical error with no hook involved. **Verified by running the hook, not by reading it:** red before the change, green after in a second zero-artefact worktree, and still red with a defect injected into the stack's asset path. `pr.yml` paths-ignores `.githooks/**`, so that demonstration is the only evidence — CI covered none of it. Learnings: [ti-64-the-workaround-that-outlived-its-bug](learnings/ti-64-the-workaround-that-outlived-its-bug.md).

## TI-67. Every `recordRumEvent` call in the app was inert — no browser fault ever reached CloudWatch

✅ PR #458, deploy #760, 2026-08-11. When something broke in a user's browser — a dead note link, a failed pinned-tab restore, a 404'd editor chunk, a blocked sign-in — nobody found out. **10 event types across 16 call sites had never emitted once**, across six slices, while looking exactly like telemetry with no traffic. Absence of complaints was the symptom, not the evidence.

**Two independent gates, both closed — either one alone kept every event inert.** (1) *Server side:* CloudWatch RUM drops custom events unless enabled on the app monitor; AWS defaults that to `DISABLED` and `CustomEvents` appeared nowhere in the CDK. (2) *Client side:* `recordRumEvent` called `cwr("recordEvent", type, data)` with three positional args, but the deployed 3.x client installs the global as `(c, p) => push({c, p})` — **arity two**. The third argument was dropped, `recordEvent` got the bare `type` string, its guard threw `IncorrectParametersException`, and the BUG-74 `try/catch` swallowed it. `recordError` was never affected (genuinely one payload), which is why JS-error telemetry always landed and masked the gap.

**The second gate is the whole lesson: the item's own prescribed fix would not have worked.** TI-67 was written up as "add `CustomEvents = ENABLED` to the CDK". Shipping only that would have closed one gate, left the other shut, and produced a signal that *looks* fixed — monitor reports `ENABLED`, row gets closed, still nothing arrives. Worse than the original bug, because nobody would have had reason to look again. The client half surfaced only because Hawk reviewed the PR against the **shipped artefact** rather than the write-up.

**Fix:** `CustomEvents.Status = ENABLED` on `CfnAppMonitorProps` (in-place update — `createOnlyProperties` is `[Name, Platform]`, so the monitor `Id` the injected snippet and log-group name derive from survives); `cwr()?.("recordEvent", { type, data })` in `web/src/rum.ts`; two `Infrastructure.Assertions` cases (default + domain-scoped template, since prod is the domain-scoped stack); and `web/src/__tests__/recordRumEvent.test.ts`, which replays the deployed client's own parameter guard so a wrong-arity call fails the test instead of vanishing — mutation-tested across nine variants with zero false greens.

**Verified by observation, not by proxy.** Baseline first: a 90-day Logs Insights query over the RUM log group (5 285 records) returned *only* built-in `com.amazon.rum.*` types — zero custom types ever, with `js_error_event = 2` corroborating that only `recordEvent` was broken. Then, after deploy #760 (`backend=true`, `deploy-production` confirmed executed) and `get-app-monitor` showing `"CustomEvents": {"Status": "ENABLED"}`, the deployed site was driven headlessly to make the shipped bundle emit for real: `authStorageBlocked` at `signIn`, which returns before redirecting so it needs no credentials. Two data-plane POSTs returned 200 and the event was **read back** — `event_type: authStorageBlocked`, `event_id: 3d732878-34c0-4ac0-ae92-66f6a193fe72`, 08:26:28Z. First custom event in the log group's history. Steps 1 and 2 both passed while the property was still unproven, which is exactly why step 3 was not optional.

**Follow-up:** [TI-78] — the injected snippet never sets `sessionEventLimit`, so the client default of 200 applies and custom events are dropped silently late in a long session.

## TI-71. A PR goes red with 26 failed tests that never ran, on a Docker Hub rate limit rather than anything in the diff

✅ PR #462, commit `7866992c`, 2026-08-11. The `eventstore` check failed 26 of 37 with `Docker.DotNet.DockerImageNotFoundException: No such image: amazon/dynamodb-local:1.21.0` on a PR that changed only a workflow file and a docs row. Every occurrence was a false red, a blocked merge gate and a re-run — and the message actively misled, naming an image tag that was fine.

**Why:** Testcontainers reports a pull that never landed as an image that does not exist. Docker Hub's anonymous pull limit is what a GitHub runner keeps tripping (shared egress IPs), and the failure is at *fixture* level, so one throttled pull surfaces as 26 independent test failures.

**Fix:** pull AWS's own ECR Public copy instead — `public.ecr.aws/aws-dynamodb-local/aws-dynamodb-local:1.21.0`, an identical artefact (the 1.21.0 manifest digests match Docker Hub's byte for byte). Named in one place per side: `DynamoDbLocalImage.DefaultReference` for local runs, `DYNAMODB_LOCAL_IMAGE` in `pr.yml` so CI's pre-pull step and the tests cannot name different images. That pre-pull is load-bearing rather than an optimisation: each test class owns its own container and xUnit starts them in parallel, and ECR Public allows one anonymous pull per second per IP, so a concurrent burst is throttled even from a healthy registry.

**Worth noting for the next item:** this row sat `🔲 Open` in the live doc after it had shipped. A backlog that lists finished work inflates itself and invites someone to redo it — the misleading-living-doc failure the human has asked to be prioritised. The fix was real; the *closing* was the part nobody checked.

## TI-77. `merge-gate.sh` reports uncomputed mergeability as a conflict

✅ PR #463, merged 2026-08-11 (`69d643c4`), deploy #762 green. Verified live on main immediately after: `deploy-status.sh` reported `IN PROGRESS (#762 status=in_progress)` then `GREEN (#763) — safe to merge`, both from the rewritten branches, and `merge-gate.sh` gated the merge itself. The merge gate said `BLOCKED — rebase/resolve conflicts` on a branch that was perfectly clean, so the next move was a pointless rebase — or blaming whoever wrote the branch for a conflict that never existed. Hit on PR #460, moments after two merges landed on main.

**Why:** GitHub computes mergeability on demand and answers `UNKNOWN`/`UNKNOWN` while it is still working — routine for up to a minute after main moves, and neither a conflict nor an error. The gate read it once and treated every value other than `MERGEABLE`/`CLEAN` as a conflict, printing a fixed remedy. Re-polling #460 returned `MERGEABLE`/`CLEAN` three times out of three.

**Fix:** re-poll (5 × 2s, exiting on the first definite answer, so a settled PR still costs one call), then report the condition actually established. `CONFLICTING` keeps the rebase advice exclusively; still-`UNKNOWN` says it is not yet computed and names no cause; `UNSTABLE`/`BEHIND`/`DRAFT` each say what they are; a failing `gh` says *that* instead of arriving as two empty strings. `deploy-status.sh` carried the same shape and was fixed with it — a `cancelled` run (3 of the last 200 main deploys; the busy `deploy` concurrency group cancels rather than queues) and the pre-run statuses `waiting`/`requested`/`pending` all said `fix main first`, blaming main for a run that was superseded or had not started.

**The general rule this item is the exemplar of: a check must report what it observed, never a cause it has not established.** A plausible, actionable, wrong remedy sends the investigation to the accused instead of the instrument. Two more instances were found *inside the fix itself* during review, which is how routine the shape is.

**Three things worth keeping:**

1. **`scripts/test-merge-gate.sh` exists because `pr.yml` paths-ignores `scripts/**`** — CI had never once exercised these scripts, so every past edit shipped unverified and a green PR proved nothing. Now wired into `docs-check.yml`, the workflow that exists for exactly the paths `pr.yml` ignores. 23 stub-driven cases, ~16s, no network.
2. **It paid for itself on its first CI run**, catching a defect no local run could see: `merge-gate.sh` executed `deploy-status.sh` directly, but `scripts/` is committed `100644`, so gate 3 died with `Permission denied` on any Linux checkout — invisible on the author's drvfs mount, where every file reports executable.
3. **Injecting the defect is what found the tests that were not testing anything.** Two assertions passed with the fix reverted — the gate-3 stand-in was unreachable because `deploy-status.sh`'s own guards always print something, and both gate-3 cases asserted on output while discarding the exit code, so `fail=1` → `true` left the suite green while the gate printed `safe to merge` on a broken main. Neither would have been found by reading a green.

## TI-73. The pre-commit gate is unbounded across sessions

✅ **Closed 2026-08-11 — obsolete, not fixed.** Committing while another session was also
committing could fail your commit on tests you never touched, because the pre-commit gate
ran the full suite with no idea anything else was running. The hook was removed entirely on
2026-08-11 (build and test moved to CI), so there is no longer a gate to contend for. The
proposed fix — make the hook wait on a load gate — was never built, and its stated direction
was wrong anyway: `load1` was measured reading 0.28 with three suites live, because it lags
about 90 seconds. Had it been built, it would have waved commits straight into a saturated
box. Counting runner processes is the sound instrument; load average is corroboration only.


## TI-81. An orphaned run record blocks the merge gate for tens of minutes

✅ PR [#469](https://github.com/simonkirkham/ai-note-taker/pull/469), merged 2026-08-13 (`4727672f`), Hawk approved at round 5. Nobody could merge anything for the best part of an hour: the check that answers "is it safe to merge?" reported a deploy still running that had actually finished successfully 51 minutes earlier. It clears on its own, so the cost was a long false red on the one gate every session has to pass — and the workarounds it invites, merging past the gate or cancelling a run that succeeded, are both worse than the wait.

**Why:** GitHub stopped updating the run's own record while its jobs carried on and finished. On deploy #762 all five jobs were `completed`+`success` (`deploy-production` at 14:25:21Z) while the run still read `in_progress`, its `updated_at` frozen at 14:24:22Z — 59 seconds *before* its last job finished. The gate enforces quiescence across the last 5 runs, which is load-bearing and stays (a `completed` run can be re-run, flipping back to `in_progress`), and a stalled record satisfies "still running" for as long as it stays stalled.

**Fix:** an allow-list of the two states that mean safe, instead of a list of the ways a run can be unsafe. (1) `status == completed` and `conclusion == success`; or (2) a **known** not-finished status where the jobs response is complete, every job is `completed`+`success`, `pending_deployments` is empty, and **both** `updated_at` and the newest job completion are older than 10 minutes. Everything else blocks and prints the raw values it saw. A genuinely failed job is reported `NOT SAFE` naming the job, never discounted; `cancelled`/`action_required` block without a failure verdict, since the busy `deploy` concurrency group cancels rather than queues. The discount is printed on the verdict line, never silent.

**The form is the lesson, not the fix.** Six separate clauses of the condition moved rather than closed while it was being written — a job count; pending environment approvals; job conclusions (where "terminal" silently admits `failure`, which would have reported GREEN on a run whose `deploy-production` failed); the run status, never inspected, so a **suspended** run printed `GREEN — safe to merge`; jobs-API pagination, page 1 read as the whole set; and the staleness clock, keyed on the one field the incident proved unreliable. One shape six times: a value absent, unexamined, or admitting more than its name suggests. Enumerating the unsafe states means anticipating everything that can go wrong, and that enumeration failed six times in a day; an allow-list fails **closed** on anything unanticipated, which is the property a merge gate wants. Four of the six were caught by review or by injecting a defect — **none** by reading the code and believing it.

**Evidence, because `pr.yml` paths-ignores `scripts/**` and a green PR proves nothing here:** `scripts/test-merge-gate.sh` at **54 cases** (31 added here; `main` had 23, 0 removed), run by name from `docs-check.yml` since [TI-77], plus **fifteen injected defects**, each flipping only the cases that claim it. Three of those injections exist because review found guards that were shipping untested — and in each round the defects were in code the *previous* round had just added, so re-run every injection after every change and never carry one forward as evidence.

**Two limits worth carrying forward:** the second clock is belt-and-braces, not an independent guard — GitHub carries a re-run's already-successful jobs into the new attempt with their **original** `completed_at`, so on a re-run `updated_at` is doing the work alone. And `filter=latest` on the jobs call is load-bearing: `filter=all` returns every *attempt*, and a superseded attempt's failed job records arrive as if current, reporting a re-run that passed as `did not succeed`.

**Learnings:** [ti-81-orphaned-deploy-run](learnings/ti-81-orphaned-deploy-run.md) — the discriminator between orphaned and slow-but-alive had to be measured (job records are created at **eligibility**, not dispatch, so the no-record window is ~0s); "all jobs terminal" admits `failure`, and injecting exactly that reported a **failed** deploy as safe to merge; four permissive-direction injections went red, three flipping exit 0→1; and a `min()` tidy-up that would turn a run which never reported a completion into a green, pinned by a test. Follow-up [TI-89](technical-improvements.md#ti-89-the-merge-gates-self-test-blames-the-merge-gate-when-the-machines-date-command-is-the-problem).

**Same shape as TI-88** (a merge waved through as safe and refused seconds later): a gate reporting a state that was true a moment ago and is not true now. TI-81 was a stale run record, TI-88 a stale mergeability flag — different gates, different scripts, one shape. The shape is the reusable part; see [technical-improvements.md](technical-improvements.md#ti-88-a-gate-verdict-has-an-expiry-and-the-window-between-reading-it-and-acting-on-it-is-where-it-fails).

## TI-86. Nothing could be merged: every pull request's build failed on a security advisory in a package no code here calls

✅ **Done** — raised and fixed 2026-08-13 (PR [#476](https://github.com/simonkirkham/ai-note-taker/pull/476), deploy #770), same day, in ~40 minutes.

**What it cost:** every pull request in the repo that runs a .NET build went red and could not merge — including [CHANGE-41], a frontend-only change that touches no .NET at all. It surfaced as an unexplained `backend` failure on a PR whose author had no reason to look at NuGet.

**Why:** GitHub published GHSA-q939-rpr3-3284 against **SSH.NET 2025.1.0** (high — a malicious SCP server can write arbitrary files during a recursive download). It arrives transitively via `Testcontainers.DynamoDb`, and `NuGetAudit` + `TreatWarningsAsErrors` promotes it to **NU1903**, which fails `dotnet build ai-note-taker.sln`. Nothing in this repo calls SSH.NET; the dependency exists only because Testcontainers ships an SSH transport.

**Fix:** a direct `PackageReference` to **SSH.NET 2026.0.0** in `tests/EventStore.Integration`. `Testcontainers` 4.12.0 and 4.13.0 both still pin 2025.1.0 — checked against their published nuspecs — so upgrading it does not help, and a direct reference is the only way to lift a transitive version. The line carries a comment to delete it once Testcontainers ships the patch itself.

**The generalisable part:** a **dated, external** trigger can turn a repo red with no commit behind it, and it lands on whichever PR happens to run next — so the first person to see it has no reason to suspect their own change. Read the failing step rather than the failing job name; `NU1903` names the package, and the package named a library the diff had never heard of.

**Two flakes were separated from it in the same session, not folded in:** an unretried Electron download that dropped a connection ([TI-87], open), and a merge gate that reported CLEAN three seconds before the merge was refused ([TI-88], open, another session's reading).

## TI-84. A momentary GitHub outage paints a red X on a `main` commit that did nothing wrong

✅ **Done** — raised 2026-08-12 (Hawk, PR [#471](https://github.com/simonkirkham/ai-note-taker/pull/471) / [TI-80], should-fix), fixed 2026-08-12 (PR [#474](https://github.com/simonkirkham/ai-note-taker/pull/474), squash `608c882e`).

**What it cost:** a red X on a `main` commit that was fine, put there by a network blip rather than by anything in the change. That is the worst possible signal in this repo — a red X that means nothing trains everyone to stop reading them, and [TI-69] already produced 162 of them with a real failure hiding among them. The guard against false red X's had acquired a false-red-X failure mode of its own.

**Why:** `scripts/lint-workflows.sh` downloaded actionlint with a single `curl` attempt and no `--retry`, and every CI run re-fetched it from GitHub releases. One transient response exited 1 via the script's own `download failed` path. Confined to pull requests until [TI-80] added the push trigger; after that it landed on `main`.

**Fix:** the fetch retries, and the retry is **bounded** — `--retry-max-time` plus a per-attempt `--max-time`, so a rate-limited runner still fails as a clean, attributable red inside the job's 5-minute budget rather than being killed as an unexplained job timeout. `--retry-all-errors` covers resets, TLS failures and DNS misses, which plain `--retry` does not; the checksum sits outside the retry and is untouched, so retries cannot launder bad bytes.

**The `actions/cache` half of the prescription was measured and rejected.** The whole script is 2.09s cold; a cache restore is a service round-trip plus a tar extract, routinely 1–3s — at best break-even, and it substitutes one network dependency for another. Worse, a corrupt restored binary hits the `tampered` path, which exits 1 by design and deliberately does not re-download, so a transient becomes a red X that stays red until a human busts the key.

**The generalisable part:** *a timeout you compute from your own flags is a hypothesis; only a flag that refuses makes it a bound.* The first version's retry made the symptom worse — 360.3s and exit 0 against a server sending `Retry-After: 120`, past the job's timeout — and review caught it by measuring rather than reasoning. Full account in [ti-84-bounded-retry](learnings/ti-84-bounded-retry.md).

**Not done, deliberately:** a permanent hermetic self-test of the retry (the [TI-77] `scripts/test-merge-gate.sh` precedent). Stubbing the pinned checksums as well as the download is a larger surface than the one line it guards, plus a step on every push to `main`. File it as its own row if wanted.

**Still open, same class:** [TI-87] — an unretried Electron download that drops a connection and reds a pull request.

## TI-83. Why subtraction beat keeping two lists in step

✅ **Done** — raised 2026-08-11 (Hawk, PR [#471](https://github.com/simonkirkham/ai-note-taker/pull/471) / [TI-80], should-fix), fixed 2026-08-13 (PR [#477](https://github.com/simonkirkham/ai-note-taker/pull/477), squash `4fbf7286`).

**What it would have cost:** a bug filed away as fixed while its row still sits in the open list — half-closed, with nothing saying so. `scripts/check-doc-ids.sh` reads `docs/phases/phase-bugs-archive.md` for two of its checks (duplicate `## BUG-N` entries; a bug living in *both* the live doc and the archive), and that file was in **neither** of `docs-check.yml`'s two `paths:` filters. A commit touching only the archive therefore matched neither trigger and ran no check at all — and archive-only is exactly the shape of a half-done close. Archiving is a Scribe step that commits straight to `main`, the route with no other guard.

**Latent, not observed.** All **11** commits that have ever touched the archive on `main` also touched `phase-bugs.md`, which was already in the `pull_request` list, so every one of them matched; and the `push:` trigger did not exist until `14c6c034` (2026-08-12, [TI-80]), after the newest of them (`bb4c5611`, 2026-08-11). A hole, not a miss.

**Fix — subtraction, not a checker.** The `paths:` list is deleted from the **push** trigger; `pull_request` keeps its list and gains the archive path. The list never scoped what got *checked* — actionlint lints every workflow and `check-doc-ids.sh` greps every tracking doc whatever a commit touched — it only decided whether the check *ran*, which made it pure drift surface with no upside. Deleting it closes every future instance rather than the one found. Cost: deploy wall clock unchanged (these jobs do not gate `deploy.yml`), `doc-ids` 19–23s and `workflows` 5–10s in parallel, £0 recurring (public repo, free standard-runner minutes).

**The asymmetry is why the fix is one-sided.** Drift on the `pull_request` list is loud — a check visibly stops appearing on PRs. Drift on the `push` list is silent, and the push route is the one with no other guard. So the push list went and the PR list stayed.

**Evidence:** `proof/ti83-paths` commit `1cf9468d` changed only the archive and added a duplicate `## BUG-1`, and produced **no run at all**; that branch's only run is [`31623178252`](https://github.com/simonkirkham/ai-note-taker/actions/runs/31623178252), on its parent. The branch is deleted, so the run id is the durable record.

**Still unobserved on merge, deliberately recorded as such:** a push to `main` firing this workflow with **no** `paths:` at all. Both the proof run and the merge commit touch files that were in the old list, so neither proves it. Confirm on the next push to `main` whose files all fall outside that list (`gh run list --workflow docs-check.yml --event push --branch main --limit 5 --json headSha,createdAt,conclusion`); an absent sha means the trigger did not fire. Full account in [ti-83-subtraction-over-drift](learnings/ti-83-subtraction-over-drift.md).

**Since observed — the paragraph above is superseded. First observed firing 2026-08-13:** sha `b12dc532`, run [`31685095607`](https://github.com/simonkirkham/ai-note-taker/actions/runs/31685095607), both jobs green (`workflows`, `doc-ids`). That commit touched **only** `docs/learnings/a-mechanism-nobody-has-watched-work-is-not-working.md` — a path the old `paths:` list did not cover, so it could not have run under the old filter. **Limit, in the same breath:** this proves the removal is not inert and that one previously-uncovered path is now covered; it does not prove every one is. The general claim still rests on reading the file (no `paths:` key at all), not on observed behaviour.

**Second observation, 2026-08-13 — the named hole itself:** sha `917d7361`, run [`31685381389`](https://github.com/simonkirkham/ai-note-taker/actions/runs/31685381389), both jobs green. That commit touched **only** `docs/technical-improvements-archive.md` — an **archive-only** commit, the exact shape this row named as the latent hole, and it would have run nothing under the old `paths:` list. Stronger than the first arm, which landed on a path nobody had claimed was at risk; this one demonstrates the hole closed on the path the row was written about, rather than inferring it from the absence of a `paths:` key. **The limit above is unchanged:** two previously-uncovered paths are now observed covered — not all of them.

**Depends on:** [TI-84] (PR #474, `608c882e`) — the unretried actionlint download, landed first so more runs on `main` could not mean more false red X's.
