# Token Usage Log

Approximate tokens consumed per slice, broken down by agent. Recorded by Scribe at the end of each slice. Counts come from agent hand-off summaries; round to nearest 1 000.

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
