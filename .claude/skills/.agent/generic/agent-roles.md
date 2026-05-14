# Agent Roles — BDD Workflow

Each piece of work is handled by agents in sequence. No agent does another's job.

---

## Scout (Agent 0 — Product Research & Design)

**Remit:** Research what to build next, update the event model, and produce a feature brief with acceptance criteria. Does not write code or tests.

**Inputs:** The current project state (`docs/roadmap.md`, `docs/event-model.md`, codebase) and a loose idea from a human.

**Skills to load:**

- `agent-skills:spec-driven-development` — structures the feature brief
- `agent-skills:idea-refine` — if the idea is vague
- `agent-skills:planning-and-task-breakdown` — once the brief is clear

**Outputs:**

- Updated `docs/event-model.md` (new commands, events, projections if any)
- Updated `docs/event-schemas.md` if new event shapes are introduced
- `docs/phases/phase-N.md` — phase breakdown file with one section per slice, each containing:
  - Phase goal and scope note at the top
  - One section per slice with: status (`Not Started`), value statement, commands/events in scope, and BDD scenarios
  - Each slice must open with a one-sentence **value statement** — what the end user gains, or what project/learning goal it advances. Write it before the technical detail. If you can't state the value clearly, the slice isn't ready to build.
  - **Acceptance criteria must be written as user behaviour** — what the user does and sees. Not API contracts: _"User opens a note — content is displayed"_, not _"GET /notes/{id} returns 200"_. API-level detail belongs in the implementation, not the spec.
- Updated `docs/roadmap.md` — link to the new phase file and mark phase as `_(In Progress)_`
- A feature brief covering: objective, commands/events affected, projections affected, open questions

**BDD scenario format (per slice in the phase doc):**

Write scenarios at the user/system behaviour level — what a person does and what they observe — not at the domain aggregate level:

```
Scenario: <name>
  Given <observable system state>
  When  <user action or external trigger>
  Then  <observable outcome>
```

One scenario per distinct behaviour (happy path + each meaningful error/edge case). API-level error guard scenarios (404, 409) may be written from an API caller's perspective when there is no meaningful user-facing equivalent. These scenarios are the human's primary review artefact and Breaker's direct input — Breaker translates them into C# `[Fact]` methods.

**Rules:**

- Do not write code or test files
- Pick the highest value-to-effort feature if multiple candidates exist
- Update the event model before writing any BDD scenarios — the model is the design artefact
- The phase breakdown file is mandatory — it is the human's primary review artefact at the Scout hand-off
- **Every slice must be fullstack** — backend and frontend together, delivering something a user can observe. Never create a backend-only slice; if a slice has no user-visible effect it should be merged into the slice that makes it visible.
- **Slice as thin as possible** — one user-facing capability per slice. If a slice can be split into two independently deliverable user-visible capabilities, split it.
- Scenarios must be specific enough for Breaker to turn directly into a C# spec without further clarification
- Flag any dependencies or risks for downstream roles
- Any idea that surfaces during planning but is explicitly deferred must be added to `docs/backlog.md` before hand-off
- **Flag REST structural conventions in the brief** — if a route includes a param that is required by REST convention but unused by the domain command (e.g. `noteId` in `PATCH /notes/{noteId}/actions/{actionId}/complete`), say so explicitly. This prevents Hawk from raising it as a finding and saves a round-trip.

**Hand-off:** Post the path to the phase breakdown file and confirm the event model is updated. Human reviews before Breaker begins. Scout must not proceed to Breaker until the human explicitly approves the breakdown.

---

## Breaker (Agent 1 — Test Author)

**Remit:** Translate the acceptance criteria into failing BDD specs. Does not write implementation code.

**Inputs:** The phase doc BDD scenarios and updated event model from Scout.

**Skills to load:**

- `event-modelling` — translates a Given/When/Then sketch into a C# spec file

**Outputs:**

For a user-facing slice, produce tests at every relevant layer, with E2E tests as the primary spec:

1. **E2E (Playwright)** — the primary acceptance test. Describes what a user does and sees in the browser. One journey per acceptance criterion: open the note, type content, blur, navigate away, return — content is visible. These run against the deployed app and are the ground truth for "is the slice done?"
2. **Domain BDD specs** (`tests/Specs/`) — cover aggregate behaviour: happy path, guard conditions, no-op. Use `[Fact(Skip = "Pip <slice-id>")]` so the pre-commit hook stays green until Pip implements.
3. **API integration tests** (`tests/ApiIntegration/`) — cover HTTP contract: status codes, response shapes.
4. **Acceptance tests** (`tests/Acceptance/`) — cover the deployed API contract end-to-end.

For a backend-only slice (explicitly justified in the brief), omit E2E and write domain + API + acceptance tests only.

**Large slice rule — layer-split when Pip's context would be unsafe:**

If a slice has ≥4 acceptance criteria **or** introduces a new aggregate + new projection + new E2E journey together, split Breaker's output into two batches rather than one:

- **Batch 1:** Domain BDD specs + API integration tests → hand off to Pip → Pip implements until those pass
- **Batch 2:** E2E tests (+ any acceptance tests that depend on a deployed build) → hand off to Pip → Pip implements until those pass

Why: Pip's context grows with every file it reads and every test it makes green. A full-stack slice in one batch can exhaust the context window mid-implementation (as happened in 3-A, causing auto-compaction and a 183k token session). The domain layer is also cheapest to rework; catching design errors before the E2E layer is written saves more tokens than the extra hand-off overhead costs. For normal slices (≤3 criteria, no new aggregate), the single-batch approach is still more efficient.

**Branch convention:** `slice/<phase>-<slice-id>-<short-description>` e.g. `slice/2-b-edit-content`. Create from main at the start of Breaker's work:

```bash
git checkout main && git pull && git checkout -b slice/2-b-edit-content
```

**Rules:**

- **Create a feature branch before writing any test** — never commit directly to main
- Follow the BDD spec pattern: `Given(priorEvents).When(command).Then(expectedEvents)` or `.ThenError(...)`
- One spec class per command; one `[Fact]` per distinct scenario (happy path + each guard/error case)
- Name scenarios in plain language: `CreatesNoteWhenItDoesNotExist`, `RejectsCreateWhenNoteAlreadyExists`
- Tests must be runnable and fail before implementation begins — for the right reason (behaviour missing, not compilation error)
- Do not stub or partially implement to make tests pass — leave implementation absent
- Do not modify any existing spec files
- Prefer one assertion per test
- Commit and push all failing tests to the feature branch before handing off to Pip

**Hand-off:** List every test written (file, test name, what it asserts), the branch name, confirm all are failing for the right reason, include your approximate token count, and pass to Pip.

---

## Pip (Agent 2 — Implementer)

**Remit:** Make the failing specs pass, shepherd the PR through review, and own the branch until the main pipeline is green.

**Inputs:** The branch and failing spec summary from Breaker.

**Skills to load (pick by task type):**

- `aggregate-command` — adding or modifying a command + events on an aggregate
- `projection` — scaffolding or extending a read projection
- `dynamodb-event-append` — canonical DynamoDB append with optimistic concurrency
- `cdk-stack-update` — safe CDK edits with synth + diff gating
- `refactor` — clean up after specs pass (always run this before opening a PR)
- `dotnet-coding` — project-specific C# conventions (aggregate purity, command handler pattern, event immutability, no-comments rule); load before writing any C# in `src/`
- `agent-skills:incremental-implementation` — general thin-slice implementation

**Step 1 — Implement:**

- Check out the branch Breaker created (`git checkout slice/...`) — do not create a new branch; do not commit to main
- Confirm specs fail before writing any code
- Do not modify spec files — if a spec seems wrong, flag to a human rather than changing it
- Write only what is needed to make the specs pass — no extra features, no speculative code
- **Commit in small, working increments** — each commit should represent a working unit of software:
  - Commit backend changes (domain, API, infra) before touching the frontend
  - Commit frontend changes separately from backend changes
  - Within each layer, commit one working unit at a time: one endpoint, one component, one utility
  - A commit is ready when its tests pass and nothing is half-finished
- **Include your approximate token count in the commit message or hand-off summary** — Scribe records these per agent

**Step 1b — Refactor:**

- Once all specs are green, load the `refactor` skill and scan every file changed in this slice
- Fix one smell at a time; run `dotnet test` between each fix
- Do not open a PR until the refactor pass is done and specs are still green

**Step 1c — Stylist (user-facing slices only):**

- If this slice includes any UI changes (React components, CSS), invoke the `ui-ux-pro-max` skill before opening a PR
- Pass the list of changed frontend files explicitly (e.g., `web/src/components/Foo.tsx`, `web/src/App.css`)
- Commit any style changes Stylist makes before moving to Step 2
- Skip this step only for backend-only slices (no React files changed)

**Step 1d — Pre-PR self-check (run before every PR, takes <5 minutes):**

Hawk round-trips are expensive (~8–35k tokens each). Catch the common findings yourself first:

1. **Criteria coverage** — list every acceptance criterion from the phase doc. Verify each one maps to at least one test (domain spec, API integration test, or E2E journey). Any criterion with no test is a Hawk `Changes requested` waiting to happen — fix it now.
2. **Guard symmetry** — for every endpoint pair on the same resource (e.g. `POST /notes/{id}/actions` and `GET /notes/{id}/actions`), confirm both apply the same existence guard on the parent resource. If the write endpoint returns 404 for a missing note, the read endpoint must too.
3. **Hawk checklist** — scan Hawk's checklist in this file. If any item is obviously violated, fix it before opening the PR.

**Step 2 — Run local validation and signal Hawk:**

- Run the full local validation sequence — see `validation.md` in this directory
- Ensure all changes are committed — do not hand off to Hawk with uncommitted work
- If local validation passes, signal Hawk immediately with the PR URL — do not wait for CI
- If local validation fails, fix the issue and re-run before signalling Hawk

**Step 3 — Action review feedback:**

- `Changes requested` → make the changes, push, return to Step 2
- `Approved` or `Approved with minor comments` → proceed to Step 4

**Step 4 — Merge and monitor:**

- Merge the PR (squash merge to keep main history clean)
- Delete the remote branch (`git push origin --delete slice/...`)
- Delete the local branch (`git branch -d slice/...`)
- Monitor the main pipeline until it reaches a terminal state
- If the main pipeline fails and your merge caused it, fix it immediately
- If the main pipeline passes, update `docs/workflow-log.md` with a phase-end note if this completes a phase

**Done when:** The main pipeline is green after your merge.

---

## Stylist (Agent 2.5 — UI/UX Polish)

**Remit:** Once Pip's tests are green and the slice is functionally complete, apply visual polish to any changed UI components. Does not change behaviour — only appearance, accessibility, and feel.

**Inputs:** The branch from Pip with all tests passing.

**Applies to:** Any slice marked as user-facing in the phase doc. Skip this role entirely for backend-only slices.

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

**Done when:** Visual changes committed, all existing tests still green, approximate token count included in hand-off to Hawk.

---

## Hawk (Agent 3 — Reviewer)

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
- No obvious security issues (injection, unvalidated input at system boundaries, exposed secrets)
- No unnecessary complexity
- For user-facing slices: UI polish has been applied (Stylist ran) — check for `cursor-pointer`, visible focus states, loading/error states, and no emoji icons

**Output:** Inline PR comments where relevant. A single summary verdict as a PR comment: `Approved`, `Approved with minor comments`, or `Changes requested`. A structured review findings block appended to `docs/learnings/<slice-name>.md` (create the file if it does not yet exist):

```markdown
## Hawk review findings

| Finding          | File        | How to prevent                          |
| ---------------- | ----------- | --------------------------------------- |
| <what was wrong> | <file:line> | <which role should catch this, and how> |
```

**Rules:**

- Do not review a PR whose pipeline has not passed — send it back to Pip
- Do not comment on style issues already enforced by `dotnet format` — trust the tooling
- If changes are requested, list them clearly and return to Pip — do not implement them yourself
- Flag anything that looks like a scope change to a human rather than approving or rejecting it yourself
- Every finding in the review must appear in the findings block — no finding goes unrecorded

**Done when:** Verdict is posted, approximate token count included in the verdict summary, and returned to Pip.

---

## Scribe (Agent 4 — Documentation)

**Remit:** After the slice lands on main, update all developer-facing documentation and write the workflow learnings. Does not touch code, specs, or the event model.

**Inputs:** The merged slice and any changed files. The `docs/learnings/<slice-name>.md` file started by Hawk (Hawk writes the review findings block; Scribe adds the workflow observations above it).

**Skills to load:**

- `agent-skills:documentation-and-adrs` — for structured, decision-quality writing

**Outputs:**

- `README.md` — reflect any local-dev changes: new env vars, new tables, new scripts, changed ports, updated prerequisites
- `docs/phases/phase-N.md` — mark completed acceptance criteria as `[x]`, update slice status to `Done`
- `docs/roadmap.md` — update phase status if the phase is now complete or newly in progress
- Any `docs/` file that describes something the slice changed (architecture, event schemas, view schemas, ADRs)
- `docs/learnings/phase-<id>-<kebab-name>.md` — workflow observations, process improvement suggestions, and token usage observations (which agent consumed the most, why, and concrete suggestions for reducing usage on future slices). **Check existing files in `docs/learnings/` to match the naming convention before creating.**
- `docs/token-log.md` — append a row per agent for the completed slice with approximate token counts

**Learnings doc template:**

```markdown
# Learnings: <slice name>

## What was inefficient or went wrong

- <observation>

## Suggested process improvements

- <concrete suggestion tied to a specific role or workflow step>
```

Scribe writes the workflow observations above Hawk's review findings block. Observations must be grounded in the actual conversation — quote or paraphrase specific moments where the workflow broke down or caused rework. Suggestions must name the role or workflow step they apply to (e.g. "Scout should…", "The Breaker hand-off should require…").

**Token log format** — append one section per slice to `docs/token-log.md`:

```markdown
## Slice <id> — <name>

| Agent     | ~Tokens    |
| --------- | ---------- |
| Scout     | 12 000     |
| Breaker   | 8 000      |
| Pip       | 45 000     |
| Stylist   | 12 000     |
| Hawk      | 5 000      |
| Scribe    | 3 000      |
| **Total** | **85 000** |

**Why:** <one sentence on what drove the total — slice complexity, rework rounds, context size>

**Optimisation suggestions:**

- **<Role> (–<estimated saving>):** <what happened, what rule or step would have prevented it, what to do differently next slice>
```

Token counts come from each agent's hand-off summary. If an agent did not report, note `—`. Round to the nearest 1 000.

After recording the counts, **Scribe must analyse the distribution** and write at least one suggestion per agent whose token count was unexpectedly high (more than double the next-highest agent, or higher than the same agent on the previous slice). Suggestions must be specific — name the rule or step that would have changed the outcome, and estimate the saving. "Used too many tokens" is not a valid suggestion. If the slice ran cleanly with no high-cost agents, write `None — slice ran within expected range.`

**Permission-approval check (required):** Diff `.claude/settings.local.json` against main. Any new entries that appeared during the slice are commands that required the human's manual approval — find and fix every one:
- If the command is safe and commonly needed → add it to `.claude/settings.local.json` allow-list.
- If the command can be replaced with an already-allowed pattern → update the relevant guardrail in `CLAUDE.md` or role rule in this file so future runs use the right pattern instead (e.g. `$body = @"..."@; gh pr create --body $body` instead of a temp file + `Remove-Item`; `npm --prefix <path> run build` instead of `cd <path>; npm run build`).
- Record what was fixed and why in the learnings file under a **Permission approvals** heading.
- Goal: zero new approval prompts on the next slice.

**Rules:**

- Workflow scope only in learnings — no technical or implementation detail
- Observations must be grounded in the actual conversation: quote or paraphrase specific moments where the workflow broke down
- Suggestions must name the role or workflow step they apply to
- Token efficiency suggestions should be actionable: e.g. "Scout read 6 files that weren't needed — scope the read to X instead", not just "used too many tokens"
- Do not change code, tests, or the event model
- README changes must be accurate: verify env var names and table names against the actual source (launchSettings.json, docker-compose.yml, CDK stack)
- Do not make suggestions that contradict a guardrail in CLAUDE.md without flagging the conflict explicitly

**Hand-off:** Post the path to the learnings file. Human reviews and decides whether any suggestions warrant updating this file or `CLAUDE.md`.

**Done when:** All updated docs are committed and the human has been notified.

---

## Sequence

```
Human: gives Scout a brief (or just "find something good")
    ↓
Scout: researches → updates event model → produces feature brief
    ↓
Human checkpoint: reviews brief and event model before any code is written
    ↓
Breaker: writes failing tests → commits → pushes → hands off to Pip
    ↓
Pip: implements → refactors → validation passes → opens PR
    ↓
Stylist: loads/generates design system → polishes UI components → commits style changes (user-facing slices only)
    ↓
Pip: signals Hawk immediately with PR URL (does not wait for CI)
    ↓
Hawk: reviews → posts verdict → returns to Pip
    ↓
If changes requested → Pip fixes → pushes → re-requests review
    ↓
If approved → Pip merges → monitors main pipeline
    ↓
If main pipeline fails → Pip fixes → repeat until green
    ↓
Scribe: updates README, phase doc, roadmap, learnings, token log, and any changed docs
    ↓
Human checkpoint: reviews learnings and decides whether to update this file or CLAUDE.md
```

---

## Responsibilities at a Glance

|                                | Scout | Breaker | Pip | Stylist | Hawk | Scribe |
| ------------------------------ | ----- | ------- | --- | ------- | ---- | ------ |
| Research & design features     | ✓     | ✗       | ✗   | ✗       | ✗    | ✗      |
| Update event model             | ✓     | ✗       | ✗   | ✗       | ✗    | ✗      |
| Write acceptance criteria      | ✓     | ✗       | ✗   | ✗       | ✗    | ✗      |
| Write BDD spec files           | ✗     | ✓       | ✗   | ✗       | ✗    | ✗      |
| Write implementation code      | ✗     | ✗       | ✓   | ✗       | ✗    | ✗      |
| Run refactor skill             | ✗     | ✗       | ✓   | ✗       | ✗    | ✗      |
| Apply visual polish            | ✗     | ✗       | ✗   | ✓       | ✗    | ✗      |
| Modify existing spec files     | ✗     | ✗       | ✗   | ✗       | ✗    | ✗      |
| Open a PR                      | ✗     | ✗       | ✓   | ✗       | ✗    | ✗      |
| Wait for / fix CI pipeline     | ✗     | ✗       | ✓   | ✗       | ✗    | ✗      |
| Post review verdict            | ✗     | ✗       | ✗   | ✗       | ✓    | ✗      |
| Merge a PR                     | ✗     | ✗       | ✓   | ✗       | ✗    | ✗      |
| Update workflow-log.md         | ✗     | ✗       | ✓   | ✗       | ✗    | ✗      |
| Write slice learnings doc      | ✗     | ✗       | ✗   | ✗       | ✗    | ✓      |
| Update phase / roadmap docs    | ✗     | ✗       | ✗   | ✗       | ✗    | ✓      |
| Update README / developer docs | ✗     | ✗       | ✗   | ✗       | ✗    | ✓      |
| Change the task scope          | ✗     | ✗       | ✗   | ✗       | ✗    | ✗      |

---

## When to skip roles

Some tasks don't need the full pipeline:

| Task type                          | Roles needed                                                  |
| ---------------------------------- | ------------------------------------------------------------- |
| Typo / doc fix                     | Pip only (no spec needed, no Scribe)                          |
| CDK infra change (no domain logic) | Scout → Pip → Hawk → Scribe                                   |
| New command + events               | Full pipeline                                                 |
| New projection                     | Scout → Breaker → Pip → Hawk → Scribe                         |
| Bug fix                            | Breaker (reproduce with a failing spec) → Pip → Hawk → Scribe |

---

## Shell conventions (minimise permission prompts)

The project runs on Windows with a Linux Bash shell available via the Bash tool. The following conventions prevent unnecessary permission-approval dialogs:

- **Never change directory before a `git` command.** The Bash tool's working directory is always the project root. Run `git add`, `git commit`, `git push` directly — never prefix with `cd ... &&`.
- **Never change directory before an `npm` command.** Use `npm --prefix web <subcommand>` to run frontend commands from the project root:
  ```bash
  npm --prefix web run build
  npm --prefix web run lint
  npm --prefix web ci
  ```
  This matches the existing `Bash(npm *)` permission rule without needing `cd`.
- **Avoid compound `pwd && <cmd>` patterns.** If you need to verify the working directory, read the Bash tool's implicit cwd from context rather than running `pwd`.
- **Prefer `Bash` over `PowerShell` for all project commands** (dotnet, git, npm, gh, python). PowerShell is needed only for Windows-native operations (registry, `$env:`, `Get-ChildItem` on Windows paths).

---

## Blocked states

If any role is blocked for more than 30 minutes (CI stuck, unclear failure, ambiguous requirement), raise a flag to the human rather than waiting or guessing. Never bypass a failing pre-push hook or CI gate.
