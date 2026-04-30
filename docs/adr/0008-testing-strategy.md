# ADR 0008 — Multi-layer testing strategy

**Status:** Accepted

## Context

The project has one test layer: domain BDD specs (`tests/Specs/`) that exercise aggregates in-process via the `BddHarness`. That layer is solid, but three significant gaps exist:

1. `DynamoDbEventStore` is production code with OCC logic (DynamoDB condition expressions, `TransactWriteItems`) that has never run against a real DynamoDB engine.
2. The HTTP layer (routing, status codes, serialisation, error mapping) is only covered by the acceptance suite, which requires a deployed AWS environment and is slow.
3. CDK infrastructure properties (environment variables, IAM grants, deletion policies) are only validated by `cdk synth`, which checks synthesis but not correctness of the resulting template.

The sole safety net for layers 2 and 3 today is the post-deploy acceptance suite in `tests/Acceptance/`, which is environment-dependent, costs money to run, and gives imprecise failure messages.

## Decision

Adopt a five-layer testing strategy. Each layer has a single responsibility and a distinct speed/cost profile.

| Layer | Type | Tool | Project | Run on |
|-------|------|------|---------|--------|
| 1 — Domain | BDD unit specs | xUnit + BddHarness | `tests/Specs/` | Every PR |
| 2 — Event store | Integration (Docker) | Testcontainers + DynamoDB Local | `tests/EventStoreIntegration/` | Every PR |
| 3 — API HTTP | Integration (in-process) | WebApplicationFactory + InMemoryEventStore | `tests/ApiIntegration/` | Every PR |
| 4 — Acceptance | Smoke (deployed) | xUnit + HttpClient | `tests/Acceptance/` | Post-deploy |
| 5 — Infrastructure | CDK assertions | AWS CDK Assertions (C#) | `tests/InfraAssertions/` | Every PR |

**Layer 1 — Domain BDD specs (existing)**
Pure in-process tests. Given prior events → When command → Then emitted events or exception. 100 % of aggregate commands and boundary conditions must have a spec. No change to the existing approach.

**Layer 2 — Event store integration**
Spin up `amazon/dynamodb-local` via Testcontainers; create the events table; run `DynamoDbEventStore` against it. Covers: append + read round-trip, OCC conflict (two writers, same `expectedVersion`), empty stream reads, multi-event batches, and table schema correctness. Teardown is automatic. Requires Docker in CI.

**Layer 3 — API HTTP integration**
Use `WebApplicationFactory<Program>` to host the ASP.NET app in-process. Override DI registrations to substitute `InMemoryEventStore` (and an in-memory projection store). Covers: route matching, HTTP verbs, path parameter binding, status codes (201/409/200/404), response body shape, and error-to-status-code mapping. No Docker, no AWS credentials.

**Layer 4 — Acceptance / smoke (existing, expand incrementally)**
Hit the real deployed API via `HttpClient`. Validates that IAM permissions, real DynamoDB tables, Lambda cold-start, and API Gateway routing all work together. Each fact must be self-contained (arrange its own data; no cross-test ordering dependencies). Gated on `API_BASE_URL` environment variable so the suite is skipped locally.

**Layer 5 — CDK assertions**
Use the AWS CDK `Template.FromStack()` assertion API to make infrastructure properties testable. Covers: Lambda environment variables wired correctly, IAM grants present, DynamoDB tables have `RETAIN` deletion policy, CloudFront SPA error responses configured. Runs in-process against the synthesised CloudFormation template — no AWS account needed.

## Consequences

- `DynamoDbEventStore` OCC logic is exercised against a real engine on every PR; schema and condition-expression bugs surface before deployment.
- HTTP routing and serialisation regressions are caught in-process without AWS credentials; the acceptance suite becomes a thin post-deploy smoke check rather than the primary safety net.
- CDK refactors that accidentally remove environment variables or IAM grants fail fast in CI.
- CI requires Docker (for Layer 2). This is the only new infrastructure dependency.
- Two new xUnit projects (`tests/EventStoreIntegration/`, `tests/ApiIntegration/`) and one CDK test project (`tests/InfraAssertions/`) are added to the solution.

## Alternatives considered

- **DynamoDB Local without Testcontainers** (manually managed process) — works but complicates CI setup; Testcontainers handles lifecycle automatically.
- **LocalStack instead of DynamoDB Local** — broader AWS emulation; heavier image and slower startup for a use case that only needs DynamoDB.
- **Test all layers with the acceptance suite only** — no Docker dependency, but couples CI to a deployed environment and gives slow, imprecise feedback on domain and API regressions.
- **Skip CDK assertions** — acceptable for now, but environment-variable omissions are a recurring class of Lambda bug that a 5-line assertion prevents.
