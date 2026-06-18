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

✅ 2026-06-10. `.githooks/pre-commit` runs `dotnet publish src/Api` + `cdk synth --quiet`, but **only when infra-affecting files are staged** (`src/Infrastructure/`, `src/Api/`, `*.sln`/`*.csproj`/`*.props`/`*.targets`, `cdk.json`) — docs/web/tests-only commits skip it. Uses the global `cdk` CLI, matching CI; no AWS creds needed.

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

✅ Re-resolved by **[BUG-22](phases/phase-bugs.md#bug-22--multi-tag-add-drops-a-pill-under-ryw-2-async-reads--consistency-token-slot-overwritten-by-an-older-version)** (PR #262, deploy #551, 2026-06-13) — first first-try 20/20 E2E pass since the async cutover. Long arc: surfaced as a cold-start flake; misdiagnosed as latency (a 15→45 s timeout bump disproved it — a near-deterministic "element never appears" is a **missing render**, not slow latency); the real defect was a concurrent same-stream multi-tag **lost write** (BUG-14 → BUG-17 retry-on-conflict → BUG-22 token-max-version under RYW-2). Tag-pill assertions made reload-tolerant (`WaitVisibleWithReloadAsync`/`WaitHiddenWithReloadAsync`). The flake repeatedly red-gated unrelated docs/CI deploys, which is what proved it change-independent.

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

## TI-43. Hard per-test E2E timeout so no single test can hang the deploy gate

✅ PR #293, deploy #595, 2026-06-17. `E2EFactAttribute : FactAttribute { Timeout = 120_000 }` across all journeys — caps the 44-min-hang class (PR #291's body-reading diagnostic). **120 s** chosen: reload-tolerant helpers allow 30 s each and Tags journeys chain 2–3 → ~90 s legit worst case. **Verified it fires** — xUnit's `Timeout` is silently ignored when parallelization is disabled; confirmed with a throwaway probe (load-bearing precondition: no `xunit.runner.json`, no `DisableTestParallelization`).
