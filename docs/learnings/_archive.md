# Learnings archive

Collapsed from ~108 per-slice learning docs. Terse, deduplicated, grouped by theme. Each lesson is transferable; project-narration removed. Slice IDs in parentheses point back to the original doc if deeper context is needed.

## Event sourcing & domain

- Aggregates stay pure: no IDs, no clock, no DB — pass `Guid`/timestamp in from the application layer. (1a)
- Distinguish client error from idempotent no-op: throw for invalid transitions (duplicate add), return empty for already-in-target-state. (5a, 5e–l)
- Use an aggregate guard predicate (`!Exists`, `_deleted`) to gate operability — never infer "never created" vs "created then deleted" from stream length. (2d, 3e, bug-4-5)
- Collection-bearing events need a structural `Equals`/`GetHashCode` override — compiler-generated records compare lists by reference. Apply from the first keystroke on that shape. (10i, 10k)
- Every no-op/provenance event still needs deserialiser registration — `EventDeserializer` throws on unknown types. (10i)
- Event ordering across separate handler calls is guaranteed by call order; assert via `SequenceNumber`, not mere presence. (10i)
- Cross-aggregate writes delegate through the owning command handler — never bypass it (preserves `LastModifiedAt` + projection sync). (4e, 5e–l, 9d)
- Every modifying event must update `LastModifiedAt` — easy to miss in three lockstep sites (projection record, DynamoDB store, handler helper). Checklist each new event. (4a, 4e, 5a)

### Event versioning

- Route on `(EventType, EventVersion)` tuple pattern; wildcard arm for unversioned events. (2c)
- Versioning needs three tests: v1 back-compat, v2 forward, explicit type assertion — STJ silently ignores unknown fields, so the assertion is the only catch. (2c)
- When versioning a previously-unversioned event: narrow the `_` arm to explicit `(type, 1)` AND add `(type, 2)`; first confirm every historical write used `InitialEventVersion = 1` or the narrowed v1 arm throws on old events. (10m)
- The aggregate's `Apply` must handle every historical version, even ones it never emits. (2c)
- Don't abstract `ToEnvelopes` until the fourth versioned event lands; inline `switch` for three. (10m)

## DynamoDB & event store

- `ReadAsync` must loop on `LastEvaluatedKey` for streams > 1 MB — silent truncation is a bug. (1b)
- Reads use `ConsistentRead = true` (except GSI queries); eventual consistency is only acceptable for projection reads, and E2E races expose the gap. (5c, 6.5c)
- `Limit` applies *before* `FilterExpression` — a filtered scan must paginate, never `Limit = 1`. (minor-13; mirrors the Google Calendar `Instances` gotcha)
- String sets (SS) cannot store empty — write only when `Count > 0`, read absent as empty, coalesce to `[]` in JSON. (5a)
- Empty strings store as `{NULL: true}`; guard `S` attributes with `string.IsNullOrEmpty()`. (6.5c)
- Counter projections want atomic `ADD`, not read-modify-write (atomic, initialises from zero). (10j)
- Composite-key batch deletes need both PK+SK in `DeleteRequest.Key`; ensure `ProjectionExpression` returns both. (3e, 5c)
- `begins_with(SK, :v)` excludes META rows without special logic — pays off the SK design. (2e)
- `BatchWriteItem` can return `UnprocessedItems` under throttling with no retry — fine for learning scale, production needs a retry loop. (2e)
- CDK DynamoDB `Attribute` collides with `System.Attribute` under ImplicitUsings — fully-qualify it. (1b)
- Keep local-dev tables/env (`docker/init-tables.sh`, `launchSettings.json`) in sync with CDK on every table addition. (2b, 5c)

## Projections

- Update projections **inline in the command handler** — the `IDomainEventDispatcher`/`IDomainEventHandler` seam is dead code, deleted. Wire a new projection inline + in `ProjectionRebuildHandler`, never as an event-handler class. (10j, 17a)
- A projection is rebuildable only if wired in BOTH the inline write path AND `ProjectionRebuildHandler` — single-side wiring is a silent gap. (17a)
- Live path and rebuild path duplicate classification rules — keep in lockstep via a rebuild-parity test. (10j, 10l)
- Cross-stream events break single-pass rebuild: accumulate in `Handle`, compute in `GetAggregates()` (order-independent); or sort by `OccurredAt`. (10l)
- With an early-return fast path in a handler, verify each projection update sits on the correct side of it — order-dependent bugs stay dormant until a rebuild. (10j)
- Rebuild = clear stores, replay all events through in-memory projections (which apply deletes), upsert survivors. (2e)
- Read-modify-write for cross-aggregate projection deltas avoids re-fold cost but must stay in sync with fold logic. (4e)
- Rebuild runs via an admin endpoint, not automatically on deploy — existing rows backfill after POST; widen positional records defensively (`TryGetValue` + fallback) for pre-rebuild rows. (17a)
- Prefer widening a projection schema + rebuild over event versioning when the event already carries the data. (17a)

## CDK & AWS infra

- GitHub passes unset optional secrets as empty string `""`, not null — guard with `string.IsNullOrEmpty()`, never `!= null`. Set secrets *before* the commit that enables them, or they bake in empty. (7.8h, 8b, 9g)
- CDK v2 versions hash Lambda *code* only, not env vars — force a new version via a non-code property (e.g. `Description`) when an env-var-only change must redeploy. Diagnose stale aliases by diffing synth hashes. (hotfix-transcribe-role-arn)
- `AddEnvironment` doesn't override the constructor dict — token-resolved env vars (role ARNs) must be set *only* via `AddEnvironment`. (referenced in memory)
- Use `apiFunction.CurrentVersion`, not `new Version(...)` (doesn't exist in C# bindings). (6c)
- `PointInTimeRecovery` bool is deprecated → `PointInTimeRecoverySpecification`. (9g)
- Bedrock foundation-model IAM ARNs have no account ID — `Account = string.Empty`. (10d)
- `cdk synth` validates *shape*, not AWS acceptance — deploy is the real gate; `Infrastructure.Assertions` is the canonical regression guard for CDK constant changes. (6, 12e)
- Conditional IAM assertions: match `Fn::Join` resources via `Match.ObjectLike` + add a negative test asserting the grant is absent when unconfigured. (9g)
- CDK bootstrap is per-account AND per-region; cross-region stacks need bootstrap in the target region. (7.8, 7.8h)
- Check CDK deprecation warnings on every upgrade (`S3Origin` → `S3BucketOrigin.WithOriginAccessControl`). (1e)
- Framework upgrades require grepping non-csproj files: `aws-lambda-tools-defaults.json`, CDK runtime constants, CI workflows. NuGet cache can corrupt after mass bumps — `dotnet nuget locals all --clear`. (6)
- New deployment secrets must be documented in README. (9g)

### CloudFront

- SPA routing: 403/404 return `index.html` with HTTP 200; scope it to S3 via a `VIEWER_REQUEST` CloudFront Function so it doesn't hit the API origin. (1e, 7.8h)
- `AllowedMethods` defaults to GET+HEAD — set `ALLOW_ALL` on API-origin behaviors. (7.8h)
- Add `create-invalidation --paths "/*"` to the deploy workflow, or deployments stay invisible up to 24h. For "missing after deploy" confirm: deploy success → invalidation → code on `origin/main` before suspecting the build (stale `index.html` referencing hashed assets is the usual culprit). (1e, 10h)

### SnapStart / Lambda

- Static token caches are load-bearing for SnapStart — document the trade-off. (9b, 6c)
- `Metrics.PushSingleMetric` suits hosts with no Lambda handler method. (12b)
- Serialize OCC-protected stream appends with `await` — concurrent appends fail silently with 409. (6c)

## Auth & security

- Persist tokens in localStorage with a JWT-expiry check; restore on mount; seed auth synchronously on app init so initial requests carry the token. (hotfix-auth-token, bug-1)
- Guard global 401 handlers to fire only when the request actually carried a token — initial calls fire before the token is set. (hotfix-auth-token, 11g)
- IDOR: write endpoints must return 404 when the resource belongs to another user — add ownership guards to every handler; apply isolation in BOTH write guards (scope by UserId) and read projections (filter by UserId). (8cd, 9d, 11b)
- Prefer `GetByIdAsync` for ownership checks — never scan-all-then-filter. (11b)
- OAuth `state` (CSRF) is mandatory; Web Application clients require `client_secret` on the token endpoint even with PKCE (no pure browser-side exchange). (8b)
- iframe `prompt=none` silent refresh is structurally broken by third-party-cookie blocking — use a backend refresh-token flow. Re-issue the refresh cookie on *every* refresh to slide expiry. Cookie `Path` is the browser-visible path — watch gateway path rewriting. (bug-11)
- Browser tab-throttling + cookie blocking are both real — two-layer defence (`visibilitychange` + a pre-flight `apiFetch` JWT check). (11g)
- Auth slice pre-PR checklist: ownership guards, smoke-test auth (Bearer if `SMOKE_TEST_TOKEN` present, skip not fail when absent), E2E auth bypass (`window.__E2E_AUTH_TOKEN` via `AddInitScriptAsync`), CI environment-secret audit. (8cd)

## React / frontend

- Optimistic UI is mandatory for mutations: set state before `await`, reconcile/revert on error in `finally`; snapshot original state before mutating and restore from the snapshot. Skip optimistic revert for navigation-only effects. (3d, 11b, minor-13)
- Optimistic add with `tempId`: parent owns the id reconciliation, swap on the confirm callback. Prefer a `GET` refetch after `POST` for authoritative state over client-side `mapTree` key churn (avoids transient DOM removal on temp→real id swap). (5d, 7.5, 11b)
- Never call `setState` synchronously in a `useEffect` body — derive the transient state instead (key it `{key, state}` and compute the displayed value). Trips `react-hooks/set-state-in-effect`, which `tsc`/`vitest` miss but eslint (a hard CI gate) catches. (16a)
- `useState` + an event handler for "did X happen this session" — not `setState` in an effect; a flag prevents showing stale initial data after Reset. (10c)
- Stable array/object identity for effect deps: module-level constant for an empty fallback, not a literal; document the contract or use `useMemo`. (9e)
- Early return must come after all hook declarations (Rules of Hooks). (6c)
- Stale-closure `onChange`/`onBlur` pairs: mirror state in a `ref` updated synchronously. Circular hook init: `useRef` + `useEffect` to populate after the hook returns. (7a, 11g)
- `await` all async props in handlers and wrap in try/catch — dropped promises swallow errors silently; route errors into visible UI state. (9d, 11c)
- Guard double-submit: the Enter handler clears the input synchronously before `onBlur` fires. (4c)
- Lift API calls to the parent; child components stay pure/controlled (onAdd/onRemove handlers). (5ab)
- Fire one API call per item, not one per comma-separated input — UI looks right either way. (5ab)
- Local `vanished` state removes the one-frame flicker before a parent unmounts a component. (11e)
- Mutual exclusion in one DOM slot (`{!hasContent ? <Cancel> : <Save>}`) beats two booleans that can drift. (11f)
- Derive flags from a single source of truth (`isRecurring = calendarLink?.SeriesId != null`), not a stored boolean. (minor-13)
- Permission states differ: `default` (not asked) vs `denied` (said no) — handle separately. Wrap permission APIs in try/catch; dismiss in `finally`. (9e)
- Notification permission "default" vs "denied" → skip silently vs `alert()`. (9e)
- Browser-only media APIs (`getDisplayMedia` needs `video: true`; transient-user-activation) must be verified in a real Chromium browser. (10f)

### Callbacks, props, types

- Changing a shared callback/prop signature cascades through every wrapper — grep all call sites AND wrapper components, run `tsc -p tsconfig.test.json --noEmit`, fix in one commit before pushing. Grep is the only reliable discovery method. (9d, 9f, 11h, minor-9)
- Optional→required type change breaks fixtures outside the slice — grep all typed usages first. (5e–l, minor-3)
- Removing a `data-testid` breaks E2E — grep test files, update affected journeys in the same commit. Replace obsolete tests, don't delete (documents the new contract). (5m)
- `data-testid` is first-class from initial implementation (`tag-pill-{tag}`); E2E selectors use `data-testid`, never CSS class. (5ab, 14)

## CSS & layout

- `min-height: 0` / `min-width: 0` on a flex child is load-bearing — lets it shrink below content size so it wraps/scrolls; needed at *every* intermediate flex child in a height-filling chain. (7.8, minor-4, minor-8)
- `flex: 1 1 0` on a grid child is dead CSS — confirm the direct parent is `display: flex`. (7.8)
- CSS Grid auto-assigns children sequentially — a new grid child disrupts layout; nest inside an existing child or verify placement. (8b)
- `position: sticky` works on a grid item when the row's `min-height` exceeds the viewport. (minor-8)
- Use `margin-left: auto` on a trailing element for optional-label rows, not `justify-content: space-between`. (9-stylist)
- `dragLeave` fires on child boundaries — guard with `if (e.currentTarget.contains(e.relatedTarget))`. (7.8)
- For every new CSS class, confirm a matching `className` exists in the rendered element. (10b)

### CSS Modules / theming

- Design tokens enable theme reskinning — never reference literal colours in component code. But a mechanical "tokenise every literal" audit can break contrast — judge each by its container. (minor-2, minor-5)
- Muted/secondary text hides AA contrast gaps in palette prototypes (the eye judges the theme by loud colours) — run a standing contrast pass on muted/border tokens when adding palettes. (minor-7)
- jsdom unit tests don't apply CSS — the real safety net is deploy E2E + manual selector audits. Cross-component couplings: contract classes via `:global()`, shared utilities stay global. (14)
- A theme used by one component needs only a hook, no Context, if state doesn't traverse the tree — but enforce invariants (storage key, valid set) in every place. (minor-2)

## Testing

- BDD specs first: every command needs a Given/When/Then before implementation; map each acceptance criterion to a test before opening the PR; flag unmapped criteria. (3a, throughout)
- `[Fact(Skip = "Pip: ...")]` lets Breaker commit a red spec without failing CI — the spec is the contract. (1d, 4a)
- Acceptance criteria describe user action + observable outcome, not HTTP status codes; "done" = the E2E journey passes in a browser, including frontend. (2a, 2b)
- "Already in place" claims must be grep-verified before writing the spec. (7.8, 8a)
- Verify scenarios against the actual architecture before writing tests (e.g. CORS is ASP.NET middleware, not CloudFormation). (8a)

### Component tests (Vitest / RTL / MSW)

- Verify the API call *fired*, not just the optimistic state: closure variable (`let postCalled`) inside an MSW override. (6.5c)
- Render `<App>` for state-machine tests; isolate single components only for purely-conditional rendering. Scope RTL queries with `within()`. Default MSW handlers must cover all mount calls (GET /notes, /folders, /cards). (5n, 6.5c)
- `userEvent.type` on `<input type="date">` silently sets nothing (HTML sanitization) — use `fireEvent.change` with the full atomic value. (6.5d, 4a)
- Fake timers: `findByRole` times out — use `getByRole` after `act(advanceTimers)`; `vi.useFakeTimers()` without `{shouldAdvanceTime:true}` blocks async; add `afterEach(vi.useRealTimers)`; `vi.setSystemTime` advances the clock without firing timers. Per-describe setup, not global (network tests need real timers). (6.5d, 11d, 11g)
- MSW `delay()` is required to see an intermediate render in same-cycle optimistic-then-rollback tests; React 18 auto-batching swallows an immediate-error optimistic add (use a deferred Promise). (11b, 7.5)
- Test every arm of a new predicate in isolation, especially async-loaded arms; negative-space tests (assert absence) anchor `{cond && <el>}` contracts. (6.5c, 11f)
- Move MSW-satisfiable tests to the component layer — reserve E2E for real network boundaries / happy-path journeys. `WaitForResponseAsync` resolves on *any* status including errors. (5n, 7.5)
- Promise executors need `.catch(() => resolve(null))` to avoid unhandled rejections. (11d)
- Vitest pool: `vmThreads` is correct for WSL2/NTFS but strips Web Streams globals — polyfill in setupFiles before MSW. Keep test-only TS types in `tsconfig.test.json`, not `tsconfig.app.json`. Use a stable Vitest major (2.x); 4.x+ native bindings cause lock-file instability. (6.5b)

### E2E (Playwright)

- xUnit `IClassFixture<T>` is per-class, not per-test — put clean-state assertions in their own class for a fresh instance. (5d, 6.5a)
- E2E note titles use a `Guid`-derived value to avoid concurrent-run collisions; clear test data before runs to prevent flakiness. (2d, 3b)
- Multiple `WaitForResponseAsync` to the same URL can both resolve to the first response — use an atomic counter on a single Response listener. (5c, 5ab)
- Bounding-box (X/Y) assertions are implementation-agnostic — pass regardless of Grid/Flex. Need a dedicated `data-testid` span for `<input type="date">` (displays formatted, not input, value). (4a, 4b)
- E2E click targets must be specific child elements, not whole containers a new button may obscure. Keep the page object atomic across navigation changes — grep + update all method calls in one PR. (7.8, 11e)
- `ClickNewNoteAsync` shares one 30s timeout across API+UI — give the POST its own `WaitForResponseAsync` budget. (7.8h)
- Error-path smoke assertions use concrete valid payloads, not null, to pin the error source. (7.8i)

### .NET test conventions

- Tests mutating a process-global env var must snapshot + restore in `finally` (never force a literal); process-global mutation forces serial execution — `[assembly: CollectionBehavior(DisableTestParallelization = true)]`. (10g)
- `WithWebHostBuilder` makes an isolated factory with fresh singletons — create all test data in the same instance. (10d)
- Capture Powertools output via `Console.SetOut` — the `LogOutput` `ConfigureTestServices` override is silently ignored. (bug-8)
- `xUnit2029`: use `Assert.DoesNotContain(collection, predicate)` over `Assert.Empty`. (2d)
- Never hardcode an absolute future date in a fixture compared against the clock — it detonates when the date passes. Use far-future literals (2099) only for fake credentials, never for `UtcNow + offset` logic. (time-bomb memory, 10b)
- Widen a result record with defaulted fields to avoid churning construction sites; only production paths stamp real values. (10g)

## Observability

- Instrument at the architectural chokepoint (decorator on the `IEventStore` seam), not per-handler. Filter exception types in the catch to count only domain violations. (12b)
- The real per-request correlation key is `xray_trace_id` (set by X-Ray), not `correlationId`. Returning a correlation id and logging it are two separate obligations — cover both. (12g, bug-8)
- Use Powertools `Logger.AppendKey` (AsyncLocal, tags all instances), not `BeginScope`. Powertools emits snake_case keys; EMF dimensions are PascalCase — case-sensitive in Logs Insights. (bug-8, 12g)
- Correlation header on all responses: middleware before auth + `Response.OnStarting` (before headers flush). (12a)
- X-Ray throws off-Lambda by default — `ContextMissingStrategy.LOG_ERROR`; `RegisterXRayForAllServices()` must precede lazy client construction. Echo inbound `X-Amzn-Trace-Id` back as a response header. (12c)
- Dimensioned EMF metrics need free-text `SUM(SEARCH(...))`, durable across dimension changes; Powertools adds a `Service` dimension automatically. Metric alarms forbid `SEARCH` — use a dimensionless aggregate or `MathExpression` + `UsingMetrics`. `TreatMissingData.NOT_BREACHING` avoids false pages on idle. (12d, 12e)
- RUM: `CfnAppMonitor` doesn't create Cognito auth — manually build identity pool + guest role + `CfnIdentityPoolRoleAttachment`. Break the role↔monitor cycle by constructing the ARN from the fixed monitor name. Use `AttrId` (GUID) for `applicationId`, not `.Ref`. Loader CDN is us-east-1 only; data plane is regional. Inject the RUM id post-build, never commit it. (12f)
- A saved query returning nothing is the same failure class as a broken deploy — verify against real logs. Resolve the actual Lambda log group via `get-function-configuration`, not an assumed name. (12g)
- Post-deploy verification is mandatory for instrumentation: throw a test error, confirm it lands. (12f)
- Every new AWS SDK call needs a catch mapping its service-specific exception to a 503/4xx. The 500 handler only triggers on read paths with no try/catch. (10b, 12a)
- Distinct-cause logging (e.g. `invalid_grant`-specific) makes root causes legible vs generic catches; anchor log timestamps to the change timeline. (9-self-heal)

## Bedrock / LLM analysis

- Default to Amazon models (`amazon.nova-lite-v1:0`) over Anthropic on Bedrock — no FTU form, no Marketplace subscription, on-demand in eu-west-2. Nova schema: request `"schemaVersion": "messages-v1"`, response text at `output.message.content[0].text`. (10d, bedrock memory)
- LLM output gated by a user toggle must be enforced in the deterministic handler — the code check is the contract, the prompt is a hint. (10h)
- Transport swap (e.g. → Converse API) is "behaviour-identical" only if you pin request AND parse; extract pure helpers so the diff is "envelope only". Refactors silently drop observability unless logs are treated as contract — grep the marker before touching log lines. (10n)
- Eval: anchor env-var paths to absolute paths in `run-eval.sh`. Cross-run variance is large — sweep every compared prompt version in one run so prompt effect isn't conflated with run-to-run noise. (10p)
- Optional JSON body on a minimal-API endpoint: nullable record coalesced to a safe default (don't break no-body callers). Guard emptiness with `IsNullOrWhiteSpace` on both frontend and backend. (10h)

## Transcription / streaming / browser media

- Streaming ASR must batch audio into ~100ms chunks — the Web Audio render quantum (~8ms) is a capture detail, not a transmission unit; per-frame `AudioEvent`s overload main-thread SigV4 signing and the backlog never drains. (bug-10)
- Realtime keep-pace defects are unreachable in the test pyramid (worklet + SDK are mocked) — a manual real-call check is a genuine acceptance criterion. Measure the bottleneck (`audioQueue.length` growth) before re-architecting; the in-architecture fix usually exists. (bug-10)
- In a long-lived streaming UI, re-render cost that grows with accumulated content congests the session — throttle partial re-renders (≤1/200ms); finals render immediately. (bug-10)
- Use `AudioWorkletNode` (data URL or static asset), never `createScriptProcessor`. (10b)
- Both recording-end paths (Stop button + natural end-of-stream) must call the completion handler — test the natural-end path separately. (10c)
- Validate empty transcript server-side before projection lookup — a DynamoDB conditional can silently drop it. (10c)
- Transcription checkpoints are loss-tolerant working state, not events: a separate overwrite-in-place draft store, no events emitted, composed at read time. (18-A, ADR 0011)

## Google Calendar

- SDK returns `null Items`, not an empty list — always `?? []`. SDK types are `IDisposable` — `using` (service disposed first). (9b)
- All-day events: `new DateTimeOffset(DateTime.Parse(e.Start.Date!), utcOffset)`, not `DateTimeOffset.Parse` (which uses process-local). (9b)
- Invalid IANA timezone → 400, validated in the handler (not 503 from the service). (9b)
- `Instances` endpoint: `ShowDeleted = false` (server-side) + `MaxResults ≥ 5` (lookahead) — `MaxResults = 1` with a client-side cancelled filter silently 404s. (9f)
- Token self-heal: reload-once-and-retry on `invalid_grant`, short-circuit if SSM returns the same dead token. Publishing to prod does NOT revive an expired token — re-mint after publishing; the re-mint script writes to SSM and verifies the version bumped. (9-self-heal, calendar-token memory)
- Local calendar date, not UTC: compare `YYYY-MM-DD` strings via user wall-clock getters; lexicographic ISO-8601 tiebreak works only because both sides emit canonical `Z`-suffixed UTC. (minor-3)

## API & handler conventions

- Endpoints do HTTP only — parse, call handler, return. Never `store.ReadAsync`/`AppendAsync` in an endpoint lambda. (CLAUDE.md, throughout)
- Every async handler/endpoint threads `CancellationToken` through all store/handler calls — silent dropout otherwise. (4e, 9c)
- `Task.WhenAll` for independent async batches — never a sequential `foreach` over Task-returning calls; per-item try/catch returning null on failure. (9c, 11b)
- Never include request-contract fields the handler doesn't read — a declared-but-unused field is a contract lie; delete before PR. (9f)
- A boolean nav flag needs its companion id in the same response (no second round-trip): `nextOccurrenceNoteId` alongside `hasNextOccurrenceNote`. (9f)
- Create a dedicated `XNotFoundException` per aggregate, not generic `InvalidOperationException`; extract exception types to their own files. (5e–l)
- Every Note-command endpoint catches both `NoteNotFoundException` and `InvalidOperationException` → 404. (10c)
- Validate all required env vars before `builder.Build()`, not at first request. (1c)
- Place event deserialization in `src/EventStore/`, not the API layer. Every `src/Api/Contracts/*.cs` opens with `namespace Api.Contracts;`. (1c, 10c)

## Pipeline, git & process

- Never commit slice work directly to main — Breaker creates a branch AND a worktree first; use an absolute path for `git worktree add` or it nests inside the repo. (CLAUDE.md, bug-1)
- Worktree isolation survives editor/host crashes — recovered WIP is clean; diff against main to confirm completeness before reconstructing. (bug-2, minor-4)
- Never sweep foreign WIP from a shared main checkout into a commit — `git diff --cached`, stage explicit paths only (never `git add -A`), restore anything unintended. Run Scribe from a clean worktree off `origin/main` when the primary checkout is dirty. (bug-2, bug-4-5, minor-1, main-staged memory)
- `core.hooksPath` is repo-wide — toggling it from one worktree affects all checkouts; activate the hook (`git config core.hooksPath .githooks`) in every new worktree. (10c, minor-1)
- Merge gates (all required): Hawk approved + PR CI all `pass` (none pending/failing) + main's *latest* deploy `completed`+`success` with no deploy in progress. Never use `--status completed` (hides an in-progress run). Never chain `gh pr merge` unconditionally after a gate-check echo — parse the status and abort. `--auto` does not defer the merge here. (10e, bug-11, ci-gate memory)
- `gh pr merge --delete-branch` deletes only the *remote* branch; local cleanup fails ("main is already used by worktree") — harmless; delete the local branch + remove the worktree separately. (12a, minor-1)
- `gh run view` takes the database id, not the display number — resolve `databaseId` from `gh run list --json` once, then watch. (minor-14)
- Re-running a deploy: `gh run rerun <id>`, not an empty commit. (redeploy memory)
- Match the local Node version to CI (Node 20) before committing `package-lock.json` — npm 11+/Node 24 omits optional native-binding entries and `npm ci` fails. If only Node differs, `git checkout -- package-lock.json` and never stage it. (14, 15a, 16a, minor-13)
- Run `npm run lint` (or trust the pre-commit `eslint .`) on changed frontend files — lint is a hard CI gate that `tsc`/`vitest` don't replace; a stale `.eslintcache` can hide `import-x/order`. (11a, 16a, 19-A)
- When moving/renaming a module, grep dynamic `import('…')` too, not just `from '…'`. (19-A)
- Concurrent sessions editing a shared backlog/CSS doc collide — claim the next number by committing the summary-table row first; append CSS in fenced EOF regions per slice and resolve by reappend-all, never LCS/hunk-merge (verify brace balance). Sequential slices on a hot file avoid the conflict tax entirely. (15b, minor-5, minor-6, minor-9, minor-12)
- Never take over a live sub-agent's worktree — they collide on git state; a slice has exactly one driver. (minor-6)
- Re-validate an open slice against main before squash-merge if main advanced; check in-flight PRs touching the same files and order merges accordingly. (bug-1, 9f)
- Land Scout phase docs on main via their own small PR before `/run-pipeline` starts (don't draft loose edits in a shared checkout mid-flight). (phase-17 process)
- Re-review via a fresh `code-reviewer` subagent with prior findings + fix summary inlined. Apply a reviewer's trivial flagged tidy when already editing those lines. (10f, minor-11)
- Remove dead/tested-but-unreachable code immediately rather than carrying it. Intentional pattern divergences need a why-comment so the next engineer doesn't "clean up" non-standard code. (bug-10, 8a, 10b)
- Combine multiple bugs that resolve to one cross-cutting fix into a single slice/PR. Batch frontend-only disjoint-file slices to cut serial deploy gates. (bug-4-5, 14)
- Extract a duplicated helper when the *sixth* call site appears, not before (e.g. `NoteIdFromStreamId`). (7.8, 4e)
- A user-facing string is the whole point of its change — assert on the string with `getByText`, not just via testid. (minor-14)
- `node_modules` existing ≠ install finished — wait for task completion before trusting the pre-commit gate. (minor-12)
- For UX-uncertain slices, a standalone HTML prototype reusing real component CSS is the fastest iteration loop and locks structural decisions before Stylist; prototype subjective briefs as concrete deltas on the current layout. (9-stylist, minor-10)

## Frontend libraries

- TipTap v3: set `immediatelyRender: false` (strict-mode hydration). Uncontrolled editor with `key={noteId}` guarded by loading state — no `useEffect` to sync external state. `tiptap-markdown` needs manual TS module augmentation. Unit-test by mocking the editor as a textarea stub — no real ProseMirror in jsdom. (7a)
- Floating button in TipTap: `onMouseDown + preventDefault()` to avoid editor blur before the command fires; Y position is the selection midpoint; pair `onFocus` with `onSelectionUpdate`/`onUpdate` for mount-time selections. (7b)
- WAI-ARIA combobox needs `role=combobox`, `aria-controls`, `aria-activedescendant`, stable option `id`s; group headings as `<li role="presentation">` siblings, not nested in `role="option"`. (11a)
- Non-dismissable overlay needs `role=dialog` + `aria-modal=true`; collapsibles need Escape + outside-mousedown dismissal via a document listener. (11d, 7b)
