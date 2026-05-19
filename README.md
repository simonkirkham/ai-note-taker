# AI Note Taker

A meeting-focused note taking app, built as a learning vehicle for event-sourced architecture, .NET on AWS serverless, and agentic development workflows.

**Primary goal: learning, not a polished product.** Choices throughout the project favour learning surface area over shipping velocity.

## Stack

- **Backend:** .NET 8 on AWS Lambda
- **Event store:** DynamoDB (with a lightweight helper library)
- **Frontend:** React + TypeScript
- **Infrastructure:** AWS CDK in C#
- **Testing:** plain C# BDD-style Given/When/Then specs driven by event modelling

## Status

Phase 1 complete — walking skeleton deployed. React frontend on CloudFront, event-sourced .NET API on Lambda, DynamoDB event store.

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

**Prerequisites:** [Docker Desktop](https://www.docker.com/products/docker-desktop/), [.NET 8 SDK](https://dotnet.microsoft.com/download/dotnet/8), [Node.js 20+](https://nodejs.org/)

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

- [.NET 8 SDK](https://dotnet.microsoft.com/download/dotnet/8)
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

# Run all BDD specs
dotnet test tests/Specs/Specs.csproj

# Run the API locally (Kestrel — no Lambda runtime needed)
dotnet run --project src/Api/Api.csproj
```

### Infrastructure

```bash
# Validate the CDK stack (publish Lambda first — asset path is checked at synth time)
dotnet publish src/Api/Api.csproj -c Release -o src/Api/bin/Release/net8.0/publish
cdk synth

# Preview changes before deploying
cdk diff

# Deploy to AWS
dotnet publish src/Api/Api.csproj -c Release -o src/Api/bin/Release/net8.0/publish
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
| `AWS_ACCESS_KEY_ID`               | `local`                           | Dummy credential accepted by DynamoDB Local                       |
| `AWS_SECRET_ACCESS_KEY`           | `local`                           | Dummy credential accepted by DynamoDB Local                       |
| `AWS_DEFAULT_REGION`              | `us-east-1`                       | Region sent to DynamoDB Local                                     |
| `DYNAMO_TIMEOUT_SECONDS`          | _(not set — uses default of 5)_   | Override DynamoDB HTTP timeout in seconds                         |

**Deployment secrets** — set as GitHub Actions secrets (optional; Lambda env vars default to `""` when unset):

| Secret                | Description                                                              |
| --------------------- | ------------------------------------------------------------------------ |
| `GOOGLE_CLIENT_ID`     | Google OAuth2 client ID; injected into Lambda and Vite build              |
| `GOOGLE_CLIENT_SECRET` | Google OAuth2 client secret; used by `POST /auth/token` to exchange codes |
| `ALLOWED_USER_SUBS`    | Comma-separated Google `sub` values allowed to sign in (empty = no auth)  |

**Frontend** — set in `web/.env.local` (copy from `web/.env.local.example` on first run):

| Variable                | Local value               | Description                                        |
| ----------------------- | ------------------------- | -------------------------------------------------- |
| `VITE_API_URL`          | `http://localhost:5000`   | Base URL the frontend calls for API requests       |
| `VITE_GOOGLE_CLIENT_ID` | _(empty)_                 | Google OAuth2 client ID for PKCE sign-in flow      |

**Tests** — set in CI or manually before running post-deploy test suites:

| Variable        | Used by          | Description                                                      |
| --------------- | ---------------- | ---------------------------------------------------------------- |
| `API_BASE_URL`  | Acceptance tests | Deployed API Gateway URL — required to run `tests/Acceptance/`   |
| `FRONTEND_URL`  | E2E tests        | Deployed CloudFront URL — required to run `tests/E2E/`           |
