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
