# ADR 0002 — Event store on DynamoDB

**Status:** Accepted

## Context

Need an event store for the system. Two main paths in .NET:

- **Marten on PostgreSQL** — the most mature .NET event sourcing library. Handles streams, snapshots, projections out of the box.
- **DynamoDB** — fully serverless, scales to zero, near-zero cost at hobby usage. Library ecosystem in .NET is thin; mature ES libraries don't target it natively.

Trade-off: library maturity vs serverless purity and cost.

## Decision

Use **DynamoDB** as the event store, with a **lightweight community helper library** rather than rolling primitives from zero or switching to Marten.

## Consequences

- True serverless: zero cost when idle, no Aurora minimum (~$40/month).
- Helper library is thinner than Marten, so we'll write more event sourcing plumbing ourselves than we would on Postgres — accepted as part of the learning value.
- Event-store-specific code lives in `src/EventStore/` and is the only layer permitted to write to DynamoDB.
- Need our own append-with-optimistic-concurrency, projection rebuild, and stream-read helpers.

## Alternatives considered

- **Marten on Aurora Serverless v2** — most mature library; rejected for the Aurora minimum cost and to keep the project on a true scale-to-zero stack.
- **EventStore DB (cloud)** — purpose-built but adds a third-party dependency and isn't AWS-native.
- **Hand-rolled on Postgres without Marten** — combines the worst of both options.
