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

Phase 0 — setup.

## Docs

- [Learning goals](docs/goals.md)
- [Architecture](docs/architecture.md)
- [Roadmap](docs/roadmap.md)
- [Event model](docs/event-model.md)
- [Architecture Decision Records](docs/adr/)
- [Agentic workflow reflection log](docs/workflow-log.md)

## Agents

Coding agents work against this repo using instructions in `CLAUDE.md` and skills in `.claude/skills/`. See `CLAUDE.md` for conventions, guardrails, and the skills catalogue.

## Prerequisites

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

| Variable | Used by | Description |
|---|---|---|
| `API_BASE_URL` | acceptance spec | Live API Gateway URL — set to run the acceptance spec against the deployed Lambda |
