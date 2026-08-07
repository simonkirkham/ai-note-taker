# Architecture Decision Records

The index for every ADR. Read this table first and open only the record you need — each ADR carries the full context, options considered, and consequences.

An ADR records a decision that is **expensive to reverse** and whose *why* is not recoverable from the code: a runtime, a data store, a framework adoption, a testing or workflow stance. Routine choices go in the phase doc that made them, not here.

## Index

| ADR | Decision | Status | Where it bites |
|-----|----------|--------|----------------|
| [0001](0001-backend-dotnet-lambda.md) | Backend on .NET + AWS Lambda | Accepted | `src/Api`, `src/Infrastructure`. Written against .NET 8; the runtime moved to **.NET 10** in Phase 6 — the decision stands, the version in the title does not. |
| [0002](0002-event-store-dynamodb.md) | Event store on DynamoDB | Accepted | `src/EventStore`. Single-table, optimistic concurrency on stream version. |
| [0003](0003-frontend-react-typescript.md) | Frontend on React + TypeScript | Accepted | `web/` |
| [0004](0004-iac-cdk-csharp.md) | Infrastructure-as-code with AWS CDK in C# | Accepted | `src/Infrastructure`, `tests/Infrastructure.Assertions` |
| [0005](0005-skip-auth-until-final-phase.md) | Skip auth until Phase 8, then add real Google Sign-In | **Amended** — originally "skip until the *final* phase" | Phase 8 onward; the whole auth surface |
| [0006](0006-bdd-plain-csharp-specs.md) | BDD with plain C# Given/When/Then specs (no Gherkin runner) | Accepted | `tests/Domain.Specs` |
| [0007](0007-spec-first-agentic-workflow.md) | Spec-first agentic workflow built from skills, not role agents | Accepted | `.claude/skills`, `CLAUDE.md`, the whole pipeline |
| [0008](0008-testing-strategy.md) | Multi-layer testing strategy | Accepted | Every `tests/` project; the deploy gate |
| [0009](0009-split-lambdas-cqrs-async-projectors.md) | Split the API Lambda into CQRS write/read Lambdas with async projectors | Accepted — **Stage 1 complete** (2026-06-13, via Phase 27-RYW + 27-D); Stage 2 (per-context split) deferred | `CommandFunction` / `QueryFunction` / `ProjectorFunction`; the read-your-writes contract |
| [0010](0010-server-state-strategy.md) | Server state: stay hand-rolled | **Superseded by [0012](0012-adopt-tanstack-query-server-state.md)** (2026-06-05) | — |
| [0011](0011-transcription-checkpoints-draft-store.md) | Transcription checkpoints are draft state, not events | Accepted | The draft store; every recording-recovery path |
| [0012](0012-adopt-tanstack-query-server-state.md) | Adopt TanStack Query for server state (supersedes 0010) | Accepted | `web/src/api`, every hook that reads or mutates |
| [0013](0013-adopt-react-router-dom.md) | Adopt React Router v7 for client-side routing | Accepted (Phase 21-A) | `web/src/App.tsx` and every route |

## Conventions

- **Numbered sequentially, never renumbered.** A number, once used, is retained even if the ADR is superseded or withdrawn.
- **Never rewrite an accepted ADR to reflect a later decision.** Write a new one and mark the old **Superseded by [NNNN]** — 0010 → 0012 is the worked example.
- **A superseded ADR stays in the tree.** The reasoning that turned out to be wrong is the most useful part.
- Filenames are `NNNN-kebab-case-summary.md`; the `# ADR NNNN — Title` heading matches.
- Add a row here in the same commit that adds the ADR. This index is the only place the full list lives.

## Related

- [architecture.md](../architecture.md) — how the system is built *now* (ADRs say *why*, and may describe a past state)
- [roadmap.md](../roadmap.md) — the index for all planned and in-progress work
- [event-model.md](../event-model.md) · [event-schemas.md](../event-schemas.md) · [view-schemas.md](../view-schemas.md)
