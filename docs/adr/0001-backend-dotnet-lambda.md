# ADR 0001 — Backend on .NET 8 + AWS Lambda

**Status:** Accepted

## Context

Need a serverless backend that maximises learning carry-over from existing .NET experience. Other languages (Node, Python, Go) would add a fourth language to learn alongside event sourcing, agentic workflows and React. Goal is to keep one variable constant while stretching others.

## Decision

Use **.NET 8** on **AWS Lambda**, hosted as a single ASP.NET minimal API behind one Lambda via the `LambdaEntryPoint` pattern.

## Consequences

- Familiar language; learning bandwidth stays focused on event sourcing, infra, and agentic workflows.
- Cold starts of 1–3 seconds on first invocation. Acceptable for a learning project. Mitigations (SnapStart, Native AOT) deferred until they become a real annoyance.
- AWS Lambda Annotations framework is an option if we want per-endpoint Lambdas later.
- CDK in C# (see ADR 0004) keeps the language consistent across backend and infra.

## Alternatives considered

- **Node + TypeScript Lambdas** — better cold starts, biggest ecosystem, but adds a third major language to learn.
- **Containerised .NET on Fargate / App Runner** — avoids cold starts but loses the serverless-zero-cost benefit.
