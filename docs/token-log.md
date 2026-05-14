# Token Usage Log

Approximate tokens consumed per slice, broken down by agent. Recorded by Scribe at the end of each slice. Counts come from agent hand-off summaries; round to nearest 1 000.

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
