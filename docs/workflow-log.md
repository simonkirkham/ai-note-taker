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
