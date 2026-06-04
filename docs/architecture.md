# Architecture

Detailed rationale for each decision lives in `docs/adr/`. This document is the at-a-glance picture.

## Stack

| Layer | Choice |
|---|---|
| Backend | .NET 10 on AWS Lambda (ASP.NET minimal API behind one Lambda) |
| Event store | DynamoDB + lightweight helper library |
| Frontend | React + TypeScript (Vite) |
| Infrastructure | AWS CDK in C# |
| Testing | Five layers: domain BDD specs · DynamoDB Local integration · in-process API (WebApplicationFactory) · post-deploy acceptance · CDK assertions |
| Auth | Skipped initially — single hardcoded user. Multi-user Google Sign-In lands in the final phase. |

## Code layers

Every write request passes through four layers. Each layer has exactly one concern.

| Layer | Location | Concern |
|---|---|---|
| **API** | `src/Api/Program.cs` — endpoint lambdas | HTTP only: parse request, call handler, map result to HTTP status |
| **Command handler** | `src/Api/CommandHandlers/*CommandHandler.cs` | Orchestration: load stream → rebuild aggregate → execute command → persist events → update read-model projections inline |
| **Projections** | `EventStore.Projections` (fold logic) + command handlers (write) | Read models folded from the event stream; updated inline in the same request after append; rebuildable from the full stream |
| **Domain** | `src/Domain/` | Pure business logic: aggregate, commands, events — no I/O, no HTTP, no clock |

**Rules:**
- If you find yourself writing `store.ReadAsync` or `store.AppendAsync` inside an endpoint lambda, it belongs in the command handler instead.
- Projection updates live in the command handler, inline after `AppendAsync` (see `NoteCommandHandler.UpdateProjectionAsync`). There is no event dispatcher — projections are written synchronously by the handler that appended the events.
- Command handlers depend on `IEventStore` plus the projection stores they update directly.
- Adding a new projection means adding its store + fold logic, updating it inline in the owning command handler(s), and giving it a rebuild path. The async-projector split in [ADR 0009](adr/0009-split-lambdas-cqrs-async-projectors.md) will later move this off the request path onto DynamoDB Streams.

---

## Event sourcing

- Event store is the source of truth.
- Aggregates are pure — they accept prior events plus a command and return new events.
- Projections rebuild from the full stream; no state lives only in a projection.
- Event versioning is mandatory — once an event ships, its shape is immutable; new versions are added as new types.
- Commands are validated against the current aggregate state (rebuilt from events on demand or from a snapshot).

## BDD with event modelling

- **Event modelling** is the design artefact: prior events + command → expected new events (or error).
- BDD specs are plain C#: `Given(events).When(command).Then(expectedEvents)`.
- Specs are written before implementation. They are the success criterion for an agent slice.
- See [docs/event-model.md](event-model.md) for the living model.

## Where agents fit

- Coding agents (Claude Code primary) drive vertical slices to spec-green.
- Skills (`.claude/skills/`) replace static role prompts with reusable capabilities.
- `CLAUDE.md` provides session-level orientation; skills load on demand.
- Plan mode for design review; `/review` or a subagent for code review gating.
- Reflection captured in [docs/workflow-log.md](workflow-log.md) at the end of each phase.

## Diagram

```mermaid
flowchart LR
    User([User])

    subgraph AWS [AWS]
        CDN["S3 + CloudFront\nReact SPA"]
        APIGW["API Gateway"]

        subgraph Lambda ["Lambda — ASP.NET Minimal API"]
            direction TB
            WR["Write path\nload stream · Decide · append events · update projections inline"]
            RD["Read path\nread projection"]
        end

        subgraph DB ["DynamoDB — single table"]
            direction TB
            ES[("Event streams\nnote/id · action/id")]
            RM[("Projections\nNoteCardList · TodoList · …")]
        end
    end

    User -- "load app" --> CDN
    User -- "POST command" --> APIGW
    User -- "GET query" --> APIGW

    APIGW --> WR
    APIGW --> RD

    WR -- "1 · load stream" --> ES
    WR -- "2 · append events" --> ES
    WR -- "3 · update projection" --> RM
    RD -- "read" --> RM
```

**Write path detail:** the Lambda command handler loads the full event stream for the aggregate, folds it into current state, runs `Decide` to validate the command and produce new events, then appends those events with optimistic concurrency. It then updates the affected read-model projections inline (e.g. `NoteCommandHandler.UpdateProjectionAsync`) in the same request. All projection updates complete before the HTTP response is returned — there is no eventual consistency delay. [ADR 0009](adr/0009-split-lambdas-cqrs-async-projectors.md) plans to move projection-building off the request path onto DynamoDB Streams (trading immediate consistency for async, replayable projectors); that change is not yet implemented.

**Infrastructure as code:** all AWS resources (API Gateway, Lambda, DynamoDB table, CloudFront distribution, S3 bucket) are provisioned by the CDK app in `src/Infrastructure/`.

## Frontend state management

The React frontend treats the server as eventually consistent and updates local state optimistically.

**Pattern:**
1. `App` owns the notes array — single source of truth for both `ListView` and `NoteView`.
2. On any write (create or rename), the local array is updated immediately before the API call returns.
3. On failure, the previous value is restored from a snapshot taken before the optimistic update.
4. `ListView` and `NoteView` are purely presentational — they receive data and callbacks as props, never fetch or mutate directly.

**Why not re-fetch on navigate back?**
The list re-fetches on mount. When navigating note → list, a re-fetch races with the projection update on the server — if the GET arrives before the PATCH has been committed, the old title is returned. Optimistic state sidesteps this race entirely: the title is already correct in memory when the list renders.

**E2E test implications:**
- Tests must register `WaitForResponseAsync` *before* the action that triggers the request — not after — so the listener is in place when the response arrives.
- All test data created against the real deployed environment must be uniquely named (e.g. GUID suffix) to prevent cross-run collisions in Playwright's strict-mode locators.

## Cold start note

.NET on Lambda has a 1–3 second cold start by default. Mitigations (SnapStart, Native AOT) are deliberately deferred until cold start becomes a real annoyance.
