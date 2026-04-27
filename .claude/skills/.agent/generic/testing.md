# Testing — Principles

## Co-location

Place test files next to the source file they test (e.g. `index.test.ts` alongside `index.ts`). Do not create a separate `tests/` directory unless the project already uses one.

## What to Unit Test

- Pure logic — always unit test (parsing, normalisation, routing, calculations)
- External service calls — mock the client, assert the call parameters
- Infrastructure config — unit test the configuration values themselves

## What Not to Unit Test

- End-to-end invocation of deployed services — cover this with integration tests post-deploy
- Third-party library internals — test your usage of them, not their implementation
- Things that cannot fail independently — do not write tests that only pass because the mock always returns what you told it to

## Mocking

- Mock at the boundary of your code (external APIs, databases, file system)
- Assert on what was called and with what arguments — not just that no error was thrown
- Keep mocks minimal; only stub what the test actually exercises

## Integration Tests

Integration tests run against a deployed environment, not locally. They exist to catch failures that unit tests cannot — misconfigured infrastructure, incorrect IAM permissions, real network behaviour.

- Do not try to replicate integration tests as unit tests
- If an integration test fails, the problem is likely in infrastructure or deployment config, not application logic

## Watch Mode

Use watch mode when iterating on a specific area — run the full suite before pushing.
