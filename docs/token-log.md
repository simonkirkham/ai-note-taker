# Token Usage Log

Approximate tokens consumed per slice, broken down by agent. Recorded by Scribe at the end of each slice. Counts come from agent hand-off summaries; round to nearest 1 000.

---

## Slice 12-G — Observability runbook + saved Logs Insights queries (closes Phase 12)

> **Note:** Mostly docs + four `CfnQueryDefinition`s, but it took **two Hawk rounds**. Hawk's first review requested changes on a wrong-log-group basis, yet its log-checking process surfaced two genuine "query returns blank/nothing" bugs (the `correlationId` non-field → BUG-8, and PascalCase-vs-snake_case projections). Both Hawk passes ran as real subagents (exact counts).

| Agent                                   | ~Tokens  |
|-----------------------------------------|----------|
| Pip (gather values, write runbook+queries+tests, 2 fix rounds, merge/deploy, Scribe, BUG-8) | 100 000 |
| Hawk (round 1 — requested changes)      | 59 000   |
| Hawk (round 2 — approved)               | 39 000   |
| **Total**                               | **~198 000** |

**Why:** higher than a typical docs slice because the queries had to be verified against *real* prod logs, not just synth — and that verification (correct vs stale log group; snake_case field names; correlationId absence) is exactly what caught the two latent bugs before merge. The up-front prod-log inspection during authoring (checking `command_type`/`stream_id`/`xray_trace_id` actually exist) would have pre-empted Hawk round 1.

**Optimisation suggestions:**
- **Author against real logs first (≈ –50 000).** For any Logs Insights / dashboard / query deliverable, run the filters against the live log group while writing them. Both Hawk rounds were spent discovering field names that one `filter-log-events` probe at authoring time would have revealed.
- **Resolve the real log group once, up front.** The wrong-log-group false alarm cost a full review round; `get-function-configuration --query LoggingConfig` settles it immediately.

---

## Slices 12-E + 12-H — Alarms/SNS and Unified error view (parallel run, with a deploy-break recovery)

> **Note:** Run in parallel worktrees at the user's request. Both implementation agents and all reviewers ran as real subagents (their counts are exact from hand-offs). 12-E shipped a deploy-breaking bug (`SEARCH` on a metric alarm) that passed Hawk + synth and only failed at `cdk deploy`; recovering it (hotfix BUG-class fix + re-rebasing 12-H onto the corrected main, re-resolving the shared-file conflict) is the bulk of the orchestration cost.

| Agent                                   | ~Tokens  |
|-----------------------------------------|----------|
| Pip-12E (impl subagent)                 | 78 000   |
| Pip-12H (impl subagent)                 | 59 000   |
| Hawk-12E                                | 48 000   |
| Hawk-12H                                | 47 000   |
| Pip (orchestration: spawn, 2× conflict resolve, 12-E deploy-break hotfix, 4 deploy monitors, Scribe) | 140 000 |
| **Total**                               | **~372 000** |

**Why so high:** this is ~2× a normal two-slice cost, almost entirely from the parallel-on-a-shared-file choice plus the deploy-break. The shared `NoteTakerStack.cs`/`InfraAssertionsTests.cs` conflicted on every merge; 12-E's SEARCH-alarm break forced a second full rebase + conflict re-resolution of 12-H against the fixed main, and an extra hotfix slice (PR + deploy). Two of this phase's deploy-breakers (RUM CDN host, SEARCH-on-alarm) were invisible to synth/`Template.FromStack`/Hawk and only failed at real deploy — each costing a full diagnose→fix→redeploy cycle.

**Optimisation suggestions:**
- **Sequential would have been cheaper here (≈ –120 000).** Two slices sharing one file is the anti-pattern for parallel worktrees: no clean-merge benefit, double conflict resolution, and a break in one stalled the other. Reserve parallel worktrees for disjoint-file slices.
- **Catch deploy-only failures earlier (≈ –60 000 across the phase).** A `cdk deploy` into a throwaway/sandbox stack (or even `cdk deploy --no-execute` + change-set inspection) on risky infra (alarms, RUM, cross-service ARNs) would surface "SEARCH not supported on alarms" / "host doesn't resolve" before merging to main, avoiding the red-main hotfix cycles. Synth alone is not a deploy gate.

---

## BUG-3 / BUG-4 / BUG-5 — backend defect sweep (one session)

> **Note:** Three bugs driven through the full pipeline in a single autonomous session. BUG-4+BUG-5 shipped as one slice (shared cross-cutting fix, PR #107); BUG-3 as a second slice in parallel (PR #108). Pip/Breaker were the main loop, not separate agents — only Hawk and Scribe figures are per-agent.

| Agent     | ~Tokens     |
|-----------|-------------|
| Hawk (PR #107, BUG-4+5) | 58 000 |
| Hawk (PR #108, BUG-3)   | 37 000 |
| Scribe (all three)      | 18 000 |
| Main loop (explore + implement both slices + drive pipeline) | ~120 000 |
| **Total** | **~233 000** |

**Why:** Each PR was approved by Hawk on the first pass (no fix rounds) — both verdicts were APPROVE with only optional nits. Cost was dominated by the up-front backend exploration shared across all three bugs (reading the command handler, aggregate, exception types, and test infrastructure to design reproduce-first tests) plus running two slices end-to-end. No wasted deploys. A mid-session coordination cost came from the primary checkout being dirty/divergent, which moved Scribe to a separate worktree.

---

## Slice 12-F — Frontend monitoring (CloudWatch RUM)

> **Note:** A fresh slice resumed after a VS Code crash — but the crash interrupted only the *review* of Phase 12 state, not in-flight slice work (nothing was lost). 12-F was planned and built from scratch this session. Plan and Hawk ran as real subagents (Hawk's 45k is exact from its hand-off); other counts are estimates.

| Agent                                  | ~Tokens  |
|----------------------------------------|----------|
| Plan (design + AWS-docs verification)  | 45 000   |
| Pip (Breaker + implement + orchestration) | 95 000 |
| Hawk                                   | 45 000   |
| Scribe                                 | 11 000   |
| **Total**                              | **~196 000** |

**Why:** No Hawk rework — approved first pass with only nits, because the Plan agent had already resolved the one non-obvious design point (the Cognito identity pool + guest role that `CfnAppMonitor` doesn't auto-create) against AWS docs *before* implementation. The dominant cost was Pip's orchestration: full `dotnet publish` + `cdk synth`, a real `npm run build` to confirm Vite preserves the snippet placeholder, the injection dry-run, the pre-commit hook running the *entire* suite (137 domain + 197 API + 51 infra + 213 component tests, several minutes in WSL), and the deploy monitor. The up-front Plan agent (45k) paid for itself by eliminating a Hawk round-trip on the missing Cognito wiring.

**Optimisation suggestions:**
- **None on Plan/Hawk:** spending 45k on design to get a first-pass Hawk approval on a slice with a genuine hidden requirement is the target trade, not waste.
- **Pip (–10 000):** the manual `cdk synth` + infra-test run before commit duplicated what the pre-commit hook + CI re-run anyway; for an infra-only slice already covered by `Infrastructure.Assertions`, one of those passes is redundant.

---

## BUG-2 — favicon.ico 404 on every page load

> **Note:** A recovery slice. The fix (Breaker + Pip) was written and staged in a prior session; a VS Code crash interrupted it before the first commit. This session only resumed the pipeline — verify, commit, PR, Hawk, merge, deploy, Scribe — so Breaker/Pip implementation cost is not attributable here.

| Agent     | ~Tokens     |
|-----------|-------------|
| Scout     | —           |
| Breaker   | (prior session) |
| Pip       | (prior session) |
| Stylist   | —           |
| Hawk      | 28 000      |
| Scribe    | 9 000       |
| **Total (this session)** | **~37 000** |

**Why:** Trivial frontend fix; Hawk approved first pass with only optional nits. The only non-routine cost was Scribe handling a collision with a large unrelated uncommitted docs reorg in the main checkout (surfaced to the human, selective commit).

---

## Slice 9-F — Recurring meetings: create note for next occurrence

| Agent     | ~Tokens      |
|-----------|--------------|
| Scout     | —            |
| Breaker   | —            |
| Pip       | 50 000       |
| Stylist   | —            |
| Hawk 1    | 49 000       |
| Hawk 2    | 31 000       |
| Scribe    | 5 000        |
| **Total** | **~135 000** |

**Why:** Two Hawk passes (80k combined) dominated cost. First pass found six blocking issues: `MaxResults=1` + cancelled-filter bug, missing input validation, dead `TodayCalendarEventId` field, non-optimistic UI update, Open-Note navigating to empty string on page reload, and sequential GSI queries. All fixed in one round; Hawk 2 approved cleanly.

---

## Hotfix — TRANSCRIBE_ROLE_ARN production 503

| Agent     | ~Tokens      |
|-----------|--------------|
| Scout     | —            |
| Breaker   | —            |
| Pip       | 95 000       |
| Stylist   | —            |
| Hawk      | —            |
| Scribe    | 4 000        |
| **Total** | **~99 000**  |

**Why:** Three failed fix deploys before root cause was identified — the investigative cycle of synth → inspect → deploy → check production consumed most of the budget. The stale-alias mechanism wasn't surfaced until the fourth session, after the CDK template, SnapStart, and placeholder theories had been ruled out one by one.

**Optimisation suggestions:**
- **Pip (–40 000):** Two of the three fix deploys were unnecessary once the stale-alias root cause was understood. Earlier comparison of `ApiFunctionCurrentVersion<hash>` across synths would have revealed the hash wasn't changing after commit 1, saving the second and third deploy rounds.

---

## Slice 10-D — Manual analysis via Bedrock

> **Note:** Session exhausted context and was auto-compacted mid-implementation. Figures below are estimates; Hawk 1 count is exact from the agent hand-off summary.

| Agent     | ~Tokens      |
|-----------|--------------|
| Scout     | —            |
| Breaker   | 20 000       |
| Pip       | 250 000      |
| Stylist   | —            |
| Hawk 1    | 51 000       |
| Hawk 2    | 35 000       |
| Scribe    | 15 000       |
| **Total** | **~371 000** |

**Why:** Pip spanned two sessions (context compaction mid-slice) and carried two Hawk passes — Hawk 1 returned REQUEST CHANGES on five issues (missing constructor-read for `BEDROCK_MODEL_ID`, `AmazonBedrockRuntimeException` not caught, no action-item dedup, error not surfaced in UI, `FakeBedrockAnalysisService` state not reset in constructor), all requiring rework before Hawk 2 approved.

---

## Slice 9-D — One-click create note from a meeting

> **Note:** Session exhausted context and was auto-compacted. Exact per-agent counts unavailable. Figures below are estimates from the session summary.

| Agent     | ~Tokens      |
|-----------|--------------|
| Scout     | —            |
| Breaker   | 15 000       |
| Pip       | 85 000       |
| Stylist   | —            |
| Hawk 1    | 45 000       |
| Hawk 2    | 30 000       |
| Scribe    | 5 000        |
| **Total** | **~180 000** |

**Why:** Two Hawk passes (75k combined) dominated cost. First pass found three issues: missing user-isolation in 409 guard (cross-user blocking), silent frontend errors (no catch block), and missing `onOpenNote` prop in component tests. Second pass found one more: `GET /calendar/today` leaking other users' `linkedNoteId`. All fixed; third pass approved. A post-merge CI failure (`onOpenNote` missing in `TagFilter.test.tsx`) required a follow-up fix commit — running `tsc -p tsconfig.test.json --noEmit` before push would have caught it.

---

## Slice 3-A — Add action items on the note screen

> **Note:** Session exhausted context and was auto-compacted. Exact per-agent counts unavailable. Figures below are estimates from the session summary.

| Agent     | ~Tokens |
|-----------|---------|
| Scout     | 18 000  |
| Breaker   | 25 000  |
| Pip       | 95 000  |
| Stylist   | —       |
| Hawk      | 35 000  |
| Scribe    | 10 000  |
| **Total** | **~183 000** |

**Why:** First cross-aggregate slice with new aggregate + projection + CDK table + React component + E2E journey; Pip's context was auto-compacted mid-session; Hawk ran two `Changes requested` rounds before approving.

**Optimisation suggestions:**
- **Pip (–30–40k):** 3-A qualifies for Breaker's large-slice layer-split rule (new aggregate + projection + E2E, ≥4 criteria). Breaker should have written domain/API tests first → Pip implements those → Breaker writes E2E tests → Pip implements those. Two smaller Pip sessions instead of one auto-compacted 95k session; domain design errors caught before the expensive E2E layer is written.
- **Hawk (–15–25k):** Two `Changes requested` rounds added ~20k to Hawk's total (each round re-reads the full PR). Both findings — missing E2E test and missing GET existence guard — are now covered by Pip's Step 1d pre-PR self-check (criteria-coverage audit catches the missing E2E; guard-symmetry check catches the GET gap). Applying Step 1d before opening the PR would have collapsed Hawk to a single-pass review.

---

## Slice 3-B — Complete and reopen action items

| Agent     | ~Tokens    |
|-----------|------------|
| Scout     | — (brief already in phase doc) |
| Breaker   | 18 000     |
| Pip       | 55 000     |
| Stylist   | —          |
| Hawk      | 8 000      |
| Scribe    | 5 000      |
| **Total** | **~86 000** |

**Why:** Pure extension slice — no new aggregates, tables, or projections; Breaker and Pip worked entirely within existing infrastructure; no Hawk fix rounds.

**Optimisation suggestions:**
- **Stylist (–0, but process gap):** Stylist was skipped entirely — Pip moved from refactor directly to PR. Six CSS issues were caught retrospectively (missing focus ring, no accent-color on checkbox, no disabled state, no transition on done toggle, dangling last-child border, missing input glow). Pip's new Step 1c guardrail (invoke `ui-ux-pro-max` before opening a PR for any slice with React changes) closes this gap from 3-C onward.
- **CI re-runs (~2 wasted pipeline runs):** Two CI failures caused by stale E2E data from prior runs, not by 3-B changes. The "Clear test data" step runs after E2E, so a failed prior run poisons the next. Backlog item raised; adding a pre-E2E clear step would eliminate this class of re-run.

---

## Slice 3-C — View open todos on the home screen

| Agent     | ~Tokens    |
|-----------|------------|
| Scout     | — (brief inline) |
| Breaker   | 28 000     |
| Pip       | 62 000     |
| Stylist   | 12 000     |
| Hawk      | 6 000      |
| Scribe    | 5 000      |
| **Total** | **~113 000** |

**Why:** First cross-projection slice — new DynamoDbTodoListStore, two command handlers updated, frontend component, CDK table with GSI. Layer-split (Batch 1 domain/API → Batch 2 E2E/frontend) kept each Pip session under 65k and avoided context compaction.

**Optimisation suggestions:**
- **Breaker (–5–8k):** Breaker wrote acceptance tests in Batch 2 alongside E2E. Acceptance specs are thin (4 tests, ~85 lines) and could be written by Pip as part of Batch 2 implementation — Breaker's job is to define the failing test shape, not duplicate what Pip will fill in. Saving: Breaker produces a spec skeleton; Pip fleshes it out.
- **Stylist (–3–5k):** Stylist re-read App.css in full to locate insertion point for the todo-section block. Since App.css now exceeds 380 lines, a targeted `Read` with `offset`/`limit` at the "Reduced motion" anchor would halve the read cost for future Stylist passes.

---

## Slice 3-D — Complete todos from the home screen

| Agent     | ~Tokens    |
|-----------|------------|
| Breaker   | — (criteria already in phase doc) |
| Pip       | 20 000     |
| Refactor  | 5 000      |
| Stylist   | 6 000      |
| Hawk      | 4 000      |
| Scribe    | 5 000      |
| **Total** | **~40 000** |

**Why:** No new backend — Pip only touched 5 files (TodoSection.tsx, App.css, two new test files, one extended page object). Single batch, no layer split, no Hawk change rounds.

**Optimisation suggestions:**
- **Context compaction (–2k):** Session hit the limit mid-Stylist verdict. The Stylist conclusion (no changes) was reached before compaction, but the next session spent ~2k re-orienting from the summary before continuing. Keeping Stylist + Hawk + Scribe in a single tight session after a small Pip pass avoids the cross-session overhead.

---

## Slice 3-E — Delete an action item

| Agent     | ~Tokens    |
|-----------|------------|
| Breaker   | 8 000      |
| Pip       | 28 000     |
| Refactor  | 4 000      |
| Stylist   | 5 000      |
| Hawk      | 5 000      |
| Scribe    | 5 000      |
| **Total** | **~55 000** |

**Why:** Extension slice (no new aggregate/projection/CDK). Layer-split kept both Pip batches small. 20 files changed but most were targeted additions — no large re-reads required.

**Optimisation suggestions:**
None — slice ran within expected range.

---

## Slice 4-A — Settable note date

| Agent          | ~Tokens    |
|----------------|------------|
| Breaker Batch 1| 12 000     |
| Pip Batch 1    | 25 000     |
| Breaker Batch 2| 6 000      |
| Pip Batch 2    | 15 000     |
| Refactor       | 3 000      |
| Stylist        | 5 000      |
| Hawk           | 5 000      |
| Scribe         | 5 000      |
| **Total**      | **~76 000** |

**Why:** First Phase 4 slice — doc-fix pass (3 files) before Breaker could start, plus layer-split into two Pip batches. Backend + frontend + E2E in a clean single-event slice kept both batches well under 30k.

**Optimisation suggestions:**
- **Doc fixes (–2–3k):** Three docs files needed `ActionItemRemoved→ActionItemDeleted` correction before Breaker could write specs. If doc/code divergences were caught at the end of the slice that introduced them (3-E Scribe), this pre-4-A cleanup round would not exist.
- **Hawk (–1k):** `LastModifiedAt` not updated on `NoteDateSet` was a one-line fix that should have been caught in the Refactor pass. Add "verify all modifying events update `LastModifiedAt`" to the Refactor checklist for projection handlers.

---

## Slice 4-B — Note screen layout redesign

| Agent     | ~Tokens    |
|-----------|------------|
| Breaker   | 4 000      |
| Pip       | 6 000      |
| Refactor  | 1 000      |
| Stylist   | 1 000      |
| Hawk      | 3 000      |
| Scribe    | 4 000      |
| **Total** | **~19 000** |

**Why:** Pure frontend slice — no backend changes, no layer split. Three files changed (NoteView.tsx, ActionsSection.tsx, App.css) and a new E2E journey. Entire slice in one Pip batch well under 30k.

**Optimisation suggestions:**
None — slice ran within expected range.

---

## Slice 4-C — Implicit action item add

| Agent     | ~Tokens     |
|-----------|-------------|
| Breaker   | 2 000       |
| Pip       | 5 000       |
| Refactor  | 1 000       |
| Stylist   | 1 000       |
| Hawk      | 3 000       |
| Scribe    | 2 000       |
| **Total** | **~14 000** |

**Why:** Minimal frontend change — one component edited (ActionsSection.tsx), page object updated. Double-submit guard was the only non-obvious logic. Lightest slice in Phase 4.

**Optimisation suggestions:**
None — slice ran within expected range.

---

## Slice 4-D — Persistent note list sidebar

| Agent     | ~Tokens     |
|-----------|-------------|
| Breaker   | 3 000       |
| Pip       | 8 000       |
| Refactor  | 1 000       |
| Stylist   | 1 000       |
| Hawk      | 3 000       |
| Scribe    | 2 000       |
| **Total** | **~18 000** |

**Why:** Pure frontend slice — new Sidebar component, App.tsx restructure, ListView.tsx simplification, CSS additions. No backend or CDK changes. Backward-compat testid placement avoided any page object rewrite.

**Optimisation suggestions:**
None — slice ran within expected range.

---

## Slice 4-E — Note summary cards on home screen

| Agent     | ~Tokens      |
|-----------|--------------|
| Breaker   | 8 000        |
| Pip B1    | 35 000       |
| Pip B2    | 18 000       |
| Refactor  | 4 000        |
| Stylist   | 3 000        |
| Hawk      | 6 000        |
| Pip fixes | 5 000        |
| Scribe    | 3 000        |
| **Total** | **~82 000**  |

**Why:** Largest slice in Phase 4 — new projection (9 event handlers), DynamoDB store, CDK table, API endpoint, integration tests, CDK assertions, frontend component, E2E tests. Hawk found three must-fix issues requiring a post-review Pip pass.

**Optimisation suggestions:**
- **Hawk (–3 000):** Three of Hawk's findings (`LastModifiedAt`, `CancellationToken`, `default: break`) could have been caught by adding them to the Refactor checklist — one extra pass during Refactor saves a full Hawk→Pip→push cycle.

---

## Slice 5-A Batch 1 — Add tags to a note

| Agent     | ~Tokens     |
|-----------|-------------|
| Breaker   | 4 000       |
| Pip       | 18 000      |
| Refactor  | 3 000       |
| Hawk      | 4 000       |
| Scribe    | 3 000       |
| **Total** | **~32 000** |

**Why:** Domain was partially in-flight from a prior incomplete session; reading all key files plus implementing projection fixes, HTTP handlers, endpoints, and integration tests drove most of the token cost.

**Optimisation suggestions:**
- **Pip (–4 000):** The three `LastModifiedAt` omissions in `NoteDetailProjection`, `NoteCardListProjection`, and `NoteCommandHandler.ApplyNoteEventsToCard` could be caught mechanically during Refactor with a checklist item: "does every tag/untag `with { ... }` include `LastModifiedAt`?" — avoids Hawk needing a separate review pass for this class of bug.

---

## Slice 5-A/B Batch 2 — Tags frontend

| Agent     | ~Tokens     |
|-----------|-------------|
| Breaker   | 4 000       |
| Pip       | 3 000       |
| Refactor  | 1 000       |
| Hawk      | 1 000       |
| Scribe    | 2 000       |
| **Total** | **~11 000** |

**Why:** Pure frontend slice with a pre-existing bug fix — most components were already scaffolded, so the work was adding testids and correcting the multi-tag API call pattern.

**Optimisation suggestions:** None — slice ran within expected range.

---

## Slice 5-C Batch 1 — TagIndex projection + GET /tags

| Agent     | ~Tokens     |
|-----------|-------------|
| Breaker   | 5 000       |
| Pip       | 16 000      |
| Scribe    | 3 000       |
| **Total** | **~24 000** |

**Why:** Backend-only slice with no frontend changes. New projection + DynamoDB store + API handler + infra table — well-bounded and followed the FolderTree pattern exactly, keeping read cost low.

**Optimisation suggestions:**
- **Test isolation (–0, but pattern note):** `GetTags_ReturnsEmptyWhenNoTags` passes today but is fragile in a shared fixture if test ordering changes. Future "starts empty" assertions should be placed in their own isolated test class to be safe.

---

## Slice 5-C Batch 2 — Tag filter bar E2E + frontend wire-up

| Agent     | ~Tokens     |
|-----------|-------------|
| Pip       | 40 000      |
| Scribe    | 3 000       |
| **Total** | **~43 000** |

**Why:** Three deploy failures added substantial overhead — each required root cause analysis, a targeted fix, and a full re-deploy cycle. The failures uncovered two distinct bugs: a Playwright response-event race in `AddTagAsync` (all N handlers resolve to the same single response), and DynamoDB eventual consistency on all projection read paths (reads immediately after writes returning stale data).

**Optimisation suggestions:**
- **ConsistentRead gaps (–15 000):** Every projection store shipped without `ConsistentRead = true`, causing read-after-write failures only visible in E2E tests against deployed DynamoDB. Adding a checklist item to the projection scaffold skill — "all GetItem/Query/Scan calls must set `ConsistentRead = true` (except GSI queries)" — catches this class of bug before the first deploy.
- **Playwright WaitForResponseAsync pattern (–5 000):** The N-parallel-task pattern for waiting on N API responses is subtly broken when Playwright fires the `Response` event to all handlers simultaneously. The atomic-counter / single-listener pattern should be documented in the page object base class so future multi-call helpers don't repeat the mistake.

---

## Slice 5-D Batch 1 — Create and browse folders

| Agent     | ~Tokens     |
|-----------|-------------|
| Breaker   | 5 000       |
| Pip       | 18 000      |
| Refactor  | 1 000       |
| Hawk      | 2 000       |
| Scribe    | 3 000       |
| **Total** | **~29 000** |

**Why:** New aggregate with a single command, one projection, one DynamoDB table, and two HTTP endpoints — a well-bounded slice with no frontend in this batch.

**Optimisation suggestions:**
- **Test isolation (–0, but pattern note):** The "returns empty" scenario requires its own test class because `IClassFixture<ApiFactory>` shares state within a class. Future slices with similar "starts empty" assertions should put them in a dedicated class from the start rather than discovering the failure at test run time.

---

## Slice 5-D Batch 2 — Folders Frontend Wire-Up

| Agent     | ~Tokens    |
|-----------|------------|
| Breaker   | 4 000      |
| Pip       | 12 000     |
| Refactor  | 2 000      |
| Hawk      | 2 000      |
| Scribe    | 3 000      |
| **Total** | **~23 000** |

**Why:** Pure frontend slice wiring completed backend endpoints. Removing localStorage scaffolding, adding data-testids, and updating ListView filtering was straightforward with no new domain logic.

**Optimisation suggestions:**
- None — slice ran within expected range.

---

## Slice 5-M — Note date defaults to today

| Agent     | ~Tokens |
|-----------|---------|
| Breaker   | 8 000   |
| Pip       | 12 000  |
| Refactor  | 3 000   |
| Hawk      | 4 000   |
| Scribe    | 4 000   |
| **Total** | 31 000  |

**Why:** Frontend-only slice with no new aggregates or projections; the backend was pre-built, keeping scope narrow.

**Optimisation suggestions:**
- None — slice ran within expected range.

---

## Slice 5-EFGHIJKL — Folder rename/delete/move/cascade + note filing

| Agent     | ~Tokens     |
|-----------|-------------|
| Pip       | 200 000     |
| Hawk 1    | 78 000      |
| Hawk 2    | 62 000      |
| Scribe    | 10 000      |
| **Total** | **~350 000** |

**Why:** Pip ran high due to the scale of combining 8 sub-slices into one PR, a workflow correction (started implementation on main instead of a worktree requiring stash/re-apply), and two full Hawk review rounds (six findings in pass 1: UnfileNotesInFolderAsync projection bypass, RenameFolder 404/400 mismatch, no-op guard missing, CycleDetectedException placement, MoveNoteToFolder folder-existence check, TypeScript null vs optional type).

**Optimisation suggestions:**
- **Hawk double-round (–62 000):** Six of the eight findings were pre-empt-able with a pre-PR checklist pass: cross-aggregate handlers must delegate to the target handler (not bypass), each aggregate needs its own `XNotFoundException`, and type changes from optional to required must grep test fixtures. Embedding these as a pre-PR checklist in the refactor skill would catch them before Hawk.
- **Workflow correction (–10 000):** Pip started on main instead of the worktree despite the guardrail. The recovery was fast but the extra turns added context overhead. No guardrail change — the rule exists and was read; purely execution discipline.

---

## Phase 6 — Upgrade to .NET 10

| Agent            | ~Tokens     |
|------------------|-------------|
| Plan             | 8 000       |
| Pip 6-A          | 18 000      |
| Refactor 6-A     | 1 000       |
| Hawk 6-A         | 3 000       |
| Pip 6-B          | 20 000      |
| CI monitoring    | 3 000       |
| Hawk 6-B (×2)    | 7 000       |
| Pip 6-B fixes    | 3 000       |
| Scribe           | 5 000       |
| **Total**        | **~68 000** |

**Why:** Multiple CI failures added overhead beyond the csproj edits themselves — CS0414 on `Folder._exists`, cdk synth asset path mismatch, and three stale `net8.0` references in GitHub Actions workflow files all required separate fix commits. Hawk's initial pass caught two issues (runtime assertion missing, no spec for `_exists` guard) requiring a second review round.

**Optimisation suggestions:**
- **CI failures (–10 000):** A pre-commit grep for `net8.0`/`dotnet8` in non-csproj files would have caught the workflow file and `aws-lambda-tools-defaults.json` issues before the first push, collapsing three fix commits into zero.
- **Hawk round 2 (–3 000):** The missing `Lambda_RuntimeIsDotnet10` InfraAssertions test is a mechanical gap — any CDK constant change without a corresponding assertion should be caught by Refactor, not Hawk. Adding "verify CDK constants have InfraAssertions coverage" to the Refactor checklist eliminates this class of Hawk finding.

---

## Slice 6.5-B — Vitest scaffold

| Agent     | ~Tokens    |
|-----------|------------|
| Breaker   | 8 000      |
| Pip       | 20 000     |
| Hawk      | 35 000     |
| Scribe    | 4 000      |
| **Total** | **~67 000** |

**Why:** Pip ran high due to multi-round CI debugging — the initial vitest 4.x lock-file desync required diagnosing the npm 11/Node 24 vs Node 20 discrepancy, then a second push to address all four of Hawk's findings. Hawk itself ran high (measured at 35k) because it needed to read the full PR diff and CI failure logs before forming its verdict.

**Optimisation suggestions:**
- **Pip (–8 000):** The vitest 4→2 downgrade required two CI round-trips. Checking the npm/Node version match between local dev and CI before installing new tooling packages (esp. ones with native bindings) would have avoided this. Rule: `node --version` on dev and CI must match before generating a lock file for a new package.

---

## Slice 6.5-C — Home screen component tests

| Agent     | ~Tokens    |
|-----------|------------|
| Pip       | 55 000     |
| Hawk      | 10 000     |
| Scribe    | 5 000      |
| **Total** | **~70 000** |

**Why:** Two blocking main-deploy failures (ConsistentRead on event store, DynamoDB empty-string rejection) required separate fix PRs before 6.5-C could merge, adding substantial root-cause and deploy-cycle overhead. Hawk caught 2 findings (missing POST-capture assertion, missing negative test) requiring a fix+re-push round.

**Optimisation suggestions:**
- **Deploy failures (–15 000):** The ConsistentRead and DynamoDB empty-string bugs were pre-existing in production. A pre-merge checklist item — "does any path write then immediately read the same stream or projection without ConsistentRead?" — would have surfaced these during 5-C Batch 2 instead of re-surfacing as deploy failures during 6.5-C. The DynamoDB S attribute guard (`string.IsNullOrEmpty → NULL = true`) should be part of the projection scaffold template.
- **Hawk findings (–3 000):** Both findings (POST-capture closure and negative-space assertion) are now documented patterns in learnings. Adding them to the component-test review checklist in Refactor would pre-empt the round-trip.

---

## Slice 6.5-D — Note view component tests

| Agent     | ~Tokens    |
|-----------|------------|
| Pip       | 35 000     |
| Hawk      | 10 000     |
| Scribe    | 5 000      |
| **Total** | **~50 000** |

**Why:** Two Hawk rounds added overhead — first pass caught missing call-verification in "renders content" and "date defaults to today" tests; fixes were targeted and clean. Scribe was delayed ~2h by a stuck GitHub Actions runner (infrastructure issue, not code).

**Optimisation suggestions:**
- **Hawk round 2 (–3 000):** Both findings (GET-call verification, PATCH auto-call verification) are extensions of the POST-capture pattern codified in 6.5-C. Adding "verify ALL fetches in component tests, not just user-triggered mutations — include load-triggered side effects" to the Refactor skill's component-test section would pre-empt this Hawk round.

---

## Slice 7-A — Base editor, markdown storage, stripped preview

| Agent     | ~Tokens     |
|-----------|-------------|
| Breaker   | 15 000      |
| Pip       | 45 000      |
| Hawk 1    | 40 000      |
| Hawk 2    | 37 000      |
| Scribe    | 10 000      |
| **Total** | **~147 000** |

**Why:** Two Hawk rounds drove the total above the frontend-slice baseline (~20–50k). The first Hawk pass surfaced a critical stale-closure bug (React 18 batching + closure capture) plus five important issues (null guard, ordered-list regex gap, `immediatelyRender`, type augmentation, dropped placeholder). The fix pass then triggered a second Hawk round for final approval. No CI failures.

**Optimisation suggestions:**
- **Hawk round 1 (–37 000):** Five of the seven findings are pre-emptable before opening a PR: (1) stale-closure risk when replacing DOM event value reads with React state — add a `contentRef` pattern to the Refactor checklist whenever a `onChange`/`onBlur` pair is introduced; (2) `immediatelyRender: false` and type augmentation are TipTap-specific setup items that should be in a TipTap onboarding checklist; (3) null/empty guard and compiled-regex in hot paths are Refactor checklist items for any method called per-request; (4) ordered-list regex gap — any bullet-stripping regex must include an ordered-list variant.

---

## Slice 7-B — Mark heading as discussed + shortcuts panel

| Agent     | ~Tokens      |
|-----------|--------------|
| Breaker   | 12 000       |
| Pip       | 45 000       |
| Hawk 1    | 30 000       |
| Hawk 2    | 20 000       |
| Scribe    | 10 000       |
| **Total** | **~117 000** |

**Why:** Two Hawk rounds drove the total above the frontend-slice baseline — first pass found three issues (Y-position off by half line-height, missing `onFocus` handler, ShortcutsPanel lacking Escape/click-outside dismissal); each required targeted fixes before the second-pass approval.

**Optimisation suggestions:**
- **Hawk round 1 (–20 000):** All three findings are pre-emptable: floating button Y should use midpoint `(top+bottom)/2` (add to TipTap checklist); cursor-tracking UI must wire `onFocus` alongside `onSelectionUpdate` (add to NoteEditor extension pattern); collapsible panels must include Escape + mousedown-outside dismissal (add to Refactor UI checklist). Catching these in Refactor would have collapsed two Hawk rounds into one.

---

<!-- Scribe: append one section per completed slice using this template:

## Slice <id> — <name>

| Agent     | ~Tokens    |
|-----------|------------|
| Scout     |            |
| Breaker   |            |
| Pip       |            |
| Stylist   |            |
| Hawk      |            |
| Scribe    |            |
| **Total** |            |

**Why:** <one sentence on what drove the total>

**Optimisation suggestions:**
- **<Role> (–<estimated saving>):** <what happened and what to do differently>

If no agent ran unexpectedly high: write `None — slice ran within expected range.`

-->

## Phase 7.5 — Folder UX fixes and Lambda performance (6 slices: A–F)

> **Note:** Phase 7.5 ran across two sessions with context compaction. Per-agent counts are estimates from session summaries.

| Agent     | ~Tokens |
|-----------|---------|
| Scout     | — |
| Breaker   | 15 000 |
| Pip       | 180 000 |
| Stylist   | — |
| Hawk      | 75 000 |
| Scribe    | 8 000 |
| **Total** | **~278 000** |

**Why:** Six independent slices × two Hawk rounds on 7.5-F (subfolder test timing bug) drove the total above a typical single-slice phase; Pip's count reflects 6 distinct worktree implementations plus fixes across two sessions.

**Optimisation suggestions:**
- **Hawk 7.5-F round 2 (–25 000):** The deferred-Promise pattern for optimistic tests was established in 7.5-D but not applied to the subfolder success test in 7.5-F. Applying it upfront would have collapsed two Hawk rounds into one. Add to Breaker checklist.

---

## Slice 7.8-A — Production deployment pipeline

> **Note:** Manual setup slice — no agents ran. Token cost reflects one guided conversation session with the developer.

| Agent     | ~Tokens    |
|-----------|------------|
| Scribe    | 5 000      |
| **Total** | **~5 000** |

**Why:** Pure infrastructure setup (AWS account, IAM, CDK bootstrap, GitHub environment). The only code change was adding the `deploy-production` job to `deploy.yml`.

**Optimisation suggestions:**
- **Setup friction (–0, but doc gap):** The spec stated `deploy-production` was "already in place" but it was not in `deploy.yml`. Verifying "already in place" claims against actual files before starting a slice would save a discovery round.

---

## Slice 7.8-G — Domain event dispatcher

| Agent     | ~Tokens      |
|-----------|--------------|
| Pip       | 20 000       |
| Hawk 1    | 58 000       |
| Hawk 2    | 46 000       |
| Scribe    | 5 000        |
| **Total** | **~129 000** |

**Why:** Two Hawk rounds drove the total — Hawk 1 flagged a correctness bug (wrong soft-delete timestamp using `events[0]` instead of the actual `NoteDeleted` envelope) plus a namespace concern (assessed as a false alarm). Hawk 2 approved after fixes.

**Optimisation suggestions:**
- **Hawk round 1 (–46 000):** The soft-delete timestamp bug (`events[0]` vs the actual `NoteDeleted` envelope) is a direct analogue of the "wrong index in a batch" class of error. Adding a Refactor checklist item — "when reading a timestamp from an event batch, always locate the specific event by type rather than assuming its position" — would catch this before Hawk.

---

## Phase 7.8 — Production Pipeline and Note Screen UX (5 active slices: B–F)

> **Note:** Phase 7.8 ran across two sessions with context compaction. Per-agent counts are estimates from session summaries. 7.8-A (production pipeline) deferred — manual AWS/GitHub setup, no code slice.

| Agent     | ~Tokens      |
|-----------|--------------|
| Pip       | 215 000      |
| Hawk      | 95 000       |
| Scribe    | 10 000       |
| **Total** | **~320 000** |

**Why:** Five independent slices in one session drove Pip high (7.8-F alone refactored three files plus tests; 7.8-C added a hotfix PR after E2E failures post-deploy). Hawk ran high due to multiple two-round reviews: 7.8-C (save-button loading guard + dialog accessibility + two missing tests), 7.8-D (dragLeave flicker + alreadyHere guard + optimistic/revert tests), and 7.8-E (4 flex chain issues). The 7.8-C E2E hotfix (PR #56) added an extra deploy cycle — AppPage.GoBackAsync was not updated in the same PR as the navigation model change.

**Optimisation suggestions:**
- **7.8-C hotfix deploy cycle (–20 000):** The E2E page object method `GoBackAsync` referenced the old `back-button` testid. Updating AppPage.cs in the same PR as the navigation model change would have prevented the separate hotfix PR and extra deploy round.
- **Hawk multi-round (–30 000):** Most findings across 7.8-C, 7.8-D, and 7.8-E are pre-emptable in Refactor: dialog ARIA attributes, dragLeave child guard, `flex:` on grid vs flex children, `min-height: 0` pairing. Adding these to the Refactor CSS/DnD checklist collapses two-round reviews into one.

---

## Slice 7.8-I — Read-only smoke suite

| Agent     | ~Tokens    |
|-----------|------------|
| Pip       | 25 000     |
| Hawk      | 46 000     |
| Scribe    | 5 000      |
| **Total** | **~76 000** |

**Why:** Hawk's single-pass review of a 2-file PR drove the total above the typical test-only slice baseline; loading all five handler files to verify assertion shapes was thorough but expensive for the change size.

**Optimisation suggestions:**
- **Hawk (–20 000):** For test-only PRs where assertions are self-evidently correct (status code + top-level property name), Hawk could scope reads to only the handler files called by the new specs rather than all five handlers. A targeted read saves ~20k with equivalent confidence.

---

## Slice 7.8-H — Human-readable URLs

> **Note:** Slice ran across two sessions with context compaction due to an extended CI debugging cycle (7 successive deploy failures). Per-agent counts are estimates.

| Agent     | ~Tokens      |
|-----------|--------------|
| Pip       | 185 000      |
| Hawk      | 12 000       |
| Scribe    | 7 000        |
| **Total** | **~204 000** |

**Why:** Seven successive deploy failures required reading CI logs, diagnosing root causes, and pushing a fix for each — each cycle burning 15–25k tokens. Root causes included CDK bootstrap gap, cross-account DNS limitations, GitHub empty-string secrets, missing `AllowedMethods`, `SaveAndReturnAsync` race condition, and CloudFront error-response / API-code conflict.

**Optimisation suggestions:**
- **Pip (–60 000):** Three of the seven failures (empty-string guards, AllowedMethods, SPA error responses) are pre-emptable by Breaker: the CDK skill checklist and infra-assertions spec could mandate `string.IsNullOrEmpty()` on all optional props, `AllowedMethods.ALLOW_ALL` on API behaviors, and a SPA-routing function rather than error responses. Catching these before the first deploy would eliminate 3–4 fix cycles.
- **Pip (–20 000):** The `SaveAndReturnAsync` race condition was a pre-existing gap in the page object, not introduced by this slice. A page-object review checklist (every click that triggers an API call must await a `WaitForResponseAsync`) would surface this class of issue at Breaker time rather than during E2E debugging.

---

## Slice 8-A — CDK + CORS wiring

| Agent     | ~Tokens    |
| --------- | ---------- |
| Scout     | —          |
| Breaker   | 10 000     |
| Pip       | 20 000     |
| Hawk      | 65 000     |
| Scribe    | 4 000      |
| **Total** | **~99 000** |

**Why:** Two Hawk review rounds — the spec contained a CDK template assertion for CORS that assumed API Gateway manages CORS, but the stack delegates CORS to ASP.NET Core middleware. Hawk caught the mismatch on the first review; a fix commit and second review added ~25k tokens.

---

## Slice 8-B — Google Sign-In on the frontend

| Agent     | ~Tokens     |
| --------- | ----------- |
| Scout     | —           |
| Breaker   | 12 000      |
| Pip       | 65 000      |
| Hawk      | 70 000      |
| Scribe    | 8 000       |
| **Total** | **~155 000** |

**Why:** Two Hawk review rounds (~40k + ~29k). Round 1 found a missing OAuth `state` CSRF parameter and a silent `.catch(() => {})` leaving users stuck after a failed token exchange. Both are subtle security/UX gaps not covered by the spec scenarios; Pip fixed in a single commit and Hawk approved on round 2. A post-merge E2E deploy failure required a third hotfix PR (#66) — the frontend auth gate blocked all E2E journeys because `VITE_GOOGLE_CLIENT_ID` is unset in the test environment. Three Hawk reviews total.

**Optimisation suggestions:**
- **Hawk (–25 000):** The missing `state` parameter and the E2E bypass are both standard PKCE/test-environment checklist items. Adding them to Breaker's auth spec template would catch both before the PR opens and collapse three Hawk rounds to one.
- **Pip (–10 000):** FolderNavigation and FolderMutations tests failed because `render(<App />)` without an `AuthProvider` returned the sign-in screen. Breaker's spec should explicitly list "wrap all existing `render(<App />)` calls in an `AuthProvider initialToken=...`" when a slice adds an auth gate to App.
- **Pip (–8 000):** The E2E bypass (no-auth when `VITE_GOOGLE_CLIENT_ID` is empty) should be in the 8-B spec, not discovered at deploy time. A "test environment compatibility" section in the spec prevents the post-merge hotfix cycle.

---

## Slice 8-B fixes — backend token exchange and layout hotfix

| Agent     | ~Tokens     |
| --------- | ----------- |
| Scout     | —           |
| Pip       | 40 000      |
| Hawk      | 79 000      |
| Scribe    | 5 000       |
| **Total** | **~124 000** |

**Why:** Two post-merge production bugs required fix PRs. (1) Sign-out button placed as a direct grid child of `.app-layout` broke the CSS column layout — fixed via PR #67 (Hawk approved, 14k). (2) Google's token endpoint requires `client_secret` for Web Application OAuth clients even with PKCE; browser-side code exchange was not possible — fixed by adding `POST /auth/token` backend endpoint via PR #68 (two Hawk rounds: 52k + 27k).

---

## Slice 9-E — Browser reminder hook and notification permission banner

| Agent     | ~Tokens    |
| --------- | ---------- |
| Scout     | —          |
| Breaker   | —          |
| Pip       | 52 000     |
| Hawk      | 35 000     |
| Scribe    | 5 000      |
| **Total** | **~92 000** |

**Why:** Two Hawk passes. First pass found: array-identity timer churn (critical), alert-for-"default" UX bug (important), missing handleEnable exception safety, and banner test isolation gap. All four fixed cleanly with no rework. Second pass approved immediately (34 k). The slice also required a rebase onto main after 9-B landed, with a MeetingsSection conflict resolution that combined both components.

**Optimisation suggestions:**
- **Pip (–10 000):** The array-identity bug and the "default" vs "denied" distinction are both predictable hooks-with-dependency-array gotchas. A `useMeetingReminders` spec comment ("pass a stable reference") would have caught the former before Hawk; the three-way permission split should be in the phase doc spec to catch the latter.
- **Hawk (–15 000):** Second pass was light (34 k). If Breaker's spec explicitly covers the stable-reference contract and permission states, first-pass findings collapse from 4 to 1–2, making a single-pass review achievable.

---

## Slice 9-B — Google Calendar API pass-through

| Agent     | ~Tokens     |
| --------- | ----------- |
| Scout     | —           |
| Breaker   | —           |
| Pip       | 95 000      |
| Hawk      | 45 000      |
| Scribe    | 5 000       |
| **Total** | **~145 000** |

**Why:** Hawk made two passes (10 findings first pass → all fixed → approved). Root causes: (1) Google SDK `Items` null behaviour is not in any local skill doc; (2) all-day event timezone parsing is a subtle edge case; (3) IDisposable leak is easy to miss with unfamiliar SDK. All five blocking fixes were correct on first attempt; no fix-revert cycle.

**Optimisation suggestions:**
- **Pip (–10 000):** The `events.Items ?? []` null guard and `using var` disposal are both defensive patterns for Google SDK types. Adding a `google-calendar-sdk` section to the cdk-stack-update skill (or a new google-apis skill) would surface these before Hawk.
- **Hawk (–15 000):** Both passes could be compressed to one if Breaker's spec includes a checklist item: "all-day events have `Date` not `DateTime` — test the timezone boundary explicitly."

---

## Slice 9-G — CDK wiring (CalendarLinkIndex table + SSM grant)

| Agent     | ~Tokens    |
| --------- | ---------- |
| Scout     | —          |
| Breaker   | 12 000     |
| Pip       | 12 000     |
| Hawk      | 44 000     |
| Scribe    | 5 000      |
| **Total** | **~73 000** |

**Why:** Hawk dominated at 44 k (60% of total). Root cause: initial SSM IAM test asserted only Action+Effect and lacked a negative test for the conditional guard. Both findings required a fix commit and a second review pass (~22 k). The assertions are a non-obvious CDK pattern (Fn::Join resource matching + `Record.Exception` negative guard) not covered by existing skill guidance.

**Optimisation suggestions:**
- **Hawk (–20 000):** Both findings are now documented in cdk-stack-update SKILL.md. Breaker should apply both patterns when writing any conditional IAM grant test, collapsing Hawk to a single-pass review.

---

## Slice 8-C/D — JWT Bearer auth + per-user data isolation (+ post-merge hardening)

> **Note:** Session was auto-compacted mid-slice. Counts are estimates from context summary and commit history. 8-C, 8-D, IDOR fixes, smoke test auth, E2E auth bypass, and CI token exchange are combined here as they ran in a single extended pipeline.

| Agent     | ~Tokens      |
|-----------|--------------|
| Scout     | —            |
| Breaker   | 20 000       |
| Pip       | 180 000      |
| Hawk      | 25 000       |
| Scribe    | 8 000        |
| **Total** | **~233 000** |

**Why:** IDOR gap (ownership checks absent from the spec) discovered by Hawk after merge generated 12 new integration tests and ownership guards across 8 handlers. Smoke test auth, E2E auth bypass, and CI token-exchange secret gaps each required one or more deploy cycles — seven post-merge commits total. Context was auto-compacted once.

**Optimisation suggestions:**
- **Pip (–60 000):** IDOR gap, smoke auth, and E2E bypass are all pre-emptable by Breaker: a standard auth-slice checklist (ownership guard, smoke fixture criterion, E2E token criterion) would have caught all three before the PR opened, collapsing seven post-merge fix commits to zero.
- **Pip (–20 000):** CI environment-secret gaps (Test environment missing `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`) required three deploy cycles to diagnose. A comment in deploy.yml listing required secrets per environment would surface this at secret-setup time, not at deploy-fail time.

## Hotfix — Auth token persistence

> No Scout/Breaker/Hawk agents — single-session diagnosis and fix.

| Agent     | ~Tokens    |
| --------- | ---------- |
| Pip       | 18 000     |
| Scribe    | 3 000      |
| **Total** | **~21 000** |

**Why:** Minimal change (3 files, ~45 lines). Token cost reflects reading auth code, diagnosing the React effect-ordering race, producing the guard fix, and diagnosing the follow-up E2E regression from the same session.

---

## Slice 10-B — Live transcript

> **Note:** Session was auto-compacted mid-slice (pre-compaction covered full backend + frontend implementation). Post-compaction session handled two Hawk fix rounds, rebase conflict resolution, and a post-merge lint hotfix. No separate Scout or Breaker agent — roles were combined in the same session.

| Agent                                       | ~Tokens      |
| ------------------------------------------- | ------------ |
| Breaker/Pip (pre-compaction implementation) | 150 000      |
| Pip (post-compaction fixes + rebase)        | 80 000       |
| Hawk Round 1                                | 65 000       |
| Hawk Round 2                                | 69 000       |
| Scribe                                      | 10 000       |
| **Total**                                   | **~374 000** |

**Why:** Two Hawk rounds (six combined findings) drove ~50k of rework, and context compaction mid-implementation added overhead from context reconstruction. The post-merge lint error (`done` never reassigned after `_endStream` removal) required an emergency hotfix commit to main, indicating lint was not re-run after the second fix commit.

**Optimisation suggestions:**
- **Hawk (–30 000):** Five of the six findings were preventable: (1) missing try/catch for AWS SDK exceptions is a standard pattern for any new AWS service call — add to Pip's pre-PR self-check; (2) deprecated `ScriptProcessorNode` could be caught by a "deprecated browser API" note in the frontend-ui-engineering skill; (3) CSS class not wired to component — Pip should verify every new CSS selector has a corresponding JSX className; (4) time-dependent fake credentials — add "use far-future dates in fakes" to the test-driven-development skill; (5) CDK assertion scope — covered by existing cdk-stack-update skill but not checked by Breaker.
- **Post-merge lint hotfix (–10 000):** Re-run `npm run lint` after every fix commit, not just after the full implementation pass. The `done` variable issue was introduced in the second fix commit and would have been caught immediately.

---

## Slice 9-C — NoteLinkedToCalendarEvent + CalendarLinkIndex projection

| Agent     | ~Tokens      |
| --------- | ------------ |
| Scout     | —            |
| Breaker   | 50 000       |
| Pip       | 35 000       |
| Hawk 1    | 66 000       |
| Hawk 2    | 30 000       |
| Scribe    | 8 000        |
| **Total** | **~189 000** |

**Why:** Two Hawk passes dominated cost (~96k combined). First pass found two blocking issues — bare `Task.WhenAll` over DynamoDB lookups swallowing individual failures as a 500, and a missing `CancellationToken` propagation in `LinkNoteToCalendar`. Both were clean fixes with no rework needed; Hawk approved immediately on the second pass.

**Optimisation suggestions:**
- **Hawk (–30 000):** Both first-pass findings are mechanical pre-PR checks: (1) any `Task.WhenAll` over per-item external calls should have per-item try/catch to degrade gracefully — add to Pip's pre-PR checklist; (2) any handler that accepts `CancellationToken ct` and calls stores/handlers must pass it through — already a standard pattern, add to the pre-PR checklist alongside the existing `LastModifiedAt` item. Catching these in a pre-PR self-review would have collapsed two Hawk rounds to one.

---

## Slice 11-C — Delete blank note on cancel

| Agent     | ~Tokens    |
|-----------|------------|
| Scout     | —          |
| Breaker   | —          |
| Pip       | 25 000     |
| Stylist   | —          |
| Hawk      | 75 000     |
| Scribe    | 3 000      |
| **Total** | **~103 000** |

**Why:** Two Hawk passes dominated cost — the first pass found a real unawaited-Promise bug and a missing test assertion, requiring a fix commit and a full re-review at ~35k tokens each.

**Optimisation suggestions:**
- **Hawk (–35 000):** The unawaited-Promise finding is a mechanical check: any `void`-returning event handler that calls an `async` prop should await it. Adding an "async prop calls must be awaited in event handlers" item to Pip's pre-PR checklist would have caught this before opening the PR, collapsing Hawk to a single pass.
- **Pip (–5 000):** A pre-staged unrelated CDK file (`NoteTakerStack.cs`) slipped into a commit because `git add` was run without listing explicit paths; the commit had to be reset and redone. Using `git add <explicit paths>` (already the project default) and running `git diff --cached` before every commit would catch stray staged files.

---

## Slice 11-D — Token expiry and silent refresh

| Agent     | ~Tokens    |
|-----------|------------|
| Scout     | —          |
| Breaker   | —          |
| Pip       | 88 000     |
| Stylist   | —          |
| Hawk      | 47 000     |
| Scribe    | 5 000      |
| **Total** | **~140 000** |

**Why:** Pip dominated (88k) because this slice required multiple rounds of test iteration — `vi.useFakeTimers()` interacts poorly with `findByRole`'s internal polling, which required diagnosing timing failures, redesigning the test structure (per-describe fake timer setup, synchronous queries after `act`), and fixing a test factory bug (tokens created before fake-clock advance had 0 remaining delay). Hawk (47k) caught a double-scheduling pattern and an unhandled Promise rejection in one pass; both were clean fixes with no re-review needed.

**Optimisation suggestions:**
- **Pip (–15 000):** The fake-timer + `findByRole` interaction is a known RTL pitfall. A project-level note (or a short section in the test setup file) documenting "use synchronous queries after `act(advanceTimers)`, not `findByRole`" would have short-circuited the diagnosis loop.
- **Hawk (–0):** Single pass, both findings were genuine and caught early. No optimisation needed here.

---

## Slice 10-C — Persist transcript

| Agent     | ~Tokens    |
|-----------|------------|
| Scout     | —          |
| Breaker   | —          |
| Pip       | 120 000    |
| Stylist   | —          |
| Hawk 1    | 60 000     |
| Hawk 2    | 38 000     |
| Scribe    | 4 000      |
| **Total** | **~222 000** |

**Why:** Two Hawk passes (98k combined) were needed. First pass found three important issues: missing `namespace Api.Contracts` on the contract file, unhandled `InvalidOperationException` producing 500 on a delete race, and stale `initialTranscript` shown after Reset. All three were fixed in one commit. Second pass approved cleanly (38k). A post-merge lint failure on `react-hooks/set-state-in-effect` required a follow-up fix PR (#80) — running `npm run lint` locally before push would have caught it.

**Optimisation suggestions:**
- **Pip (–25 000):** Three of Hawk's four findings are mechanical pre-PR checks: (1) verify all new `.cs` files in `src/Api/Contracts/` have their namespace; (2) verify every command handler catches both `NoteNotFoundException` and `InvalidOperationException`; (3) run `npm run lint` before pushing — the `react-hooks/set-state-in-effect` and `react-hooks/no-refs-in-render` rules would have surfaced both the effect-setState pattern and the ref-during-render pattern before CI.
- **Hawk 1 (–20 000):** The missing namespace and exception gap are pre-PR checklist items, not review findings. Moving them upstream collapses two Hawk passes to one.

---

## Hotfix — 9-F next-occurrence title + StubGoogleCalendarClient

| Agent     | ~Tokens    |
|-----------|------------|
| Pip       | 55 000     |
| Hawk 1    | 40 000     |
| Hawk 2    | 25 000     |
| Scribe    | 5 000      |
| **Total** | **~125 000** |

**Why:** Two Hawk passes (65k combined) plus three failed main deploys from a merge-ordering regression. Hawk 1 requested unit tests for `StubGoogleCalendarClient` and a doc comment. After fixing and merging, the deploy failed because the fix/9f PR had been merged before slice 11-H, and 11-H's `MeetingsSection.tsx` changes overwrote the title fix — requiring a direct commit to main to restore the `meeting.title` arg and update the test expectation.

---

## Slice 11-A — Tag autocomplete

| Agent     | ~Tokens     |
|-----------|-------------|
| Pip       | 55 000      |
| Stylist   | 4 000       |
| Hawk 1    | 41 000      |
| Hawk 2    | 32 000      |
| Scribe    | 5 000       |
| **Total** | **~137 000** |

**Why:** Two Hawk passes (73k combined) dominated cost. First pass found three real issues: Related+Common dedup missing (duplicate React keys in production), full WAI-ARIA combobox attributes missing, and group headings nested inside `<li role="option">` (accidentally submittable on click). All three fixed in one commit; second pass approved cleanly.

**Optimisation suggestions:**
- **Hawk (–32 000):** The three findings are mechanical pre-PR checks: (1) test every dropdown for the overlap case where a tag qualifies for both Related and Common; (2) verify custom dropdowns have the full WAI-ARIA combobox wiring (`role=combobox`, `aria-controls`, `aria-activedescendant`); (3) verify group headings are `role="presentation"` siblings, not nested inside options. Adding these to Pip's pre-PR checklist collapses Hawk to one pass.

---

## Slice 11-G — Fix 401s during active sessions

| Agent     | ~Tokens      |
|-----------|--------------|
| Pip       | 45 000       |
| Hawk 1    | 40 000       |
| Hawk 2    | 32 000       |
| Scribe    | 5 000        |
| **Total** | **~122 000** |

**Why:** Two Hawk passes (72k combined) drove the total. The first Hawk pass surfaced a semantic inversion in `jwtExpired`'s catch block — changing it to `return false` to skip non-JWT dev tokens regressed `loadPersistedToken`, which relied on `return true` for corrupt tokens. The fix required a structural guard (`token.split('.').length === 3`) at the `apiFetch` callsite only, keeping `jwtExpired` conservatively correct everywhere else. The implementation itself was non-trivial: a forward-ref pattern was needed to break the circular initialisation between `handleRefreshFailure` (declared before `useGoogleAuth`) and `cancelRefresh` (returned by `useGoogleAuth`), and the `visibilitychange` + fake-timer test approach required `vi.setSystemTime` rather than `vi.advanceTimersByTime` to simulate background-tab clock drift without triggering throttled timers.

**Optimisation suggestions:**
- **Hawk round 1 (–32 000):** The `jwtExpired` semantics conflict (conservative storage reject vs. permissive dev-token skip) is a consequence of the function being used in two different contexts with opposing requirements. A pre-implementation note documenting "functions used in both storage loading and API layer callsites must document which default applies where, and callsites with different requirements must add local guards" would surface the design question before code is written, collapsing two Hawk rounds to one.

---

## Slice 11-H — Fix note not deleted when discarded from meeting creation

| Agent     | ~Tokens    |
|-----------|------------|
| Pip       | 20 000     |
| Hawk      | 30 000     |
| Scribe    | 3 000      |
| **Total** | **~53 000** |

**Why:** Single Hawk pass approved cleanly, but a post-merge TypeScript error in `ListView.tsx` required a hotfix PR (#87). `MeetingsSection.onOpenNote` was updated from a 2-param to a 3-param signature as part of the fix, but `ListView.tsx` still declared the old 2-param type — TypeScript caught this at CI/deploy time, not locally before merge. The hotfix PR was fast (one-line change) but required a full deploy cycle.

**Optimisation suggestions:**
- **Pip (–5 000 hotfix):** Any prop signature change must be followed by `grep -rn "<prop-name>"` to locate all parent component declarations, then `npm exec -- tsc -p web/tsconfig.app.json --noEmit` before pushing. The `ListView.tsx` mismatch would have been visible instantly. Memory `feedback_typecheck_before_merge` records this rule.

---

## Slice 11-F — Adaptive note action buttons

| Agent     | ~Tokens      |
|-----------|--------------|
| Pip       | 25 000       |
| Hawk 1    | 58 000       |
| Hawk 2    | 24 000       |
| Scribe    | 5 000        |
| **Total** | **~112 000** |

**Why:** Two Hawk passes (82k combined). First pass had three findings: missing `transcriptText` test (the `transcriptText !== null` arm of `hasContent` was untested), 11-F status not updated in phase doc, and 11-H discard-dialog criterion not annotated as superseded. All three were minor and clean to fix; second pass approved immediately. The implementation itself was small (one component, two files) and TypeScript clean on first attempt.

**Optimisation suggestions:**
- **Hawk round 1 (–24 000):** The `transcriptText` test gap is a direct consequence of "test every arm of a new predicate." Adding a pre-PR checklist item — "for each new branch in `hasContent` / `isSaveEnabled`, at least one test isolates it as the sole truthy trigger" — would catch this before Hawk. The phase-doc update and criterion annotation are process steps that Pip should complete in the same commit as the implementation.

---

## BUG-1 — Blank screen on 401

> **Note:** Frontend-only bug fix run from a single main-loop session (Breaker + Pip + merge/deploy orchestration combined). Hawk ran as a real subagent (exact 44k from its hand-off). Other counts are estimates.

| Agent              | ~Tokens      |
|--------------------|--------------|
| Pip (impl + orchestration) | 110 000 |
| Hawk               | 44 000       |
| Scribe             | 9 000        |
| **Total**          | **~163 000** |

**Why:** No Hawk rework (approved first pass). The dominant driver was merge/deploy orchestration against a fast-moving main — multiple deploy-monitor cycles (concurrency-cancelled runs forced re-checks of the merge gate), merging the ~10-commit-advanced `origin/main` into the branch, and re-running the full 206-test suite to validate the combined state before merge. Scribe's read of the large `token-log.md` (~980 lines) added a few k.

**Optimisation suggestions:**
- **Pip (–15 000):** The worktree was first created with a relative path from `web/` and landed nested inside the repo, forcing a remove-and-recreate (plus a stray `Write` to the wrong path). Using an absolute `git worktree add` path (now in CLAUDE.md) avoids the rework.
- **Deploy monitoring (–10 000):** Several gate re-checks were spent watching concurrency-cancelled deploy runs on a busy main. Watching the single newest run id (and only re-fetching "latest" on cancellation) rather than re-listing repeatedly would trim the polling overhead.


---

## CHANGE-4 — To-do rows wrap cleanly with long text + note title

> **Note:** Resumed after a VS Code crash — the implementation was already complete and staged (uncommitted) in the slice worktree. This session was recovery + verification + merge/deploy orchestration; no fresh implementation. Hawk ran as a real subagent (exact 37k from its hand-off). Other counts are estimates.

| Agent                          | ~Tokens     |
|--------------------------------|-------------|
| Pip (recover + verify + orchestration) | 60 000 |
| Hawk                           | 37 000      |
| Scribe                         | 8 000       |
| **Total**                      | **~105 000** |

**Why:** No Hawk rework — approved first pass, zero critical/important findings, because the implementation matched the prototype-approved layout in the phase doc verbatim. The dominant non-Hawk cost was the two long pre-commit + verification test runs (the full 214-test frontend suite runs under the pre-commit hook, ~3 min each in WSL) and the deploy monitor. No implementation tokens were spent — the slice was recovered complete from the worktree.

**Optimisation suggestions:**
- **Verification (–10 000):** Two full frontend suite runs happened back to back — once as a manual targeted `vitest run TodoSection` + tsc, then again inside the pre-commit hook (which runs the *entire* suite). For a single-component visual change, the manual targeted run is redundant with the hook; trust the hook's full run and skip the pre-commit manual rehearsal, or vice-versa.
- **None on Hawk:** first-pass approval is the target state; nothing to trim.


---

## Slice 10-F — Capture remote participants (system audio mix)

> Resumed after a VS Code crash. Breaker's three red tests pre-existed (uncommitted) in the worktree; this session was Pip implementation + one Hawk round-trip + merge/deploy + Scribe. Hawk counts are exact from the two subagent hand-offs (39 000 + 34 000).

| Agent     | ~Tokens     |
|-----------|-------------|
| Breaker   | —           |
| Pip (impl + Hawk fixes + orchestration) | 90 000 |
| Hawk (two reviews) | 73 000 |
| Stylist   | —           |
| Scribe    | 9 000       |
| **Total** | **~172 000** |

**Why:** Two cost drivers, roughly equal. (1) The opening review swept *both* in-flight Phase 10 worktrees to decide where work stood; inspecting the untracked 10-G project with `find … -type f` dumped ~150 lines of `bin/`+`obj/` artifacts into context. (2) One Hawk round-trip (REQUEST CHANGES → fix → APPROVE) doubled Hawk's spend, and each of the three frontend test runs takes ~3 min under WSL (jsdom environment setup dominates).

**Optimisation suggestions:**
- **Pip (–8 000):** Enumerate untracked .NET projects with `-not -path '*/bin/*' -not -path '*/obj/*'`; the artifact dump was pure noise (captured as a learning).
- **Hawk:** the round-trip was legitimate — the gesture-ordering and teardown findings were real correctness fixes, not nits. Nothing to trim.

---

## CHANGE-5 / CHANGE-6 / CHANGE-7 — parallel minor-changes batch

> Three minor slices run concurrently in separate worktrees from one orchestrator session, each built by a background sub-agent through "PR open + green", then Hawk-reviewed and merged serially by the orchestrator. Counts are estimates per slice; Hawk counts are exact from hand-offs.

| Slice | Sub-agent (build) | Hawk | Orchestration share | ~Total |
|-------|-------------------|------|---------------------|--------|
| CHANGE-5 sign-in | 78 000 | 34 000 | — | 112 000 |
| CHANGE-6 filters | 106 000 | 36 000 | — | 142 000 |
| CHANGE-7 colours | 60 000 | 42 000 | — | 102 000 |
| Orchestration (merges, conflict resolution, deploy gates, Scribe) | — | — | ~180 000 | 180 000 |
| **Batch total** | | | | **~536 000** |

**Why the orchestration share is large:** the parallel run hit two avoidable cost centres. (1) A sub-agent that was supposed to stop at "PR open" stayed alive and collided with the orchestrator on the shared CHANGE-6 worktree, forcing a reset-to-remote and a full re-merge (the merge commit's pre-commit reran the whole suite). (2) Three slices all appended to `App.css`, so the 2nd and 3rd merges each needed an `App.css` conflict resolution + a full-suite pre-commit rerun. Plus a stretch of deploy-gate polling while another session's 12-e infra deploy was red.

**Optimisation suggestions:**
- **One driver per slice (−~60 000):** never both background a slice agent *and* take it over. The collision caused a reset + redundant re-merge + extra full-suite runs. If you take over, treat the agent as dead and don't let it keep a worktree.
- **Stagger shared-file slices (−~25 000):** when N parallel slices all touch one CSS file, merge them back-to-back and rebase each immediately, or give each a pre-reserved fenced region so the conflict is trivial (the fenced-region + take-theirs-and-reappend recipe worked, but still cost two full-suite reruns).
- **Hawk first-pass approval on all three** — no rework cycles; that part was efficient.


---

## Slice 10-E — Auto-analysis on stop

> Breaker tests + Pip implementation in one session, plus a Hawk round-trip (suggestions applied) and a merge-gate incident + remediation. Hawk count exact from its hand-off (47 000).

| Agent     | ~Tokens     |
|-----------|-------------|
| Breaker   | —           |
| Pip (impl + Hawk-suggestion fixes + orchestration) | 85 000 |
| Hawk      | 47 000      |
| Stylist   | —           |
| Scribe    | 12 000      |
| **Total** | **~144 000** |

**Why:** Two drivers. (1) The slow WSL frontend suite — three+ full runs (~3 min each: initial green, the Hawk-suggestion delta, and two pre-commit hook runs). (2) A **merge-gate incident**: 10-E was merged while deploy #403 was in progress and PR CI was pending; investigating the timeline and remediating the gate (CLAUDE.md + workflow step 11 + memory) added cost beyond the feature itself.

**Optimisation suggestions:**
- **Process (not tokens):** the gate fix is the real value here — future merges check the *latest* deploy run + `gh pr checks` all green, which prevents the rework class entirely.
- **Pip (−~10 000):** the targeted `vitest run TranscriptionPanel` before each commit is redundant with the pre-commit hook's full-suite run; pick one.

## Slice 10-I — Record AI tag suggestions (`TagsSuggested`)

> Backend-only slice run solo (Breaker + Pip + orchestration in one agent), plus one Hawk round-trip. Hawk count exact from its hand-off (45 500). No frontend suite, so no WSL-vitest tax.

| Agent     | ~Tokens     |
|-----------|-------------|
| Breaker   | —           |
| Pip (spec + impl + docs + orchestration) | 70 000 |
| Hawk      | 45 500      |
| Stylist   | —           |
| Scribe    | 10 000      |
| **Total** | **~125 000** |

**Why:** Clean, well-scoped slice. The largest single cost was up-front reading of the reference patterns (TagIndex projection trio, NoteCommandHandler serialisation path, spec harness) — much of which doubles as prep for 10-J/10-K, so it amortises across the phase.

**Optimisation suggestions:**
- **Pip (−~10 000):** the reference reads for 10-J's projection wiring were done during this slice's deploy wait — good overlap; keep doing read-ahead during deploy/CI gaps rather than at the next slice's start.
- Hawk approved first pass with no blocking findings — the equality-override comment and the integration ordering assertion pre-empted its likely questions, avoiding a second round.
---

## CHANGE-8 / CHANGE-9 — sequential minor-changes pair

> Run sequentially (not parallel) by one orchestrator: CHANGE-8 (sidebar footer, CSS-only) then CHANGE-9 (filters restructure, Option D). CHANGE-9 branched after CHANGE-8 merged, so there was zero App.css conflict — the deliberate payoff of sequencing two slices that touch the same file. Both Hawk-approved first pass.

| Slice | Build (inline) | Hawk | ~Total |
|-------|----------------|------|--------|
| CHANGE-8 sidebar footer | 30 000 | 33 000 | 63 000 |
| CHANGE-9 filters restructure (Option D) | 70 000 | 36 000 | 106 000 |
| Prototype (CHANGE-9 gallery) + Scribe | — | — | 40 000 |
| **Pair total** | | | **~209 000** |

**Why cheaper than the 3-slice parallel batch (~536k):** no worktree collisions, no App.css conflict resolution, no redundant full-suite reruns from re-merges. CHANGE-8 built inline in the main loop (tiny CSS), CHANGE-9 in a worktree with one driver. The cost was wall-clock (serial merges/deploys) not tokens — the right trade for two shared-file slices.

**Optimisation note:** building CHANGE-8 inline (no sub-agent) was correct for a 5-line CSS change — spawning an agent would have cost more than it saved. Reserve sub-agents for slices big enough to amortise the worktree + brief overhead.

---

## CHANGE-12 — Home Notes divider/alignment (shipped as "minor-10")

> Small CSS-only home-view tweak (one scoped rule). The notable cost was not tokens but a **numbering collision**: a concurrent session claimed CHANGE-10/11 in the same backlog doc while this was in flight, overwriting its CHANGE-10 entry — so its doc number became CHANGE-12 at Scribe while the merged commit/branch keep "minor-10". First-pass Hawk approval; ~70k total (build + Hawk + prototype + collision cleanup).

**Optimisation note:** reserve the backlog number with a tiny table-row commit *before* building when another session may touch the same doc; re-read the doc at Scribe to detect a clobber. One wasted commit cycle came from committing before `npm install` finished (`eslint: not found`).

---

## Slice 10-J — Tag feedback projection

> Backend-only projection slice run solo (Breaker + Pip + orchestration), plus one Hawk round-trip whose finding (a latent rebuild-parity divergence) was fixed in-slice. Hawk count exact from its hand-off (56 500). The dead-`IDomainEventDispatcher` investigation + tech-debt write-up is folded into Pip's count.

| Agent     | ~Tokens     |
|-----------|-------------|
| Breaker   | —           |
| Pip (spec + impl + arch investigation + docs + orchestration) | 120 000 |
| Hawk      | 56 500      |
| Stylist   | —           |
| Scribe    | 12 000      |
| **Total** | **~188 000** |

**Why:** Larger than 10-I for three real reasons. (1) A meatier slice — a two-row-type store, a rebuild projection, inline command-handler wiring, CDK table + grant + env var, three test layers. (2) The **dead-dispatcher discovery** required grepping all of `src`/`tests` to confirm `DispatchAsync` is never called, then a maintainer decision and a tech-debt write-up. (3) Hawk's parity finding triggered a fix + extra spec + re-push (a second CI cycle).

**Optimisation suggestions:**
- **Process (the real win):** the dead-dispatcher finding is now a memory + a `technical-improvements.md` entry, so 10-L and future projection slices skip the rediscovery cost.
- **Pip (−~15 000):** the architecture investigation was front-loaded reading; once memoised, 10-L's analogous wiring should be much cheaper.

---

## Slice 10-K — Record AI action-item suggestions (`ActionItemsSuggested`)

> Backend-only slice run solo, symmetric to 10-I. One Hawk round-trip, first-pass approval. Hawk count exact from its hand-off (40 500).

| Agent     | ~Tokens     |
|-----------|-------------|
| Breaker   | —           |
| Pip (spec + impl + docs + orchestration) | 60 000 |
| Hawk      | 40 500      |
| Stylist   | —           |
| Scribe    | 10 000      |
| **Total** | **~110 000** |

**Why:** The cheapest Phase-10 feedback slice so far — a near-mechanical copy of 10-I (command + collection event + handler hook + registration + docs). The 10-I equality-override learning and the 10-J memory meant zero rediscovery; almost all cost was the symmetric code and its two integration tests.

**Optimisation note:** three slices in (10-I→10-K), the marginal cost is falling as patterns memoise. 10-L (projection) will cost more again — it's a 10-J-shaped slice (store + rebuild + CDK + two-handler wiring), not a 10-I-shaped one.

---

## CHANGE-11 — Preview pull-out »↔« state

> Frontend prop-threading slice (App → Sidebar → FolderTree → node) + a toggle reducer. Built inline, one Hawk pass (approved with a 1-line title-tidy suggestion applied). ~95k total.

| Agent | ~Tokens |
|-------|---------|
| Pip (impl + tests + orchestration) | 60 000 |
| Hawk  | 32 000 |
| Scribe | 8 000 |
| **Total** | **~100 000** |

**Notes:** one wasted test run from asserting the preview panel *unmounts* on close when it actually toggles a `--open` class — read the component's render before writing the assertion. Merge correctly held for the other session's in-progress 10-K deploy, then merged once it cleared (the corrected concurrent-session gate discipline).

---

## Slice 10-L — Action-item feedback projection

> Backend-only projection slice run solo; a 10-J-shaped slice (store + rebuild + CDK + wiring) but spanning two command handlers. One Hawk round-trip, first-pass approval with a coverage nudge (added a same-item complete-then-delete parity test). Hawk count exact from its hand-off (65 000).

| Agent     | ~Tokens     |
|-----------|-------------|
| Breaker   | —           |
| Pip (spec + impl + docs + orchestration) | 130 000 |
| Hawk      | 65 000      |
| Stylist   | —           |
| Scribe    | 12 000      |
| **Total** | **~207 000** |

**Why:** Comparable to 10-J in shape but with extra design depth: the cross-stream **rebuild-ordering** problem (suggestion on the Note stream, outcomes on ActionItem streams) needed an order-independent projection design and a dedicated spec — genuinely new thinking, not a copy of 10-J. Wiring across two command handlers and a slightly larger test surface (delta-based integration assertions) added the rest. Hawk's review was the most thorough of the four (65k) and caught a worthwhile parity-coverage gap.

**Phase-10 feedback track total (10-I→10-L):** ~125k + ~188k + ~110k + ~207k ≈ **630k**. The two projection slices (J, L) cost ~1.7× the two event slices (I, K), driven by store/rebuild/CDK breadth and, for L, the cross-stream rebuild design.

**Optimisation note:** the cross-stream ordering insight is now a learning — any future multi-aggregate projection should reach for deferred computation (or sort by `OccurredAt`) from the start rather than discover the parity gap in review.

---

## CHANGE-10 — Home screen refinement pass

> Multi-file frontend slice (NoteCard, TodoSection, App.css, new icons.tsx) preceded by **three prototype rounds** (the brief — "simpler" — was subjective). One Hawk pass, approved with two cheap tidy suggestions applied. ~150k total incl. prototypes.

| Phase | ~Tokens |
|-------|---------|
| Prototypes (3 rounds: holistic → before/after → full-screen) | 45 000 |
| Pip (impl + dead-CSS removal + tests) | 70 000 |
| Hawk + tidy | 40 000 |
| Scribe | 9 000 |
| **Total** | **~164 000** |

**Notes:** the prototype rounds were the cost driver but earned it — they converted "simplify the home screen" into six concrete, low-risk changes. Reusing the *real* component CSS in the before/after prototype made the deltas legible. Querying delete tests by `aria-label` (not text) meant swapping text buttons for icons broke only one test file. Last item in the Minor Changes backlog.

---

## Slice 10-G — Analysis evaluation harness + versioned prompts

> Re-cut from a stale, uncommitted scaffold that had drifted 100 commits behind main and predated the 10-H `NoteAnalysisRequest` contract. One driver acted as Breaker + Pip + Refactor; one Hawk pass (real subagent, exact count) approved with suggestions, one of which was a genuine nightly-no-op bug. Single PR, no re-review needed.

| Agent                                   | ~Tokens  |
|-----------------------------------------|----------|
| Investigate + preserve stale scaffold + re-cut | 60 000 |
| Breaker (reconcile spec + scaffold + red verify) | 70 000 |
| Pip (prod refactor + harness impl + build/test) | 120 000 |
| Refactor (no changes warranted)         | 8 000    |
| Hawk (code-reviewer subagent)           | 64 000   |
| Hawk fixes + gate monitoring            | 35 000   |
| Scribe                                  | 30 000   |
| **Total**                               | **~387 000** |

**Notes:** the dominant avoidable cost was reconciling a scaffold that should never have drifted — had it been committed/pushed red when first written, the contract mismatch would have been a visible diff against main rather than a from-scratch re-derivation (learning 1 in the slice doc). Hawk's 64k earned its keep: it caught the env-flag/`RUN_BEDROCK_EVAL` save-restore bug that would have silently no-op'd the nightly eval. The two background gate-monitor polls (PR CI + main deploy) kept the merge gate honest at negligible token cost.

---

## Slice 10-N — Migrate analysis to the Bedrock Converse API

> Production-path transport swap (`InvokeModel` → `Converse`) with a hard "behaviour-identical" bar, plus pure-helper extraction. **Two Hawk rounds** (one full, one focused re-review), both genuinely additive — the first restored a dropped phase-15 observability signal, the second flagged a reused log marker. Driven inline (Scout + Breaker + Pip + Refactor).

| Agent / phase                                   | ~Tokens  |
|-------------------------------------------------|----------|
| Scout (phase-10 slice doc + graduate tech-improvements) | 14 000 |
| Pip (Converse migration + extract 2 helpers + tests) | 70 000 |
| Hawk round 1 (full, production-path)            | 47 000   |
| Hawk fixes (TryParse + 3-way logging + brace guard) | 22 000 |
| Hawk round 2 (focused re-review of the fix)     | 31 000   |
| Marker tweak + gate/deploy monitoring + Scribe  | 40 000   |
| **Total**                                       | **~224 000** |

**Notes:** the two Hawk passes were the cost driver and both paid off — neither was a rubber-stamp. Extracting the pure parser/reader *before* claiming "behaviour-identical" is what made the equivalence reviewable and surfaced a latent reversed-brace crash that pre-existed on main. Lesson banked: on a path with an observability contract, a logged marker string is an API — grep it before editing.

---

## CHANGE-13 — "Next occurrence" control inside a recurring-meeting note

> Reuse-in-a-new-location minor change: read-side (`GetByNoteIdAsync` reverse lookup + two fields on `GET /notes/{id}`) plus a `NoteView` control reusing the existing endpoint and `onOpenNote`. Driven inline (Scout + Breaker + Pip + Refactor in the main loop); one Hawk subagent.

| Agent / phase                                        | ~Tokens  |
|------------------------------------------------------|----------|
| Investigate (confirm option 1, map files)            | 28 000   |
| Breaker + Pip (backend store/handler + frontend control + 7 tests) | 95 000 |
| Refactor / self-review (caught lockfile churn, Limit-before-filter fix) | 14 000 |
| Hawk (code-reviewer subagent)                        | 47 000   |
| Gate + deploy monitoring + Scribe                    | 32 000   |
| **Total**                                            | **~216 000** |

**Notes:** no spike. The self-review pass earned its keep twice over — it caught the `Limit = 1`-before-`FilterExpression` scan bug *before* committing (would have silently returned no series link for notes past the first page) and the Node-24 `package-lock.json` churn (would have broken CI's Node-20 `npm ci`). Hawk added no blocking findings — expected for a small read-side slice that reuses an existing scan idiom — but confirmed the `isRecurring`-derivation and scan-pagination correctness and logged the per-load scan-latency follow-up. Both background gate monitors (PR CI + main deploy) ran at negligible cost.
