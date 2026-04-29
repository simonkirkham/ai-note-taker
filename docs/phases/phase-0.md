# Phase 0 — Setup

**Goal:** every tool is wired up, hello world deployed end-to-end, first spec passes.

Status key: `Done` · `In Progress` · `Not Started`

---

## Slice 0-A — BDD harness and solution scaffold
**Status:** In Progress (PR #1 open)

**Objective:** Establish the .NET solution structure and prove the BDD spec harness works end-to-end before any domain logic is written.

**Acceptance criteria:**
- [ ] `dotnet build` succeeds across all 5 projects (`Api`, `Domain`, `EventStore`, `Infrastructure`, `Specs`) with 0 errors and 0 warnings
- [ ] BDD harness supports `Given(priorEvents).When(command).Then(expectedEvents)` and `.ThenThrows<TException>()`
- [ ] Two harness specs pass green using a synthetic inline `TestAggregate`
- [ ] Solution file at root wires all projects together

---

## Slice 0-B — Lambda health endpoint and CDK stack
**Status:** Not Started

**Objective:** Provision the core AWS infrastructure and deploy a minimal Lambda with a health endpoint reachable via API Gateway.

**Acceptance criteria:**
- [ ] `cdk synth` exits 0 with a valid CloudFormation template
- [ ] Template includes: DynamoDB table (`notetaker-events`, PK `PK` String, SK `SK` String, `PAY_PER_REQUEST`), Lambda (net8.0), API Gateway HTTP API forwarding all routes to the Lambda
- [ ] `GET /health` returns `200 OK` with body `{ "status": "ok" }` when run locally via `dotnet run`
- [ ] `cdk deploy` succeeds and `GET <api-gateway-url>/health` returns `200 OK`
- [ ] No auth, no VPC, no custom domain

---

## Slice 0-C — CI/CD pipeline
**Status:** Not Started

**Objective:** Automate build, test, and deployment on every PR and merge.

**Acceptance criteria:**
- [ ] GitHub Actions workflow runs on every PR: `dotnet build`, `dotnet test`, `cdk synth` — all must pass before merge is allowed
- [ ] GitHub Actions workflow runs on merge to `main`: deploys to AWS via `cdk deploy`
- [ ] A failed `dotnet test` blocks the PR merge
- [ ] Pipeline uses stored AWS credentials (GitHub Actions secrets)

---

## Slice 0-D — React app scaffold and CDK hosting
**Status:** Not Started

**Objective:** Scaffold the frontend app and serve it from AWS.

**Acceptance criteria:**
- [ ] Vite + React + TypeScript app in `web/` with `npm run dev` working locally
- [ ] `npm run build` produces a `dist/` folder
- [ ] CDK stack updated to provision S3 bucket + CloudFront distribution serving the built app
- [ ] Deployed app is reachable at the CloudFront URL
- [ ] Frontend displays a placeholder page (e.g. "AI Note Taker") — no domain logic yet

---

## Slice 0-E — Local dev loop documented
**Status:** Not Started

**Objective:** Fill in the "How to run" section so any developer (or agent) can get up and running from scratch.

**Acceptance criteria:**
- [ ] `CLAUDE.md` "How to run" section filled in with: `dotnet build`, `dotnet test`, `dotnet run` (Api), `cdk synth`, `cdk deploy`, `npm run dev` (web)
- [ ] README covers: prerequisites (Node, .NET 8, AWS CLI, CDK CLI, `gh`), clone-to-running steps, environment variables required
- [ ] Prerequisites include `cdk bootstrap` note for first-time AWS account setup
