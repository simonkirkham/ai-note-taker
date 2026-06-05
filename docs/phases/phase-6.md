# Phase 6 — Upgrade to .NET 10

**Goal:** Migrate every project in the solution from .NET 8 to .NET 10 and update the Lambda runtime to match. .NET 8 and .NET 10 are both LTS releases; this is an LTS → LTS upgrade that skips the non-LTS .NET 9.

## Summary

| Slice | Summary | Status | Depends on |
|-------|---------|--------|------------|
| 6-A | Bump framework and packages; green build and tests locally | Done | — |
| 6-B | Update Lambda runtime in CDK; redeploy; smoke test | Done | 6-A |
| 6-C | Measure cold starts; enable Lambda SnapStart | Done | 6-B |

---

## Slice 6-A — Bump framework and packages; green build and tests locally

**Status:** Done

### Scenarios

```
Scenario: Solution builds clean after the framework bump
  Given all .csproj files target net10.0 and packages are updated
  When  dotnet build ai-note-taker.sln is run
  Then  0 errors and 0 warnings

Scenario: BDD domain specs are green
  Given the framework bump is applied
  When  dotnet test tests/Specs/Specs.csproj is run
  Then  all specs pass

Scenario: In-process API integration tests are green
  Given the framework bump and Microsoft.AspNetCore.Mvc.Testing update are applied
  When  dotnet test tests/ApiIntegration/ApiIntegration.csproj is run
  Then  all tests pass

Scenario: DynamoDB integration tests are green
  Given the framework bump is applied
  When  dotnet test tests/EventStoreIntegration/EventStoreIntegration.csproj is run
  Then  all tests pass (Docker required)

Scenario: CDK assertions are green
  Given the framework bump is applied
  When  dotnet test tests/InfraAssertions/InfraAssertions.csproj is run
  Then  all assertions pass
```

### Acceptance criteria

- [x] Every `.csproj` targets `net10.0`
- [x] `dotnet build ai-note-taker.sln` exits 0 with 0 errors and 0 warnings
- [x] `dotnet test tests/Specs/Specs.csproj` — all green
- [x] `dotnet test tests/ApiIntegration/ApiIntegration.csproj` — all green
- [x] `dotnet test tests/EventStoreIntegration/EventStoreIntegration.csproj` — all green (Docker required)
- [x] `dotnet test tests/InfraAssertions/InfraAssertions.csproj` — all green
- [x] `cdk synth` exits 0 (Lambda runtime line may still reference `DOTNET_8` at this point — that is fixed in 6-B)

---

## Slice 6-B — Update Lambda runtime in CDK; redeploy; smoke test

**Status:** Done

### Scenarios

```
Scenario: CDK template references the .NET 10 runtime
  Given the runtime constant is updated to Runtime.DOTNET_10
  When  cdk synth is run
  Then  the CloudFormation template shows runtime "dotnet10"

Scenario: Deployed Lambda responds on .NET 10
  Given cdk deploy has completed with the .NET 10 package
  When  GET <api-gateway-url>/health is called
  Then  200 OK with { "status": "ok" }

Scenario: Acceptance tests pass against the redeployed API
  Given the Lambda is running on .NET 10
  When  the acceptance test suite is run against the live API_BASE_URL
  Then  all acceptance specs pass

Scenario: E2E browser journey passes against the live frontend
  Given the Lambda is running on .NET 10
  When  the E2E suite is run against the live FRONTEND_URL
  Then  all E2E journeys pass
```

### Acceptance criteria

- [x] `src/Infrastructure/NoteTakerStack.cs` uses `Runtime.DOTNET_10`
- [x] CDK template assertion updated; `dotnet test tests/InfraAssertions/` green
- [x] `cdk synth` exits 0 with `runtime: dotnet10` in the generated template
- [x] `cdk deploy` succeeds with the `net10.0` publish output
- [x] `GET /health` returns 200 on the deployed Lambda
- [x] `API_BASE_URL=<url> dotnet test tests/Acceptance/Acceptance.csproj` — all green
- [x] `FRONTEND_URL=<url> dotnet test tests/E2E/E2E.csproj` — all green

---

## Slice 6-C — Measure cold starts; enable Lambda SnapStart

**Status:** Done

### Scenarios

```
Scenario: Baseline cold start is recorded before SnapStart
  Given the Lambda has been idle long enough to be recycled
  When  the first request is made
  Then  CloudWatch logs show an Init Duration entry (record this value)

Scenario: CDK template enables SnapStart on published versions
  Given SnapStart is configured on the Lambda function
  When  cdk synth is run
  Then  the CloudFormation template shows SnapStart ApplyOn: PublishedVersions

Scenario: API Gateway routes through the versioned alias
  Given the alias targets the published version
  When  cdk synth is run
  Then  the API Gateway integration targets the alias ARN, not the function ARN

Scenario: Cold start is eliminated after SnapStart
  Given SnapStart is enabled and a version has been published
  When  the first request is made after Lambda recycling
  Then  CloudWatch logs show no Init Duration entry (restore from snapshot instead)

Scenario: Acceptance tests pass with the alias-backed deployment
  Given the API Gateway routes via the alias
  When  the acceptance test suite is run
  Then  all acceptance specs pass
```

### Acceptance criteria

- [x] Baseline Init Duration recorded from CloudWatch before the change (~490 ms)
- [x] `NoteTakerStack.cs` declares `SnapStart = SnapStartConf.ON_PUBLISHED_VERSIONS`
- [x] A `Version` and `Alias` construct are defined; API Gateway integration targets the alias
- [x] `cdk synth` shows `SnapStart.ApplyOn: PublishedVersions` in the CloudFormation template
- [x] InfraAssertions test asserts SnapStart config is present
- [x] `cdk deploy` succeeds
- [x] Post-deploy invocations show no `Init Duration` in CloudWatch (SnapStart restored from snapshot)
- [x] `sleep 15` warm-up step removed from `deploy.yml`
- [x] All acceptance tests pass
