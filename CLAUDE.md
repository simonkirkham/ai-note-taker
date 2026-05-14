# AI Note Taker — Agent Instructions

This file is read by coding agents at the start of every session. Keep it lean.

## What this project is

A meeting-focused note taking app, built as a **learning vehicle** for event sourcing, .NET on AWS serverless, and agentic dev workflows. Optimise for learning surface area, not shipping velocity.

See [docs/goals.md](docs/goals.md) for the learning goals.

## Stack

- Backend: .NET 8 on AWS Lambda (ASP.NET minimal API behind a single Lambda)
- Event store: DynamoDB with a lightweight helper library
- Frontend: React + TypeScript (Vite)
- Infrastructure: AWS CDK in C#
- Tests: xUnit with plain C# Given/When/Then helpers; **BDD specs are mandatory**, never optional

## Layout

- `src/Api/` — ASP.NET minimal API hosted in Lambda
- `src/Domain/` — aggregates, commands, events
- `src/EventStore/` — DynamoDB event store and projection plumbing
- `src/Infrastructure/` — CDK app
- `tests/Specs/` — BDD-style Given/When/Then specs (one per slice); also event store unit specs
- `tests/EventStoreIntegration/` — DynamoDB Local integration tests (Testcontainers)
- `tests/ApiIntegration/` — in-process HTTP tests (WebApplicationFactory + in-memory stores)
- `tests/Acceptance/` — post-deploy smoke tests against real API; **fails the build** if `API_BASE_URL` is not set
- `tests/InfraAssertions/` — CDK template assertions (IAM, env vars, deletion policies)
- `tests/E2E/` — Playwright browser journey tests (BDD-style); **fails the build** if `FRONTEND_URL` is not set
- `web/` — React + TypeScript frontend
- `docs/` — architecture, roadmap, ADRs, event model, workflow log

## How to run

```bash
# Activate pre-commit hook (once per clone)
git config core.hooksPath .githooks

# Build entire solution
dotnet build ai-note-taker.sln

# Run domain BDD specs
dotnet test tests/Specs/Specs.csproj

# Run in-process API tests (no AWS credentials needed)
dotnet test tests/ApiIntegration/ApiIntegration.csproj

# Run DynamoDB integration tests (requires Docker)
dotnet test tests/EventStoreIntegration/EventStoreIntegration.csproj

# Run CDK assertions
dotnet test tests/InfraAssertions/InfraAssertions.csproj

# Run post-deploy acceptance tests (requires deployed API)
API_BASE_URL=<api-gateway-url> dotnet test tests/Acceptance/Acceptance.csproj

# Run E2E browser journey tests (requires deployed frontend + Playwright browsers installed)
FRONTEND_URL=<cloudfront-url> dotnet test tests/E2E/E2E.csproj

# Run the API locally (Kestrel, not Lambda)
dotnet run --project src/Api/Api.csproj

# Validate infrastructure (requires dotnet publish first)
dotnet publish src/Api/Api.csproj -c Release -o src/Api/bin/Release/net8.0/publish
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
- **Command handlers own orchestration.** Each aggregate gets a `*CommandHandler` in `src/Api/`. The handler loads the stream, rebuilds the aggregate, executes the command, persists events, and updates projections. API endpoints do HTTP only — parse request, call handler, return result. Never write `store.ReadAsync` or `store.AppendAsync` inside an endpoint lambda.
- **Learnings docs are named `phase-<phase><id>-<short-description>.md`** (e.g. `phase-4e-note-summary-cards.md`) and live in `docs/learnings/`. Never use `slice-` as a prefix.

## Guardrails

- Never write directly to DynamoDB outside `src/EventStore/`.
- Never bypass the event store to mutate aggregate state.
- Never commit without all BDD specs green and `cdk synth` succeeding.
- Never edit a published event's shape — version it.
- **Never begin a pipeline role's work without authorisation.** For roles triggered by a human brief (Scout, Breaker, Pip at slice start), wait for explicit human go-ahead. For roles triggered by an automated event defined in the workflow, proceed without asking: CI green → Hawk reviews; Hawk approves → Pip merges; Hawk requests changes → Pip fixes and pushes.
- **Never prefix PowerShell commands with `cd`.** Use `npm --prefix <path> run build` (or equivalent flag) so the command starts with an already-allowed verb. `cd` is not in the allow-list.
- **Never use PowerShell compound statements starting with a variable assignment to pass multiline strings to CLI tools.** `$body = @"..."@; gh pr create --body $body` starts with `$body`, not `gh` — the permission checker won't match `PowerShell(gh *)` and will prompt for approval. Instead: use the Write tool to write the body to `.pr-body.md` (gitignored), then run `gh pr create --body-file .pr-body.md`. No variable assignment, no `Remove-Item`.
- **Never commit slice work directly to main.** Breaker creates `slice/<phase>-<id>-<short-description>` (e.g. `slice/4-b-note-layout`) from main before the first test commit. All slice commits (Breaker, Pip, Refactor, Stylist, Hawk fixes) go to that branch. Pip opens a PR; Hawk reviews the PR; Pip squash-merges after approval.
- **Never merge a `prototype/` branch into main or a `slice/` branch.** Prototype branches are reference material only. The one exception is cherry-picking the updated phase doc commit to main as part of the prototype exit procedure.

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

## Workflow

1. Plan mode for any non-trivial slice.
2. **Prototype** *(UI-heavy or UX-uncertain slices only)* — run the `prototype` skill before touching the event model. Skip if the interaction is obvious CRUD. Prototype code is quick-and-dirty scaffolding on a `prototype/<slice-name>` branch pushed to remote — never merged. On approval, the exit procedure updates `docs/phases/phase-X.md` with confirmed GWT scenarios and cherry-picks that doc commit to main. Real implementation starts fresh from the updated phase doc, not from prototype code.
3. Update event model.
4. Write BDD spec.
4. Implement until spec passes green.
6. **Refactor** — run the `refactor` skill against all changed files; re-run specs after each fix.
7. **Stylist** (user-facing slices only) — run the `ui-ux-pro-max` skill to apply visual polish; re-run tests after.
8. Diff review (subagent or `/review`).
9. Append a short note to [docs/workflow-log.md](docs/workflow-log.md) at the end of each phase.
