# Starting a new project from this template

Everything you had to do once to reach Phase 0 complete (deployed Lambda, green pipeline, BDD harness, five-role agent workflow). Use this as the checklist when starting a fresh project that follows the same stack and workflow.

---

## What to copy verbatim

These artefacts contain no project-specific content and can be dropped straight in:

| Artefact | Why |
|---|---|
| `.claude/skills/` (entire directory) | All domain skills (`aggregate-command`, `cdk-stack-update`, `dynamodb-event-append`, `event-modelling`, `projection`) plus generic agent role docs (`.agent/generic/`) |
| `docs/agent-workflow.md` | The five-role pipeline (Scout → Breaker → Pip → Hawk → Scribe) with hand-off rules, RACI table, and blocked-state protocol |
| `.githooks/pre-commit` | `dotnet build` (warnings-as-errors) + `dotnet test` before every commit |
| `docs/workflow-log.md` | Template only — delete the Phase 0 entry and keep the header and template block |

## What to copy and adapt

| Artefact | What to change |
|---|---|
| `CLAUDE.md` | Update project name, stack section, layout section if folder names differ, and skill catalogue if you add or remove skills |
| `.github/workflows/pr.yml` | Update solution name in `dotnet build` command; update CDK stack output key in `cdk synth` step if stack name changes |
| `.github/workflows/deploy.yml` | Update solution name; update `jq` key (`.NoteTakerStack.ApiUrl`) to match your CDK stack output name |
| `.claude/settings.local.json` | Keep the permission allowlist structure; remove or replace the `gh.exe` Windows path with the `gh` path for your environment |
| `cdk.json` | Update `app` field to point to your CDK app assembly |
| `docs/goals.md` | Replace learning goals with yours |
| `docs/roadmap.md` | Replace phase list with yours |

## What to build from scratch

### 1. GitHub repository

Create the repo, push an initial commit, then configure:

- **Branch protection on `main`:** require PR, require status checks (`check` job from `pr.yml`), no force push.
- **GitHub Actions environment named `Test`** with three secrets:
  - `AWS_ACCESS_KEY_ID`
  - `AWS_SECRET_ACCESS_KEY`
  - `AWS_REGION`

### 2. .NET solution structure

Five projects, all targeting `net8.0`:

```
<name>.sln
src/Api/          — ASP.NET minimal API, Lambda entry point
src/Domain/       — aggregates, commands, events (no I/O)
src/EventStore/   — DynamoDB append + projection plumbing
src/Infrastructure/ — CDK app
tests/Specs/      — BDD specs (xUnit)
```

Commands to scaffold:

```bash
dotnet new sln -n <name>
dotnet new web -n Api -o src/Api --framework net8.0
dotnet new classlib -n Domain -o src/Domain --framework net8.0
dotnet new classlib -n EventStore -o src/EventStore --framework net8.0
dotnet new console -n Infrastructure -o src/Infrastructure --framework net8.0
dotnet new xunit -n Specs -o tests/Specs --framework net8.0

dotnet sln add src/Api src/Domain src/EventStore src/Infrastructure tests/Specs
```

**Critical:** verify `net8.0` in every `.csproj` after scaffolding — `dotnet new` defaults to whatever SDK is installed locally.

### 3. BDD harness

Add to `tests/Specs/`:

- `Harness/BddHarness.cs` — `Given(events).When(command).Then(expected)` fluent builder
- `Harness/SpecHarnessSpecs.cs` — two smoke tests using a `TestAggregate` so you know the harness itself is correct before any real specs are written

The harness must:
- Support both `.Then(expectedEvents)` and `.ThenThrows<TException>()`
- Be self-contained with no dependencies outside the project
- Pass green immediately — the two smoke tests are the acceptance criteria for the harness slice

### 4. Lambda and CDK stack

Minimum viable stack for Phase 0:

- **Lambda:** `net8.0`, ASP.NET minimal API with a single `GET /health` endpoint returning `{ "status": "ok" }`
- **CDK:** `HttpApi` → Lambda integration, no auth, no VPC, single output export `ApiUrl`
- **`cdk.json`:** `app` field points to `dotnet run --project src/Infrastructure`

Add `Amazon.Lambda.AspNetCoreServer.Hosting` NuGet to `Api`; add the CDK and Lambda NuGets to `Infrastructure`.

Run `cdk bootstrap` once per AWS account/region before first deploy.

### 5. Acceptance spec

A BDD spec that calls the real deployed endpoint:

```csharp
[Fact]
public async Task HealthEndpointReturnsOk()
{
    var baseUrl = Environment.GetEnvironmentVariable("API_BASE_URL");
    Skip.If(baseUrl is null, "API_BASE_URL not set — skipping acceptance spec");
    // ... HTTP call and assert
}
```

Use `xunit.v3.extensions` or similar for `Skip.If`. The spec is **skipped** (not failed) locally when `API_BASE_URL` is absent so the suite stays green without AWS access.

### 6. Pre-commit hook

```bash
mkdir .githooks
# copy .githooks/pre-commit from this repo
chmod +x .githooks/pre-commit
git config core.hooksPath .githooks
```

Document the `git config` step in the README — it is not automatic on clone.

### 7. CI/CD workflows

Copy `pr.yml` and `deploy.yml`. The two jobs are:

- **PR:** build (warnings-as-errors) → test → publish → `cdk synth`
- **Deploy (main):** publish → `cdk deploy` → extract `ApiUrl` from `outputs.json` → acceptance specs with `API_BASE_URL` set

The `outputs.json` extraction uses `jq`. The `ubuntu-latest` runner has `jq` pre-installed; no need to install it.

The CDK stack **must export `ApiUrl`** as a CloudFormation output, or the `jq` extraction step silently returns `null` and the acceptance spec skips rather than fails.

### 8. docs/ structure

Create these files before any feature work starts:

```
docs/
  goals.md            — what you're learning and why
  roadmap.md          — phases and high-level milestones
  architecture.md     — stack, topology diagram, key decisions
  event-model.md      — commands, events, projections (start empty, fill as you go)
  event-schemas.md    — wire shapes for events
  view-schemas.md     — wire shapes for read projections
  workflow-log.md     — copy template from this repo
  agent-workflow.md   — copy verbatim from this repo
  adr/                — one file per architectural decision
  learnings/          — one file per completed slice (Hawk + Scribe write here)
  phases/             — one file per phase (Scout writes here)
```

---

## Setup sequence

Do these in order. Each step has a clear pass/fail signal — don't move forward until it's green.

1. **Repo + branch protection** — confirm you can't push directly to main
2. **Scaffold .NET solution** — `dotnet build` exits 0 with 0 warnings
3. **BDD harness** — `dotnet test` exits 0 with two smoke tests passing
4. **Health endpoint** — `dotnet run` then `curl localhost:5000/health` returns `{"status":"ok"}`
5. **CDK synth** — exits 0 with a valid CloudFormation template (publish Lambda first)
6. **CDK deploy** — `GET <api-gateway-url>/health` returns `200 OK`
7. **Acceptance spec** — `API_BASE_URL=<url> dotnet test` exits 0
8. **Pre-commit hook** — `git config core.hooksPath .githooks`, make a test commit, confirm hook runs
9. **PR workflow** — open a trivial PR, confirm all checks pass in GitHub Actions
10. **Deploy workflow** — merge to main, confirm deploy and acceptance spec pass in GitHub Actions

---

## Common failure points (from Phase 0 experience)

- **`dotnet new` picks the wrong target framework.** Always check `.csproj` after scaffolding. Fix to `net8.0` before committing.
- **CDK output key mismatch.** The `jq` key in `deploy.yml` must exactly match the `CfnOutput` logical ID in the CDK stack. Mismatch produces a silent `null` — the acceptance spec skips instead of failing.
- **`gh` CLI not authenticated.** Run `gh auth status` at the start of any Pip session that will open or merge PRs. On Windows + WSL, `gh` may need to be the Windows binary invoked with `GH_CONFIG_DIR` pointing at the Windows config path.
- **`cdk bootstrap` not run.** First deploy to a new account/region fails with an asset bucket error. Run `cdk bootstrap` once — it creates the S3 bucket CDK uses for Lambda assets.
- **GitHub Actions environment not configured.** Workflows reference an environment named `Test`. If it doesn't exist in the repo settings, the job queues indefinitely waiting for approval. Create the environment and add the three AWS secrets before first run.
- **Pre-commit hook not executable.** `chmod +x .githooks/pre-commit` must be run after copying the file. Git will silently skip a non-executable hook.
