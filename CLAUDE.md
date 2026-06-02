# AI Note Taker — Agent Instructions

This file is read by coding agents at the start of every session. Keep it lean.

## What this project is

A meeting-focused note taking app, built as a **learning vehicle** for event sourcing, .NET on AWS serverless, and agentic dev workflows. Optimise for learning surface area, not shipping velocity.

See [docs/goals.md](docs/goals.md) for the learning goals.

## Stack

- Backend: .NET 10 on AWS Lambda (ASP.NET minimal API behind a single Lambda)
- Event store: DynamoDB with a lightweight helper library
- Frontend: React + TypeScript (Vite)
- Infrastructure: AWS CDK in C#
- Tests: xUnit with plain C# Given/When/Then helpers; **BDD specs are mandatory**, never optional

## Layout

- `src/Api/` — ASP.NET minimal API hosted in Lambda
- `src/Domain/` — aggregates, commands, events
- `src/EventStore/` — DynamoDB event store and projection plumbing
- `src/Infrastructure/` — CDK app
- `tests/Domain.Specs/` — BDD-style Given/When/Then specs (one per slice); also event store unit specs
- `tests/EventStore.Integration/` — DynamoDB Local integration tests (Testcontainers)
- `tests/Api.Integration/` — in-process HTTP tests (WebApplicationFactory + in-memory stores)
- `tests/Api.Smoke/` — post-deploy smoke tests against real API; **fails the build** if `API_BASE_URL` is not set
- `tests/Infrastructure.Assertions/` — CDK template assertions (IAM, env vars, deletion policies)
- `tests/Browser.E2E/` — Playwright browser journey tests (BDD-style); **fails the build** if `FRONTEND_URL` is not set
- `web/` — React + TypeScript frontend
- `docs/` — architecture, roadmap (the index), ADRs, event model, learnings, and the standing planning docs (`future-features.md`, `technical-improvements.md`, `phases/phase-bugs.md`, `phases/phase-minor-changes.md`)

## How to run

```bash
# Activate pre-commit hook (once per clone)
git config core.hooksPath .githooks

# Build entire solution
dotnet build ai-note-taker.sln

# Run domain BDD specs
dotnet test tests/Domain.Specs/Domain.Specs.csproj

# Run in-process API tests (no AWS credentials needed)
dotnet test tests/Api.Integration/Api.Integration.csproj

# Run DynamoDB integration tests (requires Docker)
dotnet test tests/EventStore.Integration/EventStore.Integration.csproj

# Run CDK assertions
dotnet test tests/Infrastructure.Assertions/Infrastructure.Assertions.csproj

# Run post-deploy acceptance tests (requires deployed API)
API_BASE_URL=<api-gateway-url> dotnet test tests/Api.Smoke/Api.Smoke.csproj

# Run E2E browser journey tests (requires deployed frontend + Playwright browsers installed)
FRONTEND_URL=<cloudfront-url> dotnet test tests/Browser.E2E/Browser.E2E.csproj

# Run the API locally (Kestrel, not Lambda)
dotnet run --project src/Api/Api.csproj

# Validate infrastructure (requires dotnet publish first)
dotnet publish src/Api/Api.csproj -c Release -o src/Api/bin/Release/net10.0/publish
cdk synth

# Deploy to AWS
cdk deploy
```

## Conventions

- **Specs first.** Every command requires a Given/When/Then spec before implementation. The spec is the source of truth for the slice.
- **Event modelling drives design.** New commands and events are added to the event model first; see [docs/event-model.md](docs/event-model.md). Wire shapes for events live in [docs/event-schemas.md](docs/event-schemas.md); wire shapes for read projections live in [docs/view-schemas.md](docs/view-schemas.md).
- **Aggregates are pure.** No side effects, no DB calls, no clock — pass time and IDs in.
- **Events are immutable.** Once shipped, never edit shape; introduce a new event version instead.
- **Projections are rebuildable** from the full event stream. No state lives only in a projection.
- **Command handlers own orchestration.** Each aggregate gets a `*CommandHandler` in `src/Api/`. The handler loads the stream, rebuilds the aggregate, executes the command, persists events, then calls `IDomainEventDispatcher.DispatchAsync` — that's it. Reacting to events (updating projections, sending notifications, etc.) belongs in `IDomainEventHandler` implementations in `src/Api/EventHandlers/`, not in command handlers. API endpoints do HTTP only — parse request, call handler, return result. Never write `store.ReadAsync` or `store.AppendAsync` inside an endpoint lambda. Never update a projection store inside a command handler.
- **Optimistic UI updates.** The UI must reflect the user's action immediately — do not wait for the API response before updating local state. Apply the expected state optimistically; reconcile on error. Breaker must include this as an explicit acceptance criterion in the BDD spec for every slice with frontend changes. When adding a new async mutation handler, mirror the optimistic-first pattern of the nearest existing handler in the same component.
- **Learnings docs are named `phase-<phase><id>-<short-description>.md`** (e.g. `phase-4e-note-summary-cards.md`) and live in `docs/learnings/`. Never use `slice-` as a prefix.
- **Work is tracked in one place per type, and `docs/roadmap.md` is the index that links to all of them.** Route each item by type: a **broken-down feature** → a numbered phase (`docs/phases/phase-N.md`); a **possible future feature** not yet scheduled → `docs/future-features.md`; a **bug** → `docs/phases/phase-bugs.md`; a **minor tweak** to existing behaviour → `docs/phases/phase-minor-changes.md`; a **technical/infra/CI improvement** → `docs/technical-improvements.md`. The roadmap holds a one-paragraph summary of each phase and of each standing track, never the full content. When a future-features or technical-improvements item is picked up, it graduates to a numbered phase (features) or is actioned and removed (technical).
- **Every phase doc opens with a `## Summary` table, placed immediately after the `**Goal:**` paragraph so it is visible without scrolling.** Columns are `Slice | Summary | Status | Depends on` for numbered phases and `Item | Summary | Status | Depends on` for the standing docs (`phase-bugs.md`, `phase-minor-changes.md`). One row per slice/item; `Summary` is a one-line description; `Status` is `Done` / `In Progress` / `Not Started` (numbered) or `Done` / `In Progress` / `Open` (standing); `Depends on` lists the slice/item IDs it requires, or `—` when independent. The table is the single at-a-glance source for status and cross-slice dependency — do not reintroduce a separate ASCII "slice order" diagram; any ordering nuance goes in prose directly beneath the table. **Scout creates this table when drafting a phase doc; Scribe keeps the `Status` cell in sync on every deploy (see the scribe skill).**

## Guardrails

- Never write directly to DynamoDB outside `src/EventStore/`.
- Never bypass the event store to mutate aggregate state.
- Never commit without all BDD specs green and `cdk synth` succeeding.
- Never edit a published event's shape — version it.
- **Never begin a pipeline role's work without authorisation.** For roles triggered by a human brief (Scout, Breaker, Pip at slice start), wait for explicit human go-ahead. For roles triggered by an automated event defined in the workflow, proceed without asking — see the full automation chain below.
- **Never prefix PowerShell commands with `cd`.** Use `npm --prefix <path> run build` (or equivalent flag) so the command starts with an already-allowed verb. `cd` is not in the allow-list.
- **Never use PowerShell compound statements starting with a variable assignment to pass multiline strings to CLI tools.** `$body = @"..."@; gh pr create --body $body` starts with `$body`, not `gh` — the permission checker won't match `PowerShell(gh *)` and will prompt for approval. Instead: use the Write tool to write the body to `.pr-body.md` (gitignored), then run `gh pr create --body-file .pr-body.md`. No variable assignment, no `Remove-Item`.
- **Never commit slice work directly to main.** Breaker creates a branch **and a worktree** before the first test commit (see *Worktrees* below). All slice commits (Breaker, Pip, Refactor, Stylist, Hawk fixes) go to that branch. Pip opens a PR; Hawk reviews the PR; Pip squash-merges after approval.
- **Never merge into main unless main's last deploy is green.** Before merging, Pip must confirm the latest completed deploy workflow run on main succeeded: `gh run list --branch main --workflow deploy.yml --status completed --limit 1 --json conclusion`. If the conclusion is not `success`, stop — do not merge, do not bypass. Fix main first. This is also enforced by the PR check workflow, which will block the merge automatically.
- **Never merge a `prototype/` branch into main or a `slice/` branch.** Prototype branches are reference material only. The one exception is cherry-picking the updated phase doc commit to main as part of the prototype exit procedure.
- **When installing new npm packages, confirm the local Node version matches CI (Node 20, per `.github/workflows/`) before committing `package-lock.json`.** Run `node --version` first. A lock file generated with npm 11+/Node 24 omits optional native-binding entries that Node 20's npm expects, causing `npm ci` to fail with "Missing: X from lock file". If versions differ, switch to Node 20 for the install, or verify the lock file includes all expected `node_modules/` entries.
- **GitHub passes unset optional secrets as empty string `""`, not null.** When CDK props are populated from `${{ secrets.SOME_SECRET }}` and the secret is not configured in the environment, the value is `""`. Always guard optional config with `string.IsNullOrEmpty()`, never `!= null`.
- **Google Calendar `Instances` endpoint: set `ShowDeleted = false` and `MaxResults ≥ 5`.** `MaxResults = 1` with a client-side cancelled filter silently returns null when the one fetched instance is cancelled, producing a spurious 404. `ShowDeleted = false` excludes cancelled instances server-side; a small lookahead buffer handles edge cases.
- **Never include request-contract fields that the handler does not use.** A field declared in a request record but never read by the handler is a contract lie — callers populate it, nothing consumes it, and the next developer will be misled. Delete unused fields before opening the PR.
- **When a response includes a boolean flag that enables navigation, include the required ID in the same response object.** A flag like `hasNextOccurrenceNote: true` is useless if the client must make a second call to discover the note ID. Return `nextOccurrenceNoteId` alongside `hasNextOccurrenceNote` so the flag is immediately actionable on page reload.
- **Use `Task.WhenAll` for independent async batches — never a sequential `foreach` over `Task`-returning calls.** If a set of store/API calls are independent (each takes different inputs, none depends on a prior result), start all tasks first and await together with `Task.WhenAll`. Sequential foreach adds latency proportional to N and is never correct for independent calls.
- **When changing a shared callback signature (e.g. `onOpenNote`), grep all call sites and wrapper components in the same PR.** Signature changes that widen or narrow parameters cascade through every component that wraps or re-exports the prop — a drift between wrapper type and caller type breaks the TypeScript build. Run `grep -r "onOpenNote\|propName"` before opening the PR and update every occurrence in one commit.

## Skills

Reach for these instead of writing patterns from scratch:

- **prototype** — throwaway frontend-only UX prototype before real implementation; see [`.claude/skills/prototype/SKILL.md`](.claude/skills/prototype/SKILL.md)
- **event-modelling** — translate a Given/When/Then sketch into a BDD spec file
- **aggregate-command** — add a new command + events + spec to an aggregate
- **projection** — scaffold a new read projection with rebuild logic
- **dynamodb-event-append** — canonical append-with-optimistic-concurrency pattern
- **cdk-stack-update** — safe edits to CDK with synth + diff gating
- **refactor** — clean up code after specs pass; see [`.claude/skills/refactor/SKILL.md`](.claude/skills/refactor/SKILL.md)
- **ui-ux-pro-max** — design system generator for visual polish; run as Stylist after Pip's tests are green; generates `design-system/MASTER.md` once and references it thereafter
- **scribe** — post-deploy orchestrator; sequences token-log, process-improvements, and doc updates after a deploy; see [`.claude/skills/scribe/SKILL.md`](.claude/skills/scribe/SKILL.md)
- **process-improvements** — surface observations from a slice and write them as actionable learnings; execute all immediately-applicable fixes in the same turn; see [`.claude/skills/process-improvements/SKILL.md`](.claude/skills/process-improvements/SKILL.md)
- **token-log** — record agent token counts per slice, append to `docs/token-log.md`, flag spikes for process-improvements; see [`.claude/skills/token-log/SKILL.md`](.claude/skills/token-log/SKILL.md)
- **observability** — add structured logs, X-Ray traces, EMF metrics, CloudWatch dashboards, and alarms; use when instrumenting a new slice, debugging in production, or setting up observability from scratch; see [`.claude/skills/observability/SKILL.md`](.claude/skills/observability/SKILL.md)
- **observability-brief** — Scout skill; run after GWT scenarios are drafted to identify silent failure modes per slice and produce the Observability section in the phase doc; see [`.claude/skills/observability-brief/SKILL.md`](.claude/skills/observability-brief/SKILL.md)

## Worktrees

Each slice runs in its own git worktree so multiple slices can run in parallel without interfering with each other.

**Breaker sets up the worktree** at the start of every slice:

```bash
# From the main checkout
git worktree add ../ai-note-taker-slices/slice-5e-my-feature -b slice/5-e-my-feature
```

The worktree lands at `../ai-note-taker-slices/<slice-name>/` (a sibling of the main checkout, outside this repo). All slice work — tests, builds, `npm install` — runs from inside that directory. The main checkout stays on `main` and is never touched during a slice.

> **Use an absolute path for `git worktree add`.** The shell cwd may be a subdirectory (e.g. `web/`), in which case `../ai-note-taker-slices/...` resolves to `ai-note-taker/ai-note-taker-slices/...` — nesting the worktree *inside* the repo. Pass the full absolute sibling path (and `git -C <repo-root>` if unsure of cwd).

**After the slice branch is merged and deleted**, remove the worktree:

```bash
git worktree remove ../ai-note-taker-slices/slice-5e-my-feature
```

**First-time setup in a fresh worktree** (Breaker does this immediately after `git worktree add`):

```bash
dotnet restore ai-note-taker.sln
npm --prefix web install
```

Prototype branches follow the same pattern: `git worktree add ../ai-note-taker-slices/prototype-<name> -b prototype/<name>`.

## Workflow

1. Plan mode for any non-trivial slice.
2. **Breaker creates the worktree** — `git worktree add ../ai-note-taker-slices/<slice-name> -b slice/<phase>-<id>-<short-description>`, then `dotnet restore` + `npm --prefix web install` inside it. All subsequent work happens from that directory. Set the session name to the slice name using `/rename <slice-name>`.
3. **Prototype** *(UI-heavy or UX-uncertain slices only)* — run the `prototype` skill before touching the event model. Skip if the interaction is obvious CRUD. Prototype code is quick-and-dirty scaffolding on a `prototype/<slice-name>` branch/worktree pushed to remote — never merged. On approval, the exit procedure rewrites `docs/phases/phase-X.md` on main with confirmed GWT scenarios and UX patterns. Real implementation starts fresh from the updated phase doc, not from prototype code.
4. Update event model.
5. Write BDD spec.
6. Implement until spec passes green.
7. **Refactor** — run the `refactor` skill against all changed files; re-run specs after each fix.
8. **Stylist** (user-facing slices only) — run the `ui-ux-pro-max` skill to apply visual polish; re-run tests after.
9. Open PR. After every `git push` to a PR branch, immediately schedule a CI monitor (`gh pr checks <n>` every 60s) — do not wait to be asked. CI results are informational; they do not block Hawk.
10. **Open PR → Hawk** — spawn `agent-skills:code-reviewer` subagent to review the PR immediately; do not wait for CI results.
11. **Hawk approves → Pip checks main, then merges** — before running `gh pr merge --squash --delete-branch`, confirm main's latest deploy workflow run completed successfully (`gh run list --branch main --workflow deploy.yml --status completed --limit 1 --json conclusion`). If main's deploy is not green, stop and investigate. No user confirmation needed once main is green. Note: `--delete-branch` deletes the *remote* branch server-side but its *local* cleanup fails with `'main' is already used by worktree` (main is checked out in the primary worktree) — this is harmless; the squash merge still succeeds. Do local cleanup separately in step 13 (`git worktree remove` + `git branch -D <slice-branch>`).
12. **Hawk requests changes → Pip fixes** — fix every finding, push, re-run Hawk.
13. **Merge to main → remove worktree + monitor deploy** — run `git worktree remove ../ai-note-taker-slices/<slice-name>`, then immediately schedule a monitor on `gh run list --branch main --limit 1`. Poll every 90s until the deploy run completes.
14. **Deploy succeeds → Scribe** — run all Scribe steps without being asked:
    - Create `docs/learnings/phase-<n><id>-<short-description>.md`; carry out all Done actions immediately
    - Mark slice/phase status as Done in `docs/phases/phase-N.md`
    - Update `docs/roadmap.md` if the phase is now complete
15. **Deploy fails → investigate and fix** — read `gh run view <id> --log-failed`, diagnose, fix, push. Do not stop to report unless genuinely blocked.

### Human gates (the only steps that require explicit user confirmation)
- Slice start: Scout brief, Breaker spec writing, Pip implementation start
- `cdk deploy` when run manually (not when triggered automatically by a merge to main)

If you find yourself asking the user to approve any other step, check this list. If it is not a defined human gate, proceed autonomously.
