# Phase 6 — Upgrade to .NET 10

**Goal:** Migrate every project in the solution from .NET 8 to .NET 10 and update the Lambda runtime to match. .NET 8 and .NET 10 are both LTS releases; this is an LTS → LTS upgrade that skips the non-LTS .NET 9.

**Learning surface:** .NET release cadence and the LTS/STS distinction; AWS Lambda managed runtime lifecycle and how runtime updates map to CDK `Runtime.*` constants; auditing package compatibility across a multi-project solution; working through BCL and framework-layer breaking changes introduced across two major versions; the test suite as a safety net for a runtime upgrade.

---

## What needs to change

| Area | Current | Target |
|------|---------|--------|
| `TargetFramework` (all 10 `.csproj` files) | `net8.0` | `net10.0` |
| `Microsoft.AspNetCore.Mvc.Testing` (ApiIntegration) | `8.0.0` | `10.0.x` |
| `Amazon.Lambda.AspNetCoreServer.Hosting` (Api) | `1.7.2` | latest supporting .NET 10 |
| Lambda runtime in CDK stack | `Runtime.DOTNET_8` | `Runtime.DOTNET_10` |

AWS SDK packages (`AWSSDK.DynamoDBv2`, `AWSSDK.Extensions.NETCore.Setup`), CDK packages (`Amazon.CDK.Lib`, `Constructs`), and test tooling (`xunit`, `Microsoft.NET.Test.Sdk`, `Testcontainers.DynamoDb`) all target `netstandard2.0` or are framework-agnostic and should not require version changes to build; update them only if the build requires it or newer versions ship relevant fixes.

---

## Slice order and dependencies

```
6-A  Bump framework and packages; green build and tests locally
6-B  Update Lambda runtime in CDK; redeploy; smoke test  (depends 6-A)
6-C  Measure cold starts; enable Lambda SnapStart               (depends 6-B)
```

---

## Slice 6-A — Bump framework and packages; green build and tests locally

**Status:** Done

**Value:** All projects compile and all tests pass against .NET 10 on the local machine. No AWS changes yet — this slice is purely a local build gate.

**Changes in scope:**

- All 10 `.csproj` files: `net8.0` → `net10.0`
- `tests/ApiIntegration/ApiIntegration.csproj`: `Microsoft.AspNetCore.Mvc.Testing` version → `10.0.x`
- `src/Api/Api.csproj`: `Amazon.Lambda.AspNetCoreServer.Hosting` → latest version supporting .NET 10
- Fix any build errors or warnings introduced by .NET 9/10 breaking changes

**Key implementation files:**
- All `.csproj` files in `src/` and `tests/`
- Any source files the compiler flags during the upgrade

**Breaking-change areas to check** (between .NET 8 → 10 via the .NET 9 and .NET 10 changelogs):
- `System.Text.Json` serialisation behaviour changes — verify `NoteDetail`, `NoteCard`, and event payload round-trips
- Nullable reference type analysis strictness — new warnings may become errors under `Nullable=enable`
- `DateOnly` / `DateTimeOffset` formatting — used in event envelopes and projection DTOs
- Any BCL method removals or obsolete-to-error promotions

**Scenarios:**

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

**Acceptance criteria:**

- [ ] Every `.csproj` targets `net10.0`
- [ ] `dotnet build ai-note-taker.sln` exits 0 with 0 errors and 0 warnings
- [ ] `dotnet test tests/Specs/Specs.csproj` — all green
- [ ] `dotnet test tests/ApiIntegration/ApiIntegration.csproj` — all green
- [ ] `dotnet test tests/EventStoreIntegration/EventStoreIntegration.csproj` — all green (Docker required)
- [ ] `dotnet test tests/InfraAssertions/InfraAssertions.csproj` — all green
- [ ] `cdk synth` exits 0 (Lambda runtime line may still reference `DOTNET_8` at this point — that is fixed in 6-B)

---

## Slice 6-B — Update Lambda runtime in CDK; redeploy; smoke test

**Status:** Done

**Value:** The deployed Lambda runs on the .NET 10 managed runtime. Post-deploy acceptance tests and the E2E browser journey confirm the upgrade is live and nothing regressed.

**Changes in scope:**

- `src/Infrastructure/NoteTakerStack.cs`: change Lambda runtime constant from `Runtime.DOTNET_8` to `Runtime.DOTNET_10`
- `tests/InfraAssertions/`: update any CDK template assertion that asserts `dotnet8` runtime → `dotnet10`
- Rebuild the deployment package (`dotnet publish` targeting `net10.0`) and run `cdk deploy`

**Key implementation files:**
- `src/Infrastructure/NoteTakerStack.cs`
- `tests/InfraAssertions/` (runtime assertion)

**Scenarios:**

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

**Acceptance criteria:**

- [ ] `src/Infrastructure/NoteTakerStack.cs` uses `Runtime.DOTNET_10`
- [ ] CDK template assertion updated; `dotnet test tests/InfraAssertions/` green
- [ ] `cdk synth` exits 0 with `runtime: dotnet10` in the generated template
- [ ] `cdk deploy` succeeds with the `net10.0` publish output
- [ ] `GET /health` returns 200 on the deployed Lambda
- [ ] `API_BASE_URL=<url> dotnet test tests/Acceptance/Acceptance.csproj` — all green
- [ ] `FRONTEND_URL=<url> dotnet test tests/E2E/E2E.csproj` — all green

---

## Slice 6-C — Measure cold starts; enable Lambda SnapStart

**Status:** Not Started

**Value:** Cold start latency for .NET Lambda functions is a known pain point — visible in the workflow log as a `sleep 15` workaround and repeated 500s on first post-deploy invocations. This slice measures the baseline, enables Lambda SnapStart (AWS's snapshot-based cold start elimination for managed runtimes), and verifies the improvement. The CDK change requires introducing a published Lambda version and an alias, which also teaches the version/alias deployment model.

**Learning surface:** How Lambda initialises a .NET runtime; what SnapStart does (snapshot of the initialised execution environment, restored instead of re-initialised); the `$LATEST` vs version vs alias distinction in Lambda; how CDK models versions and aliases; why API Gateway must target an alias (not `$LATEST`) for SnapStart to apply.

**Changes in scope:**

- `src/Infrastructure/NoteTakerStack.cs`:
  - Add `SnapStart = SnapStartConf.ON_PUBLISHED_VERSIONS` to the Lambda function
  - Publish a `Version` construct (`new Amazon.CDK.AWS.Lambda.Version(...)`) after function definition
  - Create an `Alias` construct pointing to the version (e.g. `live`)
  - Update the `HttpLambdaIntegration` to target the alias, not the function directly
- `tests/InfraAssertions/InfraAssertionsTests.cs`: assert SnapStart config is present in the CloudFormation template
- `deploy.yml`: remove the `sleep 15` warm-up step once SnapStart is confirmed working

**Key implementation files:**
- `src/Infrastructure/NoteTakerStack.cs`
- `tests/InfraAssertions/InfraAssertionsTests.cs`
- `.github/workflows/deploy.yml`

**How to measure baseline before the change:**
```bash
# Invoke the cold Lambda (after a period of inactivity or fresh deploy)
# Check CloudWatch Logs for the Init Duration line:
# REPORT RequestId: ...  Init Duration: 1234.56 ms  ...
aws logs filter-log-events \
  --log-group-name /aws/lambda/NoteTakerStack-ApiFunction* \
  --filter-pattern "Init Duration" \
  --query 'events[*].message'
```

**Scenarios:**

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

**Acceptance criteria:**

- [ ] Baseline Init Duration recorded from CloudWatch before the change
- [ ] `NoteTakerStack.cs` declares `SnapStart = SnapStartConf.ON_PUBLISHED_VERSIONS`
- [ ] A `Version` and `Alias` construct are defined; API Gateway integration targets the alias
- [ ] `cdk synth` shows `SnapStart.ApplyOn: PublishedVersions` in the CloudFormation template
- [ ] InfraAssertions test asserts SnapStart config is present
- [ ] `cdk deploy` succeeds
- [ ] Post-deploy invocations show no `Init Duration` in CloudWatch (SnapStart restored from snapshot)
- [ ] `sleep 15` warm-up step removed from `deploy.yml`
- [ ] All acceptance tests pass
