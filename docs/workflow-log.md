# Agentic Workflow Log

A first-class output of this project. The point isn't just to ship features — it's to capture how the agentic workflow evolves and what we learn.

Add an entry at the end of each phase. Keep them short and honest.

## Template

### Phase N — *title*

- **Workflow style used:** (prompt-and-review / spec-and-delegate / autonomous loop / mixed)
- **Skills exercised:** (which skills got loaded; which were missing)
- **What worked:** 2–3 bullets
- **What didn't:** 2–3 bullets
- **Change for next phase:** 1–2 specific changes to the workflow

---

## Phase 0 — Setup

- **Workflow style used:** Mixed — prompt-and-review for infrastructure and CDK work, spec-and-delegate attempted for the acceptance spec and CI/CD slices, but in practice the agent collapsed all roles into a single continuous stream without stopping for human checkpoints.
- **Skills exercised:** `agent-skills:incremental-implementation`, `agent-skills:test-driven-development`, `agent-skills:build`. The five-role pipeline (Scout / Breaker / Pip / Hawk / Scribe) was not followed; roles were merged rather than gated.
- **What worked:**
  - Thin-slice delivery — each slice was small enough to complete, verify, and commit in one session without getting lost
  - The BDD acceptance spec pattern (env-var guard + real HTTP call) proved clean and directly useful to the pipeline
  - Pre-commit hook caught real issues on commit before they reached CI
- **What didn't:**
  - The five-role pipeline was bypassed entirely for 0-B through 0-E — no human checkpoints, no Hawk review, no Scribe until the user explicitly asked
  - The workflow-log and learnings doc were forgotten until prompted — they should be mandatory outputs at phase end, not optional ones
  - Scope changes (DynamoDB deferred, React deferred) were absorbed on the fly mid-session rather than going back through Scout to update the plan before implementation continued
- **Change for next phase:**
  - Enforce the gated pipeline explicitly: Scout produces a brief, human reviews it, Breaker writes failing specs, human reviews them before Pip touches any implementation code
  - Scribe and workflow-log updates are part of Pip's definition of done — not a separate prompt required from the human

---

## Phase 1-B — IEventStore OCC Contract

- **Workflow style used:** Gated pipeline — Breaker wrote specs in a prior session; Pip implemented this session with Hawk review before merge.
- **Skills exercised:** `dynamodb-event-append` (OCC pattern reference), `review` (Hawk verdict).
- **What worked:**
  - Hawk caught two real spec gaps (batch append, non-existent stream read) and a subtle test-double bug (`AsReadOnly()` wrapping live list) — all fixed before merge
  - Automated Pip→Hawk handoff (CI green → review) worked cleanly once the guardrail was corrected
  - Pipeline-gating guardrail in CLAUDE.md was introduced and refined within the same session based on live feedback
- **What didn't:**
  - Pip jumped straight to implementation without being named — had to be stopped mid-edit; the guardrail was added reactively rather than proactively
  - The guardrail was written too broadly on first attempt (blocking all automatic triggers) and needed a correction pass immediately
  - Main pipeline had a transient Lambda 500 on first run after deploy; required manual re-run to confirm it was not a code regression
- **Change for next phase:**
  - The transient Lambda cold-start failure on deploy is a known pattern — consider adding a retry or warm-up step to the acceptance spec run in the deploy workflow

---

## Phase 1-B (part 2) — DynamoDbEventStore + CDK table

- **Workflow style used:** Scout → Pip → Hawk → Scribe (Breaker skipped — interface already specced)
- **Skills exercised:** `dynamodb-event-append` (OCC TransactWrite pattern), `cdk-stack-update` (table + IAM + env var)
- **What worked:**
  - Autonomous pipeline ran end-to-end without human input — CI monitoring, Hawk review, Pip fixes, and merge all automated
  - Hawk correctly identified the pagination gap before it could silently corrupt aggregate rebuilds in 1-D
  - CDK `RemovalPolicy.RETAIN` applied correctly from the start
- **What didn't:**
  - `cdk synth` can't run locally — CDK gate is CI-only, lengthening the feedback loop for infra changes
  - Two CDK compile errors (Attribute ambiguity, Tags.Of instance reference) added a round-trip that a local synth would have caught
- **Change for next phase:**
  - Pip should check CDK local availability at the start of any infra slice and note if CI is the only synth gate

---

## Phase 1-C — POST /notes endpoint

- **Workflow style used:** Full pipeline — Breaker wrote acceptance spec on the same branch as Pip implementation; Hawk reviewed before merge.
- **Skills exercised:** `aggregate-command` pattern (Breaker + Pip), `review`.
- **What worked:**
  - First end-to-end slice: aggregate → event store → API → acceptance spec — all wired and green in CI
  - Breaker spec pattern (API_BASE_URL gate) works cleanly for acceptance tests
  - Hawk caught `Deserialize` placement issue before it proliferated into 1-D
- **What didn't:**
  - Cold-start Lambda 500 on every deploy is now a consistent pattern, adding a manual re-run to every merge — needs a structural fix
  - `Deserialize` placed in Program.cs needs extraction to `src/EventStore/` before 1-D
- **Change for next phase:**
  - Add a 10-second sleep between CDK deploy and acceptance test run in `deploy.yml` to absorb Lambda cold-start
  - Extract `EventDeserializer` to `src/EventStore/` at the start of 1-D before writing any projection code

---

## Phase 1-E — React scaffold + CloudFront + CORS + CI wiring

- **Workflow style used:** Gated pipeline — Breaker n/a (no new BDD specs in this slice); Pip implemented, Hawk reviewed before merge.
- **Skills exercised:** `cdk-stack-update` (S3 + CloudFront + CORS + outputs), `refactor` (applied retrospectively across 1-C/1-D changes before opening PR).
- **What worked:**
  - Hawk review caught CloudFront invalidation gap before merge — documented as a known gap rather than blocking the merge
  - Refactor skill produced concrete improvements in the same session as implementation: `NoteCommandHandler` extraction, `EventDeserializer` routing, `ConfigureAwait(false)` sweep, `MetaStreamSk`/`SequenceSk` constants — all in one pass
  - CI-first build verification is sufficient when npm is not installed locally; the workflow file is the truth
- **What didn't:**
  - `npm ci` in CI failed because no `package-lock.json` was committed — had to change to `npm install` and push a fix commit; root cause is npm not being installed locally
  - Re-opening a named note shows a blank title input — projection data is not loaded on note open; this is a walking-skeleton gap
  - CloudFront cache invalidation is missing from the deploy pipeline; S3 sync + no invalidation means up to 24h before changes are visible
- **Change for next phase:**
  - Install Node.js locally so `npm install` can be run to generate and commit a `package-lock.json`, enabling `npm ci` in CI for reproducible builds
  - Add a CloudFront invalidation step (`aws cloudfront create-invalidation`) to `deploy.yml` after the S3 sync

---

## Phase 1-D — PATCH /notes/{id}/title + GET /notes + NoteTitleList projection

- **Workflow style used:** Gated pipeline — Breaker wrote specs first (with `[Fact(Skip)]` to satisfy pre-commit hook), Pip implemented, Hawk reviewed before merge.
- **Skills exercised:** `projection` (NoteTitleListProjection fold + DynamoDB store), `cdk-stack-update` (projection table).
- **What worked:**
  - `[Fact(Skip = "Pip: ...")]` pattern resolves the tension between "failing specs on commit" and the pre-commit hook requiring all tests to pass — specs capture the contract, skip keeps the hook green
  - `EventDeserializer` extraction was clean — Hawk's 1-C finding paid off immediately in 1-D
  - Projection fold (`NoteTitleListProjection`) is pure and unit-testable; DynamoDB persistence (`NoteTitleListStore`) is a separate concern — good separation
- **What didn't:**
  - Pre-existing notes (created before this deployment) won't appear in `GET /notes` — projection is forward-only from deploy time; no rebuild mechanism exists yet
  - Full table scan in `QueryAllAsync` is fine now but will need revisiting as data grows
- **Change for next phase:**
  - If a rebuild path is needed (e.g., for pre-existing data), it belongs in a separate `RebuildProjection` command/script — don't embed it in the API Lambda

---

## Phase 1.5 — Layer 2: EventStore Integration Tests

- **Workflow style used:** Gated pipeline — Plan mode for approach approval; user granted blanket authorization through all roles for phase 1.5. Breaker → Pip → Hawk in one session without mid-phase check-ins.
- **Skills exercised:** `refactor` (caught a dead `using DotNet.Testcontainers.Builders;` after the build passed cleanly with it present — CS8019 is informational, not a warning, so TreatWarningsAsErrors didn't catch it).
- **What worked:**
  - `Testcontainers.DynamoDb` pulled in `AWSSDK.DynamoDBv2` transitively — no separate package reference needed.
  - `IClassFixture<DynamoDbFixture>` + unique `streamId` per test gives strong isolation without the overhead of a fresh container per test. All 6 tests run in ~500 ms on the second run (image already pulled).
  - `ubuntu-latest` runners have Docker pre-installed; no CI setup step was needed beyond adding the `dotnet test` line.
  - Hawk confirmed the `"META#stream"` literal duplication is acceptable: it's testing the on-disk schema from outside the class, not the constant itself.
- **What didn't:**
  - Nothing broke. Straightforward slice.
- **Change for next phase:**
  - Layer 3 (`ApiIntegration`) can reuse the `IAsyncLifetime` fixture pattern from this layer for any in-process setup it needs — but ADR 0008 calls for `InMemoryEventStore` there, so no Docker required.

---

## Phase 1.5 — Layers 3, 4, 5: API Integration, Acceptance Hardening, CDK Assertions

- **Workflow style used:** Blanket authorization through all roles for phase 1.5. Layer 3 implemented in main session (required production code changes); Layer 4 delegated to background agent; Layer 5 delegated to background agent in a parallel worktree. Worktree was based on the pre-L2 commit due to batch-spawn timing — Layer 5 files were extracted and applied manually to the main tree.
- **Skills exercised:** `refactor` (caught missing `default: break` in `NoteTitleListProjection` switch).
- **What worked:**
  - `INoteTitleListStore` interface extraction was minimal: 5-line interface, one-line change in `NoteCommandHandler`, one-line change in `Program.cs` — clean separation, no churn.
  - `WebApplicationFactory<Program>` + `ConfigureTestServices` overrides worked first try once `Microsoft.AspNetCore.TestHost` using was added for `ConfigureTestServices`.
  - CDK assertions run in-process (~6s) against the synthesised template — no AWS account or `cdk synth` needed in CI.
  - `lambdaAssetPath` CDK context key elegantly solved the `Code.FromAsset` directory-must-exist constraint without touching the real deploy path.
  - Layer 4 (acceptance hardening) was a zero-change finding — the acceptance tests were already self-contained. Agent confirmed cleanly in 37s.
  - Building in Release mode (while the dev server holds Debug DLL locks) is a viable workaround — worth noting for future slices.
- **What didn't:**
  - Parallel agent worktrees are created from HEAD at spawn time; if a commit and agent spawn are in the same tool batch, the worktree may be based on the pre-commit HEAD. Extract-and-apply is the recovery path.
  - The dev API server holds locks on Debug DLLs, blocking `dotnet build` in Debug mode. The solution (`-c Release`) is simple but non-obvious.
- **Change for next phase:**
  - Pre-commit hook runs domain specs only. Consider adding a fast build-only check for the new test projects to catch compile errors before push.

---

## Phase 1-E (cont.) — E2E reliability + optimistic UI

- **Workflow style used:** Conversational diagnosis — user reported CI failures, agent investigated and fixed iteratively across several commits.
- **Skills exercised:** None loaded — all fixes were targeted edits to existing files.
- **What worked:**
  - Reading the changing error message across CI runs as a diagnostic signal: first "not visible" (note not appearing at all) → then "resolved to 2 elements" (note appearing twice). Each shift pinpointed the next problem.
  - Registering `WaitForResponseAsync` *before* `BlurAsync()` is the correct Playwright pattern — it guarantees the listener is in place before the action that triggers the network request.
  - Optimistic UI (lift state to `App`, update immediately, revert on PATCH failure) solved both the timing fragility and the manual-refresh UX bug in one move.
- **What didn't:**
  - `WaitForLoadState(NetworkIdle)` is unreliable for this pattern: the PATCH request can start after Playwright begins watching, so NetworkIdle fires before the response arrives. Should have used `WaitForResponseAsync` from the start.
  - CORS guarded by `IsDevelopment()` was silent in production — no error thrown server-side, just missing headers in responses. Took several commits to isolate.
  - E2E tests against a persistent shared environment accumulate stale data across runs. "My journey note" built up across CI runs until Playwright's strict-mode locator failed.
- **Change for next phase:**
  - E2E tests against a real deployed environment must always generate unique test data (GUID suffix on titles, IDs, etc.) — treat it as a hard rule, not an afterthought.
  - Any new E2E page interaction that triggers a network request should use `WaitForResponseAsync` rather than `NetworkIdle`.

---

## Slice 3-B — Complete and reopen action items

- **Workflow style used:** Full autonomous pipeline — Scout brief already in phase doc; Breaker → Pip → Refactor → Hawk → Scribe with no human checkpoints (user granted blanket authorisation at slice start).
- **Skills exercised:** `refactor` (duplicate load pattern, inline styles); `event-modelling` (domain guard specs); `aggregate-command` pattern (extend existing aggregate).
- **What worked:**
  - Pure extension slice — no new aggregates, tables, or CDK changes. Token cost ~half of 3-A.
  - `ExecuteAndAppendAsync` extraction in refactor cleanly collapsed two identical 8-line blocks. The duplication was obvious and the fix was safe.
  - Inline styles moved to CSS in one pass; `.action-item--done` already existed in App.css, making the redundant `textDecoration` span style easy to spot.
- **What didn't:**
  - Main pipeline failed twice before passing. Both failures were pre-existing E2E flakiness from shared database state (duplicate note titles, stale notes). Two unnecessary re-run cycles.
  - The "Clear test data" CI step runs *after* E2E tests. A prior failed run can leave stale notes that corrupt the next run's strict-mode locators.
- **Change for next slice:**
  - Add a "Clear test data before E2E" step to the deploy workflow to run alongside (or just before) the E2E journey tests — not just after. Backlog item raised.
  - Scout should flag structural-only route params in the phase doc (e.g. `noteId` in `/complete` and `/reopen` is REST convention only, unused by the command handler).
