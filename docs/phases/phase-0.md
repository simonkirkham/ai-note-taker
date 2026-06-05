# Phase 0 — Setup

**Goal:** one API, fully built, tested with a BDD acceptance spec, and deployed through a pipeline to AWS. Nothing expands until this is solid.

## Summary

| Slice | Summary | Status | Depends on |
|-------|---------|--------|------------|
| 0-A | BDD harness and solution scaffold | Done | — |
| 0-B | Lambda health endpoint and CDK stack | Done | — |
| 0-C | BDD acceptance spec for deployed Lambda | Done | — |
| 0-D | CI/CD pipeline | Done | — |
| 0-E | Local dev loop documented | Done | — |
| Deferred | React app scaffold and CDK hosting | Deferred | — |

---

## Slice 0-A — BDD harness and solution scaffold
**Status:** Done

**Acceptance criteria:**
- [x] `dotnet build` succeeds across all 5 projects (`Api`, `Domain`, `EventStore`, `Infrastructure`, `Specs`) with 0 errors and 0 warnings
- [x] BDD harness supports `Given(priorEvents).When(command).Then(expectedEvents)` and `.ThenThrows<TException>()`
- [x] Two harness specs pass green using a synthetic inline `TestAggregate`
- [x] Solution file at root wires all projects together

---

## Slice 0-B — Lambda health endpoint and CDK stack
**Status:** Done

**Acceptance criteria:**
- [x] `GET /health` returns `200 OK` with body `{ "status": "ok" }` when run locally via `dotnet run`
- [x] `cdk synth` exits 0 with a valid CloudFormation template
- [x] Template includes: Lambda (net8.0) and API Gateway HTTP API forwarding all routes to the Lambda
- [x] `cdk deploy` succeeds and `GET <api-gateway-url>/health` returns `200 OK`
- [x] No auth, no VPC, no custom domain

---

## Slice 0-C — BDD acceptance spec for deployed Lambda
**Status:** Done

**Acceptance criteria:**
- [x] A BDD acceptance spec exists: `Given` the Lambda is deployed, `When` `GET /health` is called against the live API Gateway URL, `Then` the response is `200 OK` with `{ "status": "ok" }`
- [x] The spec reads the API Gateway URL from an environment variable (`API_BASE_URL`); it is skipped (not failed) when the variable is absent so the suite stays green locally without AWS access
- [x] `dotnet test` with `API_BASE_URL` set to the deployed URL passes green

---

## Slice 0-D — CI/CD pipeline
**Status:** Done

**Acceptance criteria:**
- [x] PR workflow runs: `dotnet build` (0 warnings), `dotnet test` (unit/BDD specs), `cdk synth` — all must pass before merge is allowed
- [x] Merge-to-main workflow runs: `dotnet publish`, `cdk deploy`, then `dotnet test` with `API_BASE_URL` set to the live endpoint (acceptance spec must pass)
- [x] A failed `dotnet test` or failed acceptance spec blocks the merge / rolls back
- [x] Pipeline uses stored AWS credentials (GitHub Actions secrets)

---

## Slice 0-E — Local dev loop documented
**Status:** Done

**Acceptance criteria:**
- [x] `CLAUDE.md` "How to run" section filled in with: `dotnet build`, `dotnet test`, `dotnet run` (Api), `cdk synth`, `cdk deploy`
- [x] README covers: prerequisites (.NET 8, AWS CLI, CDK CLI, `gh`), clone-to-running steps, environment variables required
- [x] README includes `cdk bootstrap` note for first-time AWS account setup
- [x] Pre-commit hook at `.githooks/pre-commit` runs `dotnet build` (warnings-as-errors) and `dotnet test`; commit is blocked if either fails
- [x] Hook is activated via `git config core.hooksPath .githooks` — this command is documented in the README setup steps
- [x] `cdk synth` is excluded from the hook (requires a full publish, too slow for pre-commit)

---

## Deferred — React app scaffold and CDK hosting
**Status:** Deferred
