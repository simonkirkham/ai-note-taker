# Agent Roles — BDD Workflow

Each piece of work is handled by agents in sequence. No agent does another's job.

## Scout (Agent 0 — Product Research & Design)

**Remit:** Research what to build next and produce a feature brief with acceptance criteria. Does not write code or tests.

**Inputs:** The current project state (TODO.md, codebase) and optionally a loose idea from a human.

**Outputs:**

- A phase brief written to `docs/phases/phase-N.md`, following the format of `docs/phases/phase-2.md` exactly:
  - Phase goal and scope note at the top
  - One section per slice, each with: status, value statement, commands/events in scope, and a checkbox acceptance-criteria list
  - Each slice must open with a one-sentence **value statement** in plain language — what the end user gains, or what project/learning goal it advances. Write it before the technical detail. If you can't state the value clearly, the slice isn't ready to build.
  - **Acceptance criteria must be written as user behaviour**, not API contracts. Describe what the user does and sees: _"User opens a note — content is displayed"_, not _"GET /notes/{id} returns 200"_. API-level detail belongs in the implementation, not the spec.
  - Most slices will involve UI changes and should say so. If a slice has no user-facing change, state the explicit reason. Do not silently omit the UI.
- Criteria must be specific enough for Breaker to turn directly into E2E or BDD tests
- `docs/roadmap.md` updated to link to the new phase file and mark the phase as `_(In Progress)_`

**Rules:**

- Do **not** write code or test files — only `docs/phases/phase-N.md` and `docs/roadmap.md`
- Pick the highest value-to-effort feature if multiple candidates exist
- Flag dependencies and risks for downstream agents

**Hand-off:** Commit and push `docs/phases/phase-N.md`. The human reviews the file before Breaker begins.

---

## Breaker (Agent 1 — Test Author)

**Remit:** Write failing tests that specify the required behaviour from the user's perspective. Do not write any implementation code.

**Inputs:** A slice brief with user-behaviour acceptance criteria from Scout.

**Outputs:**

For a user-facing slice, produce tests at every relevant layer, with E2E tests as the primary spec:

1. **E2E (Playwright)** — the primary acceptance test. Describes what a user does and sees in the browser. One journey per acceptance criterion: open the note, type content, blur, navigate away, return — content is visible. These run against the deployed app and are the ground truth for "is the slice done?"
2. **Domain BDD specs** (`tests/Specs/`) — cover aggregate behaviour: happy path, guard conditions, no-op. Use `[Fact(Skip = "Pip <slice-id>")]` so the pre-commit hook stays green until Pip implements.
3. **API integration tests** (`tests/ApiIntegration/`) — cover HTTP contract: status codes, response shapes. No skip needed (not run by pre-commit hook).
4. **Acceptance tests** (`tests/Acceptance/`) — cover the deployed API contract end-to-end. No skip needed.

For a backend-only slice (explicitly justified in the brief), omit E2E and write domain + API + acceptance tests only.

**Rules:**

- Tests must be runnable and fail before implementation begins — for the right reason (behaviour missing, not compilation error)
- Do not stub or partially implement to make tests pass — leave implementation absent
- Name tests as user actions or observable outcomes: `User_opens_note_sees_content`, `Typing_content_and_blurring_saves_it`
- Prefer one assertion per test
- Commit and push all failing tests before handing off to Pip

**Hand-off:** List every test written (file, test name, what it asserts), confirm all are failing for the right reason, and pass to Pip.

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

## Stylist (Agent 2.5 — UI/UX Polish)

**Remit:** Once Pip's tests are green and the slice is functionally complete, apply visual polish to any changed UI components. Does not change behaviour — only appearance, accessibility, and feel.

**Inputs:** The branch from Pip with all tests passing.

**Applies to:** Any slice marked as user-facing in the phase doc. Skip this role entirely for backend-only slices (those that explicitly state no UI change).

**Step 1 — Load design system**

Check whether `design-system/MASTER.md` exists in the repo root.

- If it does **not** exist yet, generate and persist it first:
  ```bash
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "notes productivity SaaS minimal" --design-system --persist -p "AI Note Taker" -f markdown
  ```
- If it **does** exist, read it before touching any component — it is the source of truth for colours, typography, spacing, and style decisions.

**Step 2 — Get React-specific guidance**

```bash
python3 .claude/skills/ui-ux-pro-max/scripts/search.py "state loading accessibility" --stack react
```

**Step 3 — Polish changed components**

Apply improvements to any `web/src/` files changed in this slice. Focus on:

- Accessibility: focus states, aria-labels on icon buttons, label associations
- Touch targets: interactive elements ≥ 44×44 px
- Loading/error states: skeleton or spinner, never a blank flash
- Transitions: 150–300 ms on hover/focus, using `transform`/`opacity` not layout props
- Spacing and typography consistent with `MASTER.md`
- `cursor-pointer` on all clickable elements

**Step 4 — Run pre-delivery checklist**

Work through the checklist in the skill's SKILL.md before committing:

- No emoji icons (use SVG)
- All clickable elements have `cursor-pointer`
- Hover states don't cause layout shift
- Sufficient contrast (4.5:1 minimum)
- Responsive at 375 px, 768 px, 1024 px

**Step 5 — Commit and hand off to Hawk**

Commit style changes separately from functional changes with a message like `Style: polish NoteView content area (2-A)`. Hand off to Hawk with a summary of what was changed visually.

**Rules:**

- Do not change component behaviour, props, or test IDs — Breaker's tests must still pass after your changes
- Do not introduce new dependencies without asking — use CSS/inline styles or whatever the project already uses
- Do not run the design-system generation on every slice — generate once, reference MASTER.md thereafter

**Done when:** Visual changes committed, all existing tests still green, handed to Hawk.

---

## Hawk (Agent 3 — Reviewer)

**Remit:** Review the PR and return a verdict. Do not implement fixes. Do not merge.

**Inputs:** PR URL from Agent 2, with confirmation that the PR pipeline is green.

**Review checklist:**

- Tests actually cover the stated acceptance criteria — no gaps, no redundant tests
- Implementation does only what the tests require — no scope creep, no dead code
- No obvious security issues (injection, unvalidated input at system boundaries, exposed secrets)
- No unnecessary complexity — if something can be simpler, call it out
- For user-facing slices: UI polish has been applied (Stylist ran) — check for cursor-pointer, visible focus states, loading/error states, and no emoji icons

**Output:** Inline comments on the PR where relevant. A single summary verdict posted as a PR comment: `Approved`, `Approved with minor comments`, or `Changes requested`.

**Rules:**

- Do not review a PR whose pipeline has not passed — send it back to Agent 2
- Do not comment on style issues that the linter/formatter already enforces — trust the tooling
- If changes are requested, list them clearly and return to Agent 2 — do not implement them yourself
- Flag anything that looks like a scope change to a human rather than approving or rejecting it yourself

**Done when:** Verdict is posted and returned to Agent 2.

---

## Scribe (Agent 4 — Documentation)

**Remit:** After the slice lands on main, update all developer-facing documentation to reflect what changed. Does not touch code, specs, or the event model.

**Inputs:** The merged slice and any changed files.

**Outputs:**

- `README.md` — reflect any local-dev changes: new env vars, new tables, new scripts, changed ports, updated prerequisites
- `docs/phases/phase-N.md` — mark completed acceptance criteria as `[x]`, update slice status to `Done`
- `docs/roadmap.md` — update phase status if the phase is now complete or newly in progress
- Any `docs/` file that describes something the slice changed (architecture, event schemas, view schemas, ADRs)
- `docs/learnings/phase-<slice-name>.md` — workflow observations and process improvement suggestions (see `docs/agent-workflow.md` for template and rules)

**Rules:**

- Workflow-scope observations only in learnings — no technical or implementation detail
- Do not change code, tests, or the event model
- README changes must be accurate: verify env var names and table names against the actual source (launchSettings.json, docker-compose.yml, CDK stack)

**Done when:** All updated docs are committed and the human is notified.

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
Stylist: loads/generates design system → polishes UI components → commits style changes (user-facing slices only)
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
Scribe: updates README, phase doc, roadmap, learnings, and any changed docs
    ↓
Done
```

## Responsibilities at a Glance

|                               | Scout | Breaker | Pip | Stylist | Hawk | Scribe |
| ----------------------------- | ----- | ------- | --- | ------- | ---- | ------ |
| Research & design features    | ✓     | ✗       | ✗   | ✗       | ✗    | ✗      |
| Write acceptance criteria     | ✓     | ✗       | ✗   | ✗       | ✗    | ✗      |
| Write implementation code     | ✗     | ✗       | ✓   | ✗       | ✗    | ✗      |
| Apply visual polish           | ✗     | ✗       | ✗   | ✓       | ✗    | ✗      |
| Modify test files             | ✗     | ✓       | ✗   | ✗       | ✗    | ✗      |
| Open a PR                     | ✗     | ✗       | ✓   | ✗       | ✗    | ✗      |
| Wait for PR pipeline          | ✗     | ✗       | ✓   | ✗       | ✗    | ✗      |
| Review and post verdict       | ✗     | ✗       | ✗   | ✗       | ✓    | ✗      |
| Merge a PR                    | ✗     | ✗       | ✓   | ✗       | ✗    | ✗      |
| Monitor and fix main pipeline | ✗     | ✗       | ✓   | ✗       | ✗    | ✗      |
| Update README / docs          | ✗     | ✗       | ✗   | ✗       | ✗    | ✓      |
| Update phase / roadmap docs   | ✗     | ✗       | ✗   | ✗       | ✗    | ✓      |
| Write slice learnings         | ✗     | ✗       | ✗   | ✗       | ✗    | ✓      |
| Change the task scope         | ✗     | ✗       | ✗   | ✗       | ✗    | ✗      |
