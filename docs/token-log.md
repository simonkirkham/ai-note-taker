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
