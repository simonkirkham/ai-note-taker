# AI Note Taker

A meeting-focused note taking app, built as a learning vehicle for event-sourced architecture, .NET on AWS serverless, and agentic development workflows.

**Primary goal: learning, not a polished product.** Choices throughout the project favour learning surface area over shipping velocity.

## Stack

- **Backend:** .NET 10 on AWS Lambda
- **Event store:** DynamoDB (with a lightweight helper library)
- **Frontend:** React + TypeScript
- **Infrastructure:** AWS CDK in C#
- **Testing:** plain C# BDD-style Given/When/Then specs driven by event modelling

## Status

Actively developed. Walking skeleton deployed and built out across many phases — React frontend on CloudFront, event-sourced .NET API on Lambda, DynamoDB event store, Google Calendar linkage, transcription, and AI analysis. Phases 0–9, 16, and 17 are complete; Phases 10 (transcription & analysis), 18 (crash-safe transcription), and 19 (frontend hardening) are in progress. See the [roadmap](docs/roadmap.md) for the current state.

## Docs

- [Learning goals](docs/goals.md)
- [Architecture](docs/architecture.md)
- [Roadmap](docs/roadmap.md)
- [Event model](docs/event-model.md)
- [Architecture Decision Records](docs/adr/)
- [Agentic workflow reflection log](docs/workflow-log.md)

## Agents

Coding agents work against this repo using instructions in `CLAUDE.md` and skills in `.claude/skills/`. See `CLAUDE.md` for conventions, guardrails, and the skills catalogue.

## Running locally

Full local stack: DynamoDB Local in Docker + .NET API on Kestrel + Vite dev server. No AWS account needed.

**Prerequisites:** [Docker Desktop](https://www.docker.com/products/docker-desktop/), [.NET 10 SDK](https://dotnet.microsoft.com/download/dotnet/10), [Node.js 20+](https://nodejs.org/)

### Quick start

```bash
bash dev.sh
```

Starts all three services, waits for DynamoDB tables to be ready, and prints the URLs. Press Ctrl+C to stop everything cleanly.

| Service  | URL                      |
| -------- | ------------------------ |
| Frontend | http://localhost:5173    |
| API      | http://localhost:5000    |
| DynamoDB | http://localhost:8000    |

### Manual steps

<details>
<summary>Run each service individually</summary>

**1. DynamoDB Local**

```bash
docker compose up -d
```

Starts DynamoDB Local on port 8000. A one-shot init container creates the three tables on first run (`notetaker-events`, `notetaker-proj-notetitlelist`, `notetaker-proj-notedetail`). Data persists in a Docker volume between restarts.

**2. .NET API**

```bash
dotnet run --project src/Api/Api.csproj
```

`launchSettings.json` sets all required env vars and points the DynamoDB client at `http://localhost:8000`. Runs on `http://localhost:5000`.

**3. Frontend**

```bash
cp web/.env.local.example web/.env.local   # first time only
npm --prefix web install                   # first time only
npm --prefix web run dev
```

Open `http://localhost:5173`.

</details>

---

## Prerequisites (AWS deployment)

- [.NET 10 SDK](https://dotnet.microsoft.com/download/dotnet/10)
- [AWS CLI](https://aws.amazon.com/cli/) — configured with credentials (`aws configure`)
- [AWS CDK CLI](https://docs.aws.amazon.com/cdk/latest/guide/getting_started.html) — `npm install -g aws-cdk`
- [GitHub CLI](https://cli.github.com/) — `gh`

## Setup

```bash
git clone https://github.com/simonkirkham/ai-note-taker.git
cd ai-note-taker

# Activate the pre-commit hook
git config core.hooksPath .githooks
```

First-time AWS setup (once per account/region):

```bash
cdk bootstrap
```

## Commands

### Build and test

```bash
# Build entire solution (0 warnings enforced in CI)
dotnet build ai-note-taker.sln

# Run the domain BDD specs (one project per test layer — see CLAUDE.md "How to run" for all of them)
dotnet test tests/Domain.Specs/Domain.Specs.csproj

# Run the in-process API tests (no AWS credentials needed)
dotnet test tests/Api.Integration/Api.Integration.csproj

# Run the API locally (Kestrel — no Lambda runtime needed)
dotnet run --project src/Api/Api.csproj

# Run the analysis evaluation harness (opt-in; hits Bedrock, needs AWS creds, e.g. AWS_PROFILE=prod)
make eval

# Run only the offline eval harness tests (scorers, loader, corpus guards — no Bedrock)
make eval-offline
```

The analysis eval harness scores prompt/model variants of the AI note analysis — see [docs/guides/analysis-eval-harness.md](docs/guides/analysis-eval-harness.md).

### Infrastructure

```bash
# Validate the CDK stack. It packages three Lambdas and every asset path is checked
# at synth time, so publish all three or synth aborts with "Cannot find asset at ...".
for p in Api Projector TranscribeCompletion; do
  dotnet publish src/$p/$p.csproj -c Release -o src/$p/bin/Release/net10.0/publish
done
cdk synth

# Preview changes before deploying
cdk diff

# Deploy to AWS — re-publish first; cdk packages whatever is on disk
for p in Api Projector TranscribeCompletion; do
  dotnet publish src/$p/$p.csproj -c Release -o src/$p/bin/Release/net10.0/publish
done
cdk deploy
```

### Environment variables

**Backend** — set automatically by `launchSettings.json` when running locally via `dotnet run` or `dev.sh`:

| Variable                          | Local value                       | Description                                                       |
| --------------------------------- | --------------------------------- | ----------------------------------------------------------------- |
| `ASPNETCORE_ENVIRONMENT`          | `Development`                     | Activates `appsettings.Development.json` (DynamoDB at localhost)  |
| `EVENTS_TABLE_NAME`               | `notetaker-events`                | DynamoDB event store table                                        |
| `PROJ_NOTETITLELIST_TABLE_NAME`   | `notetaker-proj-notetitlelist`    | Note title list projection table                                  |
| `PROJ_NOTEDETAIL_TABLE_NAME`      | `notetaker-proj-notedetail`       | Note detail projection table                                      |
| `PROJ_CALENDARLINKINDEX_TABLE_NAME` | `notetaker-proj-calendarlinkindex` | CalendarLinkIndex projection table (calendarEventId → noteId)   |
| `PROJ_NOTESEARCHVIEW_TABLE_NAME`  | `notetaker-proj-notesearchview`   | NoteSearchView projection table (search; UserId-index GSI)        |
| `AWS_ACCESS_KEY_ID`               | `local`                           | Dummy credential accepted by DynamoDB Local                       |
| `AWS_SECRET_ACCESS_KEY`           | `local`                           | Dummy credential accepted by DynamoDB Local                       |
| `AWS_DEFAULT_REGION`              | `us-east-1`                       | Region sent to DynamoDB Local                                     |
| `DYNAMO_TIMEOUT_SECONDS`          | _(not set — uses default of 5)_   | Override DynamoDB HTTP timeout in seconds                         |

**Deployment secrets** — set as GitHub Actions secrets (optional; Lambda env vars default to `""` when unset):

| Secret                | Description                                                              |
| --------------------- | ------------------------------------------------------------------------ |
| `GOOGLE_CLIENT_ID`              | Google OAuth2 client ID; injected into Lambda and Vite build              |
| `GOOGLE_CLIENT_SECRET`          | Google OAuth2 client secret; used by `POST /auth/token` to exchange codes |
| `ALLOWED_USER_SUBS`             | Comma-separated Google `sub` values allowed to sign in (empty = no auth)  |
| `BEDROCK_MODEL_ID`              | Amazon Bedrock model ID for transcript analysis (e.g. `us.anthropic.claude-haiku-4-5-20251001-v1:0`); required from 10-D onward |

**Frontend** — set in `web/.env.local` (copy from `web/.env.local.example` on first run):

| Variable                | Local value               | Description                                        |
| ----------------------- | ------------------------- | -------------------------------------------------- |
| `VITE_API_URL`          | `http://localhost:5000`   | Base URL the frontend calls for API requests       |
| `VITE_GOOGLE_CLIENT_ID` | _(empty)_                 | Google OAuth2 client ID for PKCE sign-in flow      |

**Tests** — set in CI or manually before running post-deploy test suites:

| Variable        | Used by             | Description                                                          |
| --------------- | ------------------- | ------------------------------------------------------------------- |
| `API_BASE_URL`  | Smoke tests         | Deployed API Gateway URL — required to run `tests/Api.Smoke/`        |
| `FRONTEND_URL`  | Smoke + E2E tests   | Deployed CloudFront URL — required to run `tests/Browser.E2E/` (and the frontend smoke check in `tests/Api.Smoke/`) |
