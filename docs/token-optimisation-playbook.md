# Token / Process Optimisation Playbook

Recurring cost drivers distilled from `docs/token-log.md`, deduplicated, each with its pre-emption and where the fix already lives. Extracted so the per-slice log can stay terse (table + Why). When a new slice surfaces a *novel* avoidable cost, add a row here — not a prose block in the log.

## Biggest lever: collapse two-round Hawk reviews to one

Two Hawk passes were the single most common spike (3-A, 3-C, 4-E, 5-A, 5-EFGHIJKL, 6, 6.5-C/D, 7-A/B, 7.8-C/G, 8-A/B, 9-B/C/E/G, 10-B/C, 11-A/C/F/G). A second pass re-reads the full PR (~20–40k). Most first-pass findings are mechanical and pre-emptable in Refactor / a pre-PR self-check.

| Recurring finding | Pre-PR check | Already encoded |
|---|---|---|
| Modifying event/projection `with {}` omits `LastModifiedAt` | Every tag/untag/date `with {}` updates `LastModifiedAt` | Refactor checklist |
| New AWS SDK call has no try/catch | Wrap every new AWS service call | Refactor / pre-PR |
| `CancellationToken ct` accepted but not threaded | Handlers/stores pass `ct` through | Refactor checklist |
| `Task.WhenAll` over per-item external calls swallows failures as 500 | Per-item try/catch to degrade gracefully | CLAUDE.md (`Task.WhenAll` guardrail) |
| Projection read missing `ConsistentRead = true` | All GetItem/Query/Scan set it (except GSI) | projection skill |
| DynamoDB empty-string write rejected | `string.IsNullOrEmpty → NULL` guard | projection scaffold |
| Optional CDK prop from `${{ secrets }}` is `""` not null | Guard with `string.IsNullOrEmpty()` | CLAUDE.md guardrail + [[feedback_cdk_add_environment]] |
| New `.cs` in `Contracts/` missing namespace | Verify namespace on new contract files | pre-PR |
| Handler catches only `NotFound`, not `InvalidOperationException` | Catch both on delete/edit races | pre-PR |
| New predicate arm (`hasContent`, `isSaveEnabled`) untested | One test isolates each new branch | pre-PR |
| Custom dropdown missing WAI-ARIA combobox wiring | `role=combobox`, `aria-controls`, `aria-activedescendant`; group headings `role=presentation` | frontend-react skill |
| Collapsible panel missing Escape + click-outside dismissal | Wire both on any dismissible panel | Refactor UI checklist |
| Cursor-tracking UI wires `onSelectionUpdate` but not `onFocus` | Wire both | NoteEditor pattern |
| CDK constant changed without matching assertion | Every CDK constant change gets an InfraAssertions test | Refactor checklist |
| Conditional IAM grant test asserts only Action+Effect | Add negative test for the guard (`Record.Exception`) | cdk-stack-update skill |

## Run lint + tsc after every fix commit, not just at the end

Post-merge hotfixes for lint/tsc that a local run would have caught: `react-hooks/set-state-in-effect` (10-C, 16-A), `done` never reassigned (10-B), prop-signature drift across parents (11-H). Run `npm run lint` and `tsc --noEmit` after *each* fix commit; grep all call sites before a prop-signature change. Encoded: CLAUDE.md frontend guardrails, [[feedback_typecheck_before_merge]].

## Synth is not a deploy gate — author against real resources

Deploy-only failures invisible to `cdk synth` / `Template.FromStack` / Hawk, each costing a diagnose→fix→redeploy cycle: SEARCH-on-alarm (12-E), RUM CDN host (BUG-6), 7 successive failures on human-readable URLs (7.8-H), Logs Insights field names (12-G, two Hawk rounds). Pre-empt:
- For Logs Insights / dashboard / query work, run filters against the live log group while authoring; resolve the real log group first (`get-function-configuration --query LoggingConfig`).
- For risky infra (alarms, RUM, cross-service ARNs), `cdk deploy --no-execute` + change-set inspection, or a sandbox stack, before merging to main.

## Parallelism: disjoint files only, one driver per slice

- Two slices sharing one file (`App.css`, `NoteTakerStack.cs`) is the anti-pattern for parallel worktrees — double conflict resolution + redundant full-suite reruns, and a break in one stalls the other (12-E/H ≈ –120k; CHANGE-5/6/7 batch ~536k). Sequence shared-file slices instead (CHANGE-8/9 proved it: branch the second after the first merges → zero conflict).
- Never background a slice agent *and* take it over — the collision forces a reset + re-merge (CHANGE-6). If you take over, treat the agent as dead.
- The rule scales to **phases**: phases that all edit a hub file (`App.tsx` — Phase 20 server-state, 21 routing, 22 search) must be **sequenced**, not overlapped. 20-B cost ~360k (≈2× clean) in two mid-build rebases + re-verifies when 21-A then 22-A landed on `App.tsx` mid-build; the folder logic never conflicted, only the shared file. Land the structural phase (routing) first, branch the rest off it.

## Work off main in a worktree, never stage on the shared checkout

Staging PR work on the shared primary `main` checkout races concurrent sessions/user commits → git-collision recovery (MPI-2 ~55k; 18-A data-loss scare ~45k). Always use a dedicated worktree; use an **absolute** `git worktree add` path (relative-from-`web/` nests it inside the repo — BUG-1). Encoded: [[feedback_main_staged_index]], CLAUDE.md Worktrees.

## Layer-split large slices to avoid context auto-compaction

Slices with ≥4 criteria / new aggregate + projection + E2E auto-compacted mid-Pip (3-A, 8-C/D, 10-D, 7.5, 7.8-H). Breaker splits: domain/API tests → Pip → E2E tests → Pip. Two smaller sessions beat one compacted 95k+ session; domain errors caught before the expensive E2E layer.

## Cache-invalidation/optimism bugs hide until the post-merge E2E

A clean Vitest suite + green Hawk does **not** de-risk TanStack invalidation/optimism changes against the real stack. Two 20-C regressions passed everything local and only the post-merge deploy E2E caught them (fix #195, red main, ~one extra fix cycle):
- **Always-mounted parent query → invalidation churn.** `useNoteCards` lives in `AppContent` (wraps every route), so a tag mutation invalidating `keys.noteCards` inside NoteView forced a `GET /notes/cards` while the list wasn't visible → E2E timing flake (different test each run). Before invalidating from a mutation, ask *where is that query observed?* — prefer invalidating on navigation back to the consuming view over from an unrelated view.
- **Fire-and-forget write that gates a filter.** `setNoteDate` (home list filters by date) was made non-awaited; the cards refetch could beat the date PATCH → card date-less → hidden. A write whose value gates list visibility must complete before the list can refetch. Optimistic local state masked it in unit tests; only the server-refetching E2E exposed it.

Budget for a possible post-merge E2E fix on `App.tsx`-hub TanStack slices. When an E2E flakes on a *different* test each run within one suite, suspect newly-added refetch churn, not a flaky test. (20-C)

## Don't double-run the test suite

The WSL frontend suite is ~3 min/run. A manual targeted `vitest run <X>` before commit is redundant with the pre-commit hook's full-suite run (10-E, 10-F, CHANGE-4). Pick one.

## Node parity before generating a lock file

`package-lock.json` generated on Node 24/npm 11 omits entries Node 20's `npm ci` expects → CI failure (6.5-B). Confirm local Node == CI (Node 20) before committing a lock file; the node-version revert guardrail now catches this. Encoded: CLAUDE.md guardrail.

## Up-front design/Explore is the target trade, not waste

A Plan/Explore agent that resolves a hidden requirement before implementation buys a first-pass Hawk approval (12-F Cognito guest role; 10-M 11-touchpoint map; 10-G; CHANGE-13 self-review caught Limit-before-filter + lock churn). Read-ahead during deploy/CI gaps (10-I).

## Smaller recurring snags

| Snag | Fix | Slice |
|---|---|---|
| Deploy monitor 404s on run *display number* | Use `databaseId` | CHANGE-14 |
| `until` watcher matches "error" inside "0 errors" | Anchor the match | CHANGE-14 |
| Logged marker string edited → observability signal lost | A log marker is an API; grep before editing | 10-N |
| Concurrent session clobbers backlog numbering | Reserve the number with a table-row commit first; re-read at Scribe | CHANGE-12 |
| `find` over untracked project dumps `bin/`+`obj/` | `-not -path '*/bin/*' -not -path '*/obj/*'` | 10-F |
| Stale E2E data from a prior failed run poisons next | Clear test data *before* E2E, not only after | 3-B |
| `git rebase --quit` to finish a resolved rebase leaves the branch ref behind → detached HEAD → stale PR head pushed | Never `--quit` to finish; use `--continue`, or `git checkout -B <branch> <sha>` then `--force-with-lease`; verify `gh pr view -n --json headRefOid` == local HEAD | 20-B |
| Async `onError` rollback assertion races a sync check (green on `forks`, red on `threads`/CI) | Wrap rollback assertions in `waitFor`; only optimistic-apply-after-`userEvent` can be sync | 20-B |
| Sibling frontend slice merged shared infra (providers/test helper) → PR-merge CI red while local green | Merge `origin/main` + re-run before finalizing a frontend PR when other frontend slices are in flight | 21-A |
| Local green only under `CI=1` forks; `vmThreads` red on an ESM-in-CJS dep | Test new frontend deps under the local `vmThreads` pool too, not just forks, before committing | 21-A |
| Built a whole slice against a **stale local plan** — a parallel session had already merged the next slice and written a different authoritative spec on `origin/main`; the work was thrown away | `git fetch` + read `origin/main`'s phase doc **before** Scout/Breaker/any slice start. The working tree is not "current" when another session drives the same phase | 20-E |
| A backgrounded **commit** (slow pre-commit gate) raced a concurrently-launched **push/poll** task on the same worktree → a `git reset` left the commit undone (staged but uncommitted) | Don't run two git mutators on one worktree at once. Launch the commit, **wait for its completion notification**, verify HEAD, *then* push — never chain a push-waiter that polls `git log` while the commit's hook is still running | 20-G |
| A delegated **sub-agent was killed mid-run** (spend limit / crash) leaving sound but **uncommitted** partial work; re-dispatching risks a second cutoff losing it | When an agent dies, **first assess + commit** whatever builds/passes (lock it in), *then* continue or re-delegate the remainder | 27-B |
| A new **CDK `Code.FromAsset` project** synths locally (asset published) but the PR's `cdk synth` gate goes red (asset dir absent in the PR job) | Add the `dotnet publish <new-project>` step to **every** workflow that synths — `pr.yml` *and* both `deploy.yml` jobs, not just deploy | 27-B |
| New .NET Lambda project referencing an existing one hits NU1605 `Amazon.Lambda.Core` downgrade-as-error (multi-step) | Pin `Amazon.Lambda.Core` to the version the referenced project already resolves (here 3.1.0) up front | 27-B |
