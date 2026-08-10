# ADR 0008 — Multi-layer testing strategy

**Status:** Accepted

## Context

The project has one test layer: domain BDD specs (`tests/Domain.Specs/`) that exercise aggregates in-process via the `BddHarness`. That layer is solid, but four significant gaps exist:

1. `DynamoDbEventStore` is production code with OCC logic (DynamoDB condition expressions, `TransactWriteItems`) that has never run against a real DynamoDB engine.
2. The HTTP layer (routing, status codes, serialisation, error mapping) is only covered by the acceptance suite, which requires a deployed AWS environment and is slow.
3. CDK infrastructure properties (environment variables, IAM grants, deletion policies) are only validated by `cdk synth`, which checks synthesis but not correctness of the resulting template.
4. Frontend UI regressions are only caught by the Playwright browser suite, which requires a live deployed environment, costs time and money, and gives slow feedback for UI-only changes.

The sole safety net for gaps 2 and 3 today is the post-deploy acceptance suite in `tests/Api.Smoke/`, which is environment-dependent, costs money to run, and gives imprecise failure messages.

## Decision

Adopt a seven-layer testing strategy. Each layer has a single responsibility and a distinct speed/cost profile.

| Layer | Type | Tool | Project | Run on |
|-------|------|------|---------|--------|
| 1 — Domain | BDD unit specs | xUnit + BddHarness | `tests/Domain.Specs/` | Every PR |
| 2 — Event store | Integration (Docker) | Testcontainers + DynamoDB Local | `tests/EventStore.Integration/` | Every PR |
| 3 — API HTTP | Integration (in-process) | WebApplicationFactory + InMemoryEventStore | `tests/Api.Integration/` | Every PR |
| 4 — API smoke | Smoke (deployed) | xUnit + HttpClient | `tests/Api.Smoke/` | Post-deploy |
| 5 — Infrastructure | CDK assertions | AWS CDK Assertions (C#) | `tests/Infrastructure.Assertions/` | Every PR |
| 6 — E2E journeys | Browser (deployed) | Playwright for .NET + xUnit | `tests/Browser.E2E/` | Post-deploy |
| 7 — Frontend components | Component (in-process) | Vitest + RTL + MSW | `web/src/__tests__/` | Every PR |

**Layer 1 — Domain BDD specs**
Pure in-process tests. Given prior events → When command → Then emitted events or exception. 100 % of aggregate commands and boundary conditions must have a spec. No change to the existing approach.

**Layer 2 — Event store integration**
Spin up DynamoDB Local via Testcontainers — from AWS's ECR Public copy (`public.ecr.aws/aws-dynamodb-local/aws-dynamodb-local`), not Docker Hub: identical image, no anonymous-pull rate limit (TI-71). Create the events table; run `DynamoDbEventStore` against it. Covers: append + read round-trip, OCC conflict (two writers, same `expectedVersion`), empty stream reads, multi-event batches, and table schema correctness. Teardown is automatic. Requires Docker in CI.

**Layer 3 — API HTTP integration**
Use `WebApplicationFactory<Program>` to host the ASP.NET app in-process. Override DI registrations to substitute `InMemoryEventStore` (and an in-memory projection store). Covers: route matching, HTTP verbs, path parameter binding, status codes (201/409/200/404), response body shape, and error-to-status-code mapping. No Docker, no AWS credentials.

**Layer 4 — API smoke**
Hit the real deployed API via `HttpClient`. Validates that IAM permissions, real DynamoDB tables, Lambda cold-start, and API Gateway routing all work together. Each test is self-contained (arranges its own data; no cross-test ordering dependencies). Lives in `tests/Api.Smoke/` — a standalone project with no reference to production code. A shared `DeployedApiFixture` reads `API_BASE_URL` from the environment and **throws in its constructor** if the variable is absent, so the suite fails the build rather than silently passing. Only run post-deploy.

**Layer 5 — CDK assertions**
Use the AWS CDK `Template.FromStack()` assertion API to make infrastructure properties testable. Covers: Lambda environment variables wired correctly, IAM grants present, DynamoDB tables have `RETAIN` deletion policy, CloudFront SPA error responses configured. Runs in-process against the synthesised CloudFormation template — no AWS account needed.

**Layer 6 — E2E browser journey tests**
Use Playwright for .NET to drive a real Chromium browser against the deployed CloudFront frontend. Tests are structured as BDD Given/When/Then journeys in `tests/Browser.E2E/Journeys/`. A Page Object (`tests/Browser.E2E/Pages/AppPage.cs`) encapsulates all `data-testid` selectors, keeping journey specs declarative. A shared `BrowserFixture` creates one `IBrowser` instance per run; each test gets an isolated `IBrowserContext` (separate cookies and local storage). The fixture reads `FRONTEND_URL` from the environment and **throws in its constructor** if absent, failing the build rather than silently passing. Only run post-deploy.

The suite is kept small deliberately: only journeys that verify a full-stack wiring path where a real deployment failure would not be caught by any faster layer. The five retained journeys are `CreateAndListNoteJourney`, `TagsJourney`, `NoteDeleteJourney`, `ActionItemJourney`, and `FolderNavigationJourney`. UI-only behaviour (layout, date pickers, sidebar state, todo rendering) is covered by Layer 7 instead.

**Layer 7 — Frontend component tests**
Use Vitest as the Vite-native test runner with React Testing Library and MSW. Components render against `jsdom`; MSW intercepts `fetch` at the network boundary so components call `fetch` exactly as in production — no module mocking, no real network. Tests assert on what the user sees (`screen.getByRole`, `findByText`) rather than implementation details. Lives in `web/src/__tests__/`. Runs in milliseconds with no browser and no deployed environment. Covers the UI-layer regressions that were previously only caught by the Playwright suite.

## Consequences

- `DynamoDbEventStore` OCC logic is exercised against a real engine on every PR; schema and condition-expression bugs surface before deployment.
- HTTP routing and serialisation regressions are caught in-process without AWS credentials; the API smoke suite is a thin post-deploy wiring check rather than the primary safety net.
- CDK refactors that accidentally remove environment variables or IAM grants fail fast in CI.
- Frontend UI regressions are caught on every PR in milliseconds; the Playwright suite is trimmed to 5 journeys that genuinely require a live deployment.
- CI requires Docker (for Layer 2). This is the only infrastructure dependency beyond Node.
- Test projects: `tests/Domain.Specs/`, `tests/EventStore.Integration/`, `tests/Api.Integration/`, `tests/Api.Smoke/`, `tests/Infrastructure.Assertions/`, `tests/Browser.E2E/`, and `web/src/__tests__/`. The smoke and E2E projects have no production code references and are not included in the PR suite.
- Frontend UI elements must carry `data-testid` attributes so Playwright selectors remain stable under style changes.

## Alternatives considered

- **DynamoDB Local without Testcontainers** (manually managed process) — works but complicates CI setup; Testcontainers handles lifecycle automatically.
- **LocalStack instead of DynamoDB Local** — broader AWS emulation; heavier image and slower startup for a use case that only needs DynamoDB.
- **Test all layers with the acceptance suite only** — no Docker dependency, but couples CI to a deployed environment and gives slow, imprecise feedback on domain and API regressions.
- **Skip CDK assertions** — acceptable for now, but environment-variable omissions are a recurring class of Lambda bug that a 5-line assertion prevents.
