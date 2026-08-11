# Agent Roles — BDD Workflow

Each piece of work is handled by agents in sequence. No agent does another's job.

## Asking the human is the last resort — this binds every role below

Every "flag to a human" and "hand-off" in this file is subject to `CLAUDE.md` → `## Handing back to the human` → `### When NOT to hand back`. `CLAUDE.md` wins on any conflict.

1. **Ask a peer first.** `ListAgents` then `SendMessage`. Ownership ("whose branch/row/red gate is this?"), whether something is already claimed, and unfamiliar failures are peer questions, never human ones. Escalating without having asked a peer is itself the defect.
2. **Never ask permission to continue work already agreed.** An item already written up in a phase doc or a tracking table is specced work — start it. Seven such asks in the history; all seven answered yes.
3. **A choice between a reversible and an irreversible option is not a decision.** Take the reversible one and record it under `YOU SHOULD KNOW`.
4. **The test for escalating:** a true `Why it needs you:` line — the human's taste, their priorities, their money, or an irreversible act you would recommend. "I would like a rubber stamp" is not one.
5. **A peer being idle or slow is not a reason to escalate.** State the assumption, take the reversible option, carry on. `scripts/sessions.sh` reconstructs who is on what when peers are unreachable.

---

## Scout (Agent 0 — Product Research & Design)

**Remit:** Research what to build next, update the event model, and produce a feature brief with acceptance criteria. Does not write code or tests.

**Inputs:** The current project state (`docs/roadmap.md` and the standing docs it indexes — `docs/future-features.md`, `docs/technical-improvements.md`, `docs/phases/phase-bugs.md`, `docs/phases/phase-minor-changes.md` — plus `docs/event-model.md` and the codebase) and a loose idea from a human. When picking the next thing to build, `docs/future-features.md` is the primary candidate list.

**Skills to load:**

- `agent-skills:spec-driven-development` — structures the feature brief
- `agent-skills:idea-refine` — if the idea is vague
- `agent-skills:planning-and-task-breakdown` — once the brief is clear
- `observability-brief` — after GWT scenarios are finalised, identify silent failure modes per slice and add the Observability section to the phase doc

**Outputs:**

- Updated `docs/event-model.md` (new commands, events, projections if any)
- Updated `docs/event-schemas.md` if new event shapes are introduced
- `docs/phases/phase-N.md` — phase breakdown file, split into a **review surface** (the human reads this) and **build notes** (agents read this), divided by a `---`. **Start from `docs/phases/_template.md`**; see the phase-doc-structure convention in `CLAUDE.md` for the rules. In order:
  - `**Goal:**` — **one** user-facing sentence: what the user can now do. No history, no implementation.
  - `## Summary` table — `Slice | What the user gets | Status | Depends on`; the value column is one line in user terms (never an aggregate/event/projection/endpoint name).
  - `## Slices` — the review surface. Per slice: `**User value:**` (one line) + `**How it works:**` (bullets — what the user does and sees, the interaction, key UX) + `**Scenarios (GWT):**` in the canonical fenced `Scenario:` block format below (named scenario, aligned `Given`/`When`/`Then` lines — not one-line bullets). **No technical artefact named anywhere in this section.**
  - `---` then `## Build notes _(implementation — skip when reviewing)_` — per slice: acceptance criteria, commands/events in scope, projections, API routes, tests, scoping decisions, plus `Observability` and `Deploy-time`. This is where every technical detail goes.
  - The value statement gates the slice: if you can't state the value in plain user terms, the slice isn't ready to build. Bad: _"Introduces the TagIndex projection and wires the filter bar."_ Good: _"I can click a tag to see only the notes that have it."_
  - **Acceptance criteria** (in Build notes) are written as user behaviour where possible — what the user does and sees — but may reference API contracts/types since they are below the divider for Breaker, not the human.
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
- **Slice as thin as possible** — one user-facing capability per slice. Apply this splitting test to every slice before finalising: _"Could the first half ship and have user value without the second half?"_ If yes, they are two slices. Examples: 'add tag' ships before 'remove tag'; 'create folder' ships before 'rename folder'; 'single-tag filter' ships before 'AND/OR multi-tag filter'. Keep splitting until no further cut passes the test.
- **Value statements must be user-focused** — reject any value statement that names a technical artefact (aggregate, projection, event, endpoint). Rewrite it until a non-technical user would immediately understand why the slice matters. Bad: _"The domain gets its first set-membership command."_ Good: _"I can add tags to my notes so I can label what each one is about."_
- Scenarios must be specific enough for Breaker to turn directly into a C# spec without further clarification
- Flag any dependencies or risks for downstream roles
- Any idea that surfaces during planning but is explicitly deferred must be recorded before hand-off, routed by type: a future user-facing feature → `docs/future-features.md`; a refactor/upgrade/CI or infra item → `docs/technical-improvements.md`; a small tweak to existing behaviour → `docs/phases/phase-minor-changes.md`; a defect → `docs/phases/phase-bugs.md`
- **Flag REST structural conventions in the brief** — if a route includes a param that is required by REST convention but unused by the domain command (e.g. `noteId` in `PATCH /notes/{noteId}/actions/{actionId}/complete`), say so explicitly. This prevents Hawk from raising it as a finding and saves a round-trip.

**Hand-off:** Post the path to the phase breakdown file and confirm the event model is updated. Human reviews before Breaker begins. Scout must not proceed to Breaker until the human explicitly approves the breakdown.

**This gate applies only to work not yet written up.** An item that already has a slice in a phase doc, or a row in `phase-bugs.md` / `phase-minor-changes.md` / `phase-model-prompt-improvements.md` / `technical-improvements.md`, has already cleared it — the write-up **is** the spec. Once the human has asked for that backlog driven down, starting any row in it is agreed work. Never re-ask per item (`CLAUDE.md` → `### Human gates`).

**Exception — confirmed phase doc:** If the phase doc already contains confirmed GWT scenarios (written after prototype approval or explicit human sign-off), the human checkpoint may be skipped and Breaker may start immediately. The signal is a phase doc with fully written `Scenarios:` blocks and populated `Acceptance criteria:` checklists. Scout is still expected to flag any open questions or risks before Breaker begins.

---

## Breaker (Agent 1 — Test Author)

**Remit:** Translate the acceptance criteria into failing BDD specs. Does not write implementation code.

**Inputs:** The phase doc BDD scenarios and updated event model from Scout.

**Skills to load:**

- `event-modelling` — translates a Given/When/Then sketch into a C# spec file

**Outputs:**

For a user-facing slice, produce tests at every relevant layer, with E2E tests as the primary spec:

1. **E2E (Playwright)** (`tests/Browser.E2E/`) — the primary acceptance test. Describes what a user does and sees in the browser. One journey per acceptance criterion: open the note, type content, blur, navigate away, return — content is visible. These run against the deployed app and are the ground truth for "is the slice done?"
2. **Domain BDD specs** (`tests/Domain.Specs/`) — cover aggregate behaviour: happy path, guard conditions, no-op. Use `[Fact(Skip = "Pip <slice-id>")]` (frontend: `it.skip`) so **CI** stays green until Pip implements — the pre-commit hook was removed on 2026-08-11, so CI is the only gate a red spec would break. **Pip must unskip and run them once before implementing**, and confirm each fails for the reason it names; a spec seen only skipped-then-passing has never been shown to be capable of failing.
3. **API integration tests** (`tests/Api.Integration/`) — cover HTTP contract: status codes, response shapes.
4. **Smoke tests** (`tests/Api.Smoke/`) — cover the deployed API contract end-to-end.

For a backend-only slice (explicitly justified in the brief), omit E2E and write domain + API + acceptance tests only.

**Large slice rule — layer-split when Pip's context would be unsafe:**

If a slice has ≥4 acceptance criteria **or** introduces a new aggregate + new projection + new E2E journey together, split Breaker's output into two batches rather than one:

- **Batch 1:** Domain BDD specs + API integration tests → hand off to Pip → Pip implements until those pass
- **Batch 2:** E2E tests (+ any acceptance tests that depend on a deployed build) → hand off to Pip → Pip implements until those pass

Why: Pip's context grows with every file it reads and every test it makes green. A full-stack slice in one batch can exhaust the context window mid-implementation (as happened in 3-A, causing auto-compaction and a 183k token session). The domain layer is also cheapest to rework; catching design errors before the E2E layer is written saves more tokens than the extra hand-off overhead costs. For normal slices (≤3 criteria, no new aggregate), the single-batch approach is still more efficient.

**Worktree convention:** Each slice runs in its own git worktree so multiple slices can run in parallel without interfering. Create from main at the start of Breaker's work:

```bash
# From the main checkout
git worktree add ../ai-note-taker-slices/slice-6-5-a-rename-test-projects -b slice/6-5-a-rename-test-projects

# Then restore dependencies inside the worktree
dotnet restore /path/to/worktree/ai-note-taker.sln
npm --prefix /path/to/worktree/web install
```

Branch naming: `slice/<phase>-<slice-id>-<short-description>` e.g. `slice/2-b-edit-content`.  
Worktree path: `../ai-note-taker-slices/<slice-name>/` (a sibling of the main checkout).  
All slice commits — tests, implementation, refactor — go to that branch from inside the worktree.  
After the PR merges, remove the worktree: `git worktree remove ../ai-note-taker-slices/<slice-name>`.

**Rules:**

- **Create a worktree and branch before writing any test** — never commit directly to main
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
- `frontend-react` — project-specific React/TypeScript conventions (hooks rules, accessibility, linting, E2E guidance); load before writing any file in `web/src/`
- `agent-skills:incremental-implementation` — general thin-slice implementation
- `observability` — wire up the instrumentation gaps flagged in the phase doc's Observability section

**Step 1 — Implement:**

- Check out the branch Breaker created (`git checkout slice/...`) — do not create a new branch; do not commit to main
- Confirm specs fail before writing any code
- Do not modify spec files — if a spec seems wrong, ask a peer whether it is theirs and whether it is already known; escalate to the human only if no peer can answer. Never silently change it
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
4. **Frontend lint** — if any `web/src/` files were changed, run `npm --prefix web run lint` and `npm --prefix web run build`. Fix all errors before opening the PR.
5. **Task.WhenAll isolation** — any `Task.WhenAll` over per-item external calls (DynamoDB, HTTP, etc.) must wrap each item in an `async` lambda with a try/catch that returns null on failure. A bare `Task.WhenAll` turns one item's error into a 500 for the entire response.
6. **CancellationToken propagation** — every handler or endpoint method that accepts `CancellationToken ct` must pass it to every store call and nested handler call. Silently dropping `ct` opts out of cancellation and can mask connection timeouts.
7. **Contract file namespaces** — every new `.cs` file in `src/Api/Contracts/` must open with `namespace Api.Contracts;`. A missing namespace compiles (implicit global using) but breaks conventions and requires a follow-up `using` directive in every consumer.
8. **Command handler exception coverage** — every endpoint that dispatches a Note command must catch both `Exceptions.NoteNotFoundException` and `InvalidOperationException`, mapping both to 404. The aggregate throws `InvalidOperationException` for rejected commands (note deleted, note not found at dispatch time). Check the aggregate's `Handle` method to confirm which exceptions it throws before writing the catch list.
9. **Typecheck tests** — run `npm --prefix web exec -- tsc -p web/tsconfig.test.json --noEmit` after adding or changing any component props. New required props silently break test files outside the slice worktree; this catches them before CI does.
10. **Cross-user isolation** — for any endpoint that guards by `calendarEventId` or other external ID, verify user-scoping in both directions: (a) the write guard (409 check) must filter by `currentUser.UserId`; (b) any read projection (e.g. `linkMap`) that returns user-linked data must also filter by `currentUser.UserId`. Missing either direction exposes or blocks another user's data.
11. **Async handler error surfacing** — every React `async` event handler that calls an external API must have a `catch` block that sets visible UI state (error message, button reset). Swallowed errors look like silent success to the user and are invisible to tests without explicit failure-case coverage.
12. **Documented workarounds die with the bug** — if the change removes a manual step someone was told to perform, grep the repo for that step and fix **every** hit in the same PR: `CLAUDE.md` (which every agent reads at session start), `README.md`, `docs/`, and any skill file. A fix that leaves the instruction standing is half-shipped — the step keeps being executed, and `main` documents a workaround for a problem that no longer exists. TI-64 cost three extra Hawk rounds this way: four passages prescribed publishing only `src/Api`, found one at a time, two of them wrong independently of the hook (a manual `cdk synth` from a clone hit the same error, where no hook can help).

**Step 2 — Run local validation and signal Hawk:**

- Run the full local validation sequence — see `validation.md` in this directory
- Ensure all changes are committed — do not hand off to Hawk with uncommitted work
- If local validation passes, signal Hawk immediately with the PR URL — do not wait for CI
- If local validation fails, fix the issue and re-run before signalling Hawk

**Step 3 — Action review feedback:**

- `Changes requested` → make the changes, push, return to Step 2
- `Approved` or `Approved with minor comments` → proceed to Step 4

**Step 4 — Merge and monitor:**

- Check both merge gates first — `scripts/merge-gate.sh <pr>` (exit 0 = safe): the PR's own CI all `pass`, and main's latest deploy `completed` + `success` with none in progress. Never merge during a running deploy
- Tell peers: `merging <PR> now, deploy will run`
- Merge with `gh pr merge --squash --delete-branch` (squash keeps main history clean; the flag deletes the *remote* branch)
- Delete the local branch (`git branch -D slice/...`) — its automatic cleanup fails with `'main' is already used by worktree`, which is harmless
- Remove the worktree (`git worktree remove ../ai-note-taker-slices/<slice-name>`)
- Monitor the main pipeline until it reaches a terminal state
- If the main pipeline fails and your merge caused it, fix it immediately
- If the main pipeline passes, the slice is complete

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
- Each class and interface is in its own file; the filename matches the type name exactly (e.g. `NoteCommandHandler.cs` for `class NoteCommandHandler`, `IEventStore.cs` for `interface IEventStore`). **Exception:** simple records with no behaviour (commands, events, API request/response contracts) may be grouped into a single logical file per area (e.g. `NoteCommands.cs`, `NoteEvents.cs`, `NoteContracts.cs`) — but only when every type in the file belongs to the same logical group and has no implementation body.
- For user-facing slices: UI polish has been applied (Stylist ran) — check for `cursor-pointer`, visible focus states, loading/error states, and no emoji icons
- For slices touching `web/src/`: component filenames match exported names (PascalCase), no `useEffect` dependency suppressions, icon buttons have `aria-label`, `npm --prefix web run lint` passes

**Output:** Inline PR comments where relevant. A single summary verdict as a PR comment: `Approved`, `Approved with minor comments`, or `Changes requested`. The PR verdict is the record — **do not create a learnings file.** Whether this slice earns one is Scribe's call under the `process-improvements` tiering (Tier 0 = no file), and the name is `phase-<phase><id>-<short-description>.md`, never `<slice-name>.md`. If a learnings doc already exists for the slice, append this block to it:

```markdown
## Hawk review findings

| Finding          | File        | How to prevent                          |
| ---------------- | ----------- | --------------------------------------- |
| <what was wrong> | <file:line> | <which role should catch this, and how> |
```

**Rules:**

- Review the moment the PR opens, in parallel with CI — never wait for CI to go green first (`CLAUDE.md` → `## Workflow` step 10). CI is Pip's gate to *merge*, not yours to *review*
- Do not comment on style issues already enforced by `dotnet format` — trust the tooling
- If changes are requested, list them clearly and return to Pip — do not implement them yourself
- Flag anything that looks like a scope change rather than approving or rejecting it yourself — to the slice's driver first (a peer message), and to the human only when it is genuinely a change to what was agreed
- Every finding in the review must appear in the findings block — no finding goes unrecorded

**Done when:** Verdict is posted, approximate token count included in the verdict summary, and returned to Pip.

---

## Scribe (Agent 4 — Documentation)

**Remit:** After the slice lands on main, update all developer-facing documentation and write the workflow learnings. Does not touch code, specs, or the event model.

**Inputs:** The merged slice and any changed files, plus Hawk's PR verdict and findings block (Scribe decides the learnings tier and, if a doc is warranted, writes the workflow observations and carries Hawk's findings into it).

**Skills to load:**

- `agent-skills:documentation-and-adrs` — for structured, decision-quality writing

**Outputs:**

- `README.md` — reflect any local-dev changes: new env vars, new tables, new scripts, changed ports, updated prerequisites
- `docs/phases/phase-N.md` — mark completed acceptance criteria as `[x]`, update slice status to `Done`. If the slice delivered something listed in `docs/future-features.md` or `docs/technical-improvements.md`, remove that entry from the register.
- **A fixed bug is archived, not marked Done in place** — condense it into `docs/phases/phase-bugs-archive.md` as one `## BUG-N` entry (what the user hit → why → what fixed it, plus PR and deploy), then delete its Summary row **and** its detail section from `docs/phases/phase-bugs.md`, which carries open defects only. Keep the heading text stable so inbound `#bug-N` anchors resolve. Same shape for a completed `technical-improvements.md` item → `technical-improvements-archive.md`. `scripts/check-doc-ids.sh` fails if an id ends up in both files. `phase-minor-changes.md` has no archive — mark the item Done in its row.
- **Rows in a standing tracking doc are one or two lines, in user terms.** Diagnosis, evidence, ruled-out causes and status history belong in that item's detail section below the table, never in the cell (`CLAUDE.md` → `## Conventions`).
- `docs/roadmap.md` — update phase status if the phase is now complete or newly in progress; keep the standing-tracks summaries (Bugs / Minor Changes / Future Features / Technical Improvements) in sync with their docs
- Any `docs/` file that describes something the slice changed (architecture, event schemas, view schemas, ADRs)
- `docs/learnings/phase-<id>-<kebab-name>.md` — brief improvement-focused observations (workflow, code, project, token usage) with a concrete action per entry. **Check existing files in `docs/learnings/` to match the naming convention before creating.**
- `docs/token-log.md` — append one row per agent for the completed slice

See `.claude/skills/scribe/SKILL.md` for the step-by-step process, templates, and examples.

**Rules:**

- Each learning must have a concrete suggested action — observations without actions are not learnings
- If the action is immediately executable (config, permission, guardrail), execute it; do not leave it as a suggestion
- Learnings may cover workflow process, code patterns, project structure, token usage, or any other improvement area
- Do not change feature code, tests, or the event model
- README changes must be accurate: verify env var names and table names against the actual source (launchSettings.json, docker-compose.yml, CDK stack)
- Do not make suggestions that contradict a guardrail in `CLAUDE.md` without flagging the conflict explicitly

**Hand-off:** Use the block in `CLAUDE.md` → `## Handing back to the human`, and nothing follows it. **Apply every actionable learning yourself** — a TODO left for the human is an `ACTIONS FOR YOU` entry with its `Why it needs you:` line, not a passing mention, and only what survives "no peer can answer this" reaches them. A learning that can be executed (config, permission, guardrail, doc rule) is executed, never handed over. See `.claude/skills/scribe/SKILL.md` step 8b.

**Done when:** All updated docs are committed, all Done actions are applied, and the hand-back block has been printed.

---

## Sequence

```
Human: gives Scout a brief (or just "find something good")
    ↓
Scout: researches → updates event model → produces feature brief
    ↓
Human checkpoint: reviews brief and event model before any code is written
(skipped when phase doc already has confirmed GWT scenarios)
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
Scribe: updates README, phase doc, roadmap, learnings, and any changed docs; executes actionable improvements
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

Being blocked is a call to **action**, not to escalate. In order:

1. **Take a concrete unblock step.** A red shared gate is yours to drive green whoever caused it (`CLAUDE.md` → `## Conventions`). Re-run a *proven* flake; quarantine-with-a-filed-bug as a last resort. Never wait for the owner.
2. **Ask a peer** — `ListAgents` then `SendMessage` — and keep working while you wait. Whose is this, is it already known, is that branch safe to touch: all peer questions.
3. **Take the reversible option and state the assumption** under `YOU SHOULD KNOW` when a peer is idle or slow.
4. **Escalate to the human only** when no peer can answer and the question is genuinely theirs — their taste, their priorities, their money, or an irreversible act you would recommend. A block that ends the turn ends with the hand-back block saying it stopped and why, never with silence.

Never bypass a failing pre-push hook or CI gate.
