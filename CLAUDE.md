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
- `tests/Specs/` — BDD-style Given/When/Then specs (one per slice)
- `web/` — React + TypeScript frontend
- `docs/` — architecture, roadmap, ADRs, event model, workflow log

## How to run

```bash
# Activate pre-commit hook (once per clone)
git config core.hooksPath .githooks

# Build entire solution
dotnet build ai-note-taker.sln

# Run all BDD specs
dotnet test tests/Specs/Specs.csproj

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

## Guardrails

- Never write directly to DynamoDB outside `src/EventStore/`.
- Never bypass the event store to mutate aggregate state.
- Never commit without all BDD specs green and `cdk synth` succeeding.
- Never edit a published event's shape — version it.
- **Never begin a pipeline role's work without authorisation.** For roles triggered by a human brief (Scout, Breaker, Pip at slice start), wait for explicit human go-ahead. For roles triggered by an automated event defined in the workflow, proceed without asking: CI green → Hawk reviews; Hawk approves → Pip merges; Hawk requests changes → Pip fixes and pushes.

## Skills

Reach for these instead of writing patterns from scratch:

- **event-modelling** — translate a Given/When/Then sketch into a BDD spec file
- **aggregate-command** — add a new command + events + spec to an aggregate
- **projection** — scaffold a new read projection with rebuild logic
- **dynamodb-event-append** — canonical append-with-optimistic-concurrency pattern
- **cdk-stack-update** — safe edits to CDK with synth + diff gating
- **refactor** — clean up code after specs pass; see [`.claude/skills/refactor/SKILL.md`](.claude/skills/refactor/SKILL.md)

## Workflow

1. Plan mode for any non-trivial slice.
2. Update event model.
3. Write BDD spec.
4. Implement until spec passes green.
5. **Refactor** — run the `refactor` skill against all changed files; re-run specs after each fix.
6. Diff review (subagent or `/review`).
7. Append a short note to [docs/workflow-log.md](docs/workflow-log.md) at the end of each phase.
