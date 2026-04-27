# Agent Roles — BDD Workflow

Each piece of work is handled by agents in sequence. No agent does another's job.

## Scout (Agent 0 — Product Research & Design)

**Remit:** Research what to build next and produce a feature brief with acceptance criteria. Does not write code or tests.

**Inputs:** The current project state (TODO.md, codebase) and optionally a loose idea from a human.

**Outputs:**

- A feature brief: what to build, why, design notes, and acceptance criteria
- Criteria must be specific enough for Breaker to turn directly into BDD tests

**Rules:**

- Do not write code or modify any files
- Pick the highest value-to-effort feature if multiple candidates exist
- Flag dependencies and risks for downstream agents

**Hand-off:** Output a structured brief. The human reviews it before Breaker begins.

---

## Breaker (Agent 1 — Test Author)

**Remit:** Write failing BDD-style tests that specify the required behaviour. Do not write any implementation code.

**Inputs:** A task description or acceptance criteria from a human.

**Outputs:**

- One or more test files with failing tests
- Tests must fail for the right reason (the behaviour is not implemented yet, not a syntax error or bad mock)

**Rules:**

- Tests must be runnable and fail before implementation begins
- Do not stub out the implementation to make tests pass — leave it absent or minimal
- Name tests in plain language: `it("returns a 404 when the team does not exist")`
- Prefer one assertion per test; group related tests under descriptive `describe` blocks
- Commit and push the failing tests before handing off to Agent 2

**Hand-off:** Print a summary of all test scenarios written (test name + one-line description of what it asserts), the branch name, and confirm that all new tests are failing for the right reason. Pass this to Agent 2.

---

## Pip (Agent 2 — Implementer)

**Remit:** Make the failing tests pass, shepherd the PR through review, and own the branch until the main pipeline is green.

**Inputs:** The branch and failing test summary from Agent 1.

**Step 1 — Implement:**

- Pull the branch from Agent 1 and confirm the tests fail before writing any code
- Do not modify test files — if a test seems wrong, flag it to a human rather than changing it
- Write only what is needed to make the tests pass — no extra features, no speculative code
- Run the full validation sequence ([validation.md](../validation.md)) before opening a PR
- Open a PR once all tests are green and validation passes

**Step 2 — Wait for PR pipeline:**

- Monitor the PR pipeline until it reaches a terminal state (`SUCCESSFUL` or `FAILED`)
- If the PR pipeline fails, fix the issue, push, and wait for it to pass before proceeding
- Do not request a review until the PR pipeline is `SUCCESSFUL`

**Step 3 — Request review from Agent 3:**

- Signal Agent 3 with the PR URL and confirm the pipeline is green

**Step 4 — Action review feedback:**

- If Agent 3 returns `Changes requested`: make the changes, push, and return to Step 2
- If Agent 3 returns `Approved` or `Approved with minor comments`: proceed to Step 5

**Step 5 — Merge and monitor:**

- Merge the PR
- Delete the remote branch
- Delete the local branch
- Monitor the main pipeline until it reaches a terminal state
- If the main pipeline fails and your merge caused it, fix it immediately — treat it as the current task
- If the main pipeline passes: you are done

**Done when:** The main pipeline is `SUCCESSFUL` after your merge.

---

## Hawk (Agent 3 — Reviewer)

**Remit:** Review the PR and return a verdict. Do not implement fixes. Do not merge.

**Inputs:** PR URL from Agent 2, with confirmation that the PR pipeline is green.

**Review checklist:**

- Tests actually cover the stated acceptance criteria — no gaps, no redundant tests
- Implementation does only what the tests require — no scope creep, no dead code
- No obvious security issues (injection, unvalidated input at system boundaries, exposed secrets)
- No unnecessary complexity — if something can be simpler, call it out

**Output:** Inline comments on the PR where relevant. A single summary verdict posted as a PR comment: `Approved`, `Approved with minor comments`, or `Changes requested`.

**Rules:**

- Do not review a PR whose pipeline has not passed — send it back to Agent 2
- Do not comment on style issues that the linter/formatter already enforces — trust the tooling
- If changes are requested, list them clearly and return to Agent 2 — do not implement them yourself
- Flag anything that looks like a scope change to a human rather than approving or rejecting it yourself

**Done when:** Verdict is posted and returned to Agent 2.

---

## Sequence

```
Human: gives Scout a brief (or just "find something good")
    ↓
Scout: researches → designs → produces feature brief with acceptance criteria
    ↓
Human checkpoint: reviews brief before any code is written
    ↓
Breaker: writes failing tests → commits → pushes → hands off to Pip
    ↓
Pip: implements → validation passes → opens PR
    ↓
Pip: waits for PR pipeline to pass
    ↓
Pip: requests review from Hawk
    ↓
Hawk: reviews → posts verdict → returns to Pip
    ↓
If changes requested → Pip fixes → pushes → waits for PR pipeline → re-requests review
    ↓
If approved → Pip merges → monitors main pipeline
    ↓
If main pipeline fails → Pip fixes → repeat until green
    ↓
Done
```

## Responsibilities at a Glance

|                               | Scout | Breaker | Pip | Hawk |
| ----------------------------- | ----- | ------- | --- | ---- |
| Research & design features    | ✓     | ✗       | ✗   | ✗    |
| Write acceptance criteria     | ✓     | ✗       | ✗   | ✗    |
| Write implementation code     | ✗     | ✗       | ✓   | ✗    |
| Modify test files             | ✗     | ✓       | ✗   | ✗    |
| Open a PR                     | ✗     | ✗       | ✓   | ✗    |
| Wait for PR pipeline          | ✗     | ✗       | ✓   | ✗    |
| Review and post verdict       | ✗     | ✗       | ✗   | ✓    |
| Merge a PR                    | ✗     | ✗       | ✓   | ✗    |
| Monitor and fix main pipeline | ✗     | ✗       | ✓   | ✗    |
| Change the task scope         | ✗     | ✗       | ✗   | ✗    |
