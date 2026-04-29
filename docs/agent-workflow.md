# Agent Workflow

This project uses a five-role pipeline for every non-trivial slice of work. Roles map directly to skills — agents load the relevant skill rather than improvising the process.

The pipeline is gated: no role begins until the previous role's output is reviewed by a human.

---

## The Five Roles

### Scout — Research & Design

**Remit:** Understand what to build next, update the event model, and produce a feature brief with acceptance criteria. Does not write code or tests.

**Inputs:** The current project state (`docs/roadmap.md`, `docs/event-model.md`, codebase) and a loose idea from a human.

**Skills to load:**
- `agent-skills:spec-driven-development` — structures the feature brief
- `agent-skills:idea-refine` — if the idea is vague
- `agent-skills:planning-and-task-breakdown` — once the brief is clear

**Outputs:**
- Updated `docs/event-model.md` (new commands, events, projections if any)
- Updated `docs/event-schemas.md` if new event shapes are introduced
- A feature brief covering: objective, acceptance criteria, commands/events affected, projections affected, open questions
- Optionally a spec file in `docs/specs/` for larger slices

**Rules:**
- Do not write code or test files
- Update the event model before writing any acceptance criteria — the model is the design artefact
- Acceptance criteria must be specific enough for Breaker to turn directly into a BDD spec
- Flag any dependencies or risks for downstream roles

**Hand-off:** Post the feature brief and confirm the event model is updated. Human reviews before Breaker begins.

---

### Breaker — Spec Author

**Remit:** Translate the acceptance criteria into a failing BDD spec. Does not write implementation code.

**Inputs:** The feature brief and updated event model from Scout.

**Skills to load:**
- `event-modelling` — translates a Given/When/Then sketch into a C# spec file

**Outputs:**
- One spec file in `tests/Specs/` per command slice
- Spec must compile and fail for the right reason (behaviour not yet implemented, not a syntax error)
- Committed and pushed on a branch before hand-off

**Rules:**
- Follow the BDD spec pattern: `Given(priorEvents).When(command).Then(expectedEvents)` or `.ThenError(...)`
- One spec class per command; one `[Fact]` per distinct scenario (happy path + each guard/error case)
- Name scenarios in plain language: `CreatesNoteWhenItDoesNotExist`, `RejectsCreateWhenNoteAlreadyExists`
- Do not stub the implementation to make tests pass — leave the aggregate handler absent or throwing `NotImplementedException`
- Do not modify any existing spec files
- Confirm all new specs fail before handing off

**Hand-off:** List each scenario written (class name + fact name + one-line description), the branch name, and confirm all new specs fail for the right reason. Human reviews before Pip begins.

---

### Pip — Implementer

**Remit:** Make the failing specs pass, shepherd the PR through review, and own the branch until the main pipeline is green.

**Inputs:** The branch and failing spec summary from Breaker.

**Skills to load (pick by task type):**
- `aggregate-command` — adding or modifying a command + events on an aggregate
- `projection` — scaffolding or extending a read projection
- `dynamodb-event-append` — canonical DynamoDB append with optimistic concurrency
- `cdk-stack-update` — safe CDK edits with synth + diff gating
- `agent-skills:incremental-implementation` — general thin-slice implementation

**Step 1 — Implement:**
- Pull the branch and confirm specs fail before writing any code
- Do not modify spec files — if a spec seems wrong, flag to a human rather than changing it
- Write only what is needed to make the specs pass — no extra features, no speculative code
- Run the full validation sequence (see `.claude/skills/.agent/generic/validation.md`) before opening a PR
- Open a PR once all specs are green and validation passes

**Step 2 — Wait for CI:**
- Monitor the GitHub Actions pipeline until it reaches a terminal state
- If the PR pipeline fails, fix the issue, push, and wait for it to pass before proceeding
- Do not request review until the pipeline is green

**Step 3 — Request review from Hawk:**
- Signal Hawk with the PR URL and confirm the pipeline is green

**Step 4 — Action review feedback:**
- `Changes requested` → make the changes, push, return to Step 2
- `Approved` or `Approved with minor comments` → proceed to Step 5

**Step 5 — Merge and monitor:**
- Merge the PR (squash merge to keep main history clean)
- Delete the remote branch
- Monitor the main pipeline until it reaches a terminal state
- If the main pipeline fails and your merge caused it, fix it immediately
- If the main pipeline passes, update `docs/workflow-log.md` with a phase-end note if this completes a phase

**Done when:** The main pipeline is green after your merge.

---

### Hawk — Reviewer

**Remit:** Review the PR and return a verdict. Does not implement fixes. Does not merge.

**Inputs:** PR URL from Pip, with confirmation that the PR pipeline is green.

**Skills to load:**
- `agent-skills:code-review-and-quality` — five-axis review (correctness, readability, architecture, security, performance)

**Review checklist:**
- Specs actually cover the stated acceptance criteria — no gaps, no redundant scenarios
- Implementation does only what the specs require — no scope creep, no dead code
- Aggregates are pure (no I/O, no clock, no DB calls)
- Events are not mutated — new shapes get new types
- No direct DynamoDB access outside `src/EventStore/`
- No obvious security issues at system boundaries
- No unnecessary complexity

**Output:** Inline PR comments where relevant. A single summary verdict as a PR comment: `Approved`, `Approved with minor comments`, or `Changes requested`.

**Rules:**
- Do not review a PR whose CI pipeline has not passed — send it back to Pip
- Do not comment on style issues already enforced by `dotnet format` — trust the tooling
- If changes are requested, list them clearly and return to Pip — do not implement them yourself
- Flag any scope change to a human rather than approving or rejecting it yourself

**Done when:** Verdict is posted and Pip is unblocked.

---

### Scribe — Learnings Author

**Remit:** After each slice lands on main, review the full conversation history for the slice and produce a concise learnings doc covering what was inefficient or went wrong in the workflow, and concrete suggestions for improving the process. Does not touch code, specs, or the event model.

**Inputs:** The full prompt/conversation history for the slice, from the initial human brief through to Pip's merge.

**Skills to load:**
- `agent-skills:documentation-and-adrs` — for structured, decision-quality writing

**Outputs:**
- `docs/learnings/<slice-name>.md` using the template below

**Learnings doc template:**
```markdown
# Learnings: <slice name>

## What was inefficient or went wrong
- <observation>

## Suggested process improvements
- <concrete suggestion tied to a specific role or workflow step>
```

**Rules:**
- Workflow scope only — do not include technical or implementation observations
- Observations must be grounded in the actual conversation: quote or paraphrase specific moments where the workflow broke down or caused rework
- Suggestions must name the role or workflow step they apply to (e.g. "Scout should…", "The Breaker hand-off should require…")
- Do not make suggestions that contradict a guardrail in CLAUDE.md without flagging the conflict explicitly
- One file per slice; name it after the slice (e.g. `create-note-command.md`)

**Hand-off:** Post the path to the learnings file. Human reviews and decides whether any suggestions warrant updating `agent-workflow.md` or `CLAUDE.md`.

**Done when:** Learnings file is committed and the human has been notified.

---

## Pipeline Sequence

```
Human: brief (loose idea or "pick the next roadmap item")
    ↓
Scout: updates event model → produces feature brief
    ↓
Human checkpoint: reviews brief and event model changes
    ↓
Breaker: writes failing BDD specs → commits → pushes
    ↓
Human checkpoint: reviews failing specs before any implementation
    ↓
Pip: implements → validation passes → opens PR
    ↓
Pip: waits for CI pipeline (green)
    ↓
Pip: requests review from Hawk
    ↓
Hawk: reviews → posts verdict
    ↓
If changes requested → Pip fixes → pushes → waits for CI → re-requests review
    ↓
If approved → Pip merges → monitors main pipeline
    ↓
If main pipeline fails → Pip fixes → repeat until green
    ↓
Pip appends end-of-phase note to docs/workflow-log.md (if phase complete)
    ↓
Scribe: reviews conversation history → writes docs/learnings/<slice-name>.md
    ↓
Human checkpoint: reviews learnings and decides whether to update agent-workflow.md or CLAUDE.md
```

---

## Responsibilities at a Glance

|                                | Scout | Breaker | Pip | Hawk | Scribe |
|-------------------------------|-------|---------|-----|------|--------|
| Update event model             | ✓     | ✗       | ✗   | ✗    | ✗      |
| Write feature brief            | ✓     | ✗       | ✗   | ✗    | ✗      |
| Write BDD spec files           | ✗     | ✓       | ✗   | ✗    | ✗      |
| Write implementation code      | ✗     | ✗       | ✓   | ✗    | ✗      |
| Modify existing spec files     | ✗     | ✗       | ✗   | ✗    | ✗      |
| Open a PR                      | ✗     | ✗       | ✓   | ✗    | ✗      |
| Wait for / fix CI pipeline     | ✗     | ✗       | ✓   | ✗    | ✗      |
| Post review verdict            | ✗     | ✗       | ✗   | ✓    | ✗      |
| Merge a PR                     | ✗     | ✗       | ✓   | ✗    | ✗      |
| Update workflow-log.md         | ✗     | ✗       | ✓   | ✗    | ✗      |
| Write slice learnings doc      | ✗     | ✗       | ✗   | ✗    | ✓      |
| Change the task scope          | ✗     | ✗       | ✗   | ✗    | ✗      |

---

## When to skip roles

Some tasks don't need the full pipeline:

| Task type | Roles needed |
|---|---|
| Typo / doc fix | Pip only (no spec needed, no Scribe) |
| CDK infra change (no domain logic) | Scout → Pip → Hawk → Scribe |
| New command + events | Full pipeline |
| New projection | Scout → Breaker → Pip → Hawk → Scribe |
| Bug fix | Breaker (reproduce with a failing spec) → Pip → Hawk → Scribe |

---

## Blocked states

If any role is blocked for more than 30 minutes (CI stuck, unclear failure, ambiguous requirement), raise a flag to the human rather than waiting or guessing. Never bypass a failing pre-push hook or CI gate.
