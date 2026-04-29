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

## Commands

### Build

```bash
# Build the API Lambda project
dotnet build src/Api/Api.csproj

# Publish the API for Lambda deployment (required before CDK deploy)
dotnet publish src/Api/Api.csproj -c Release -o src/Api/bin/Release/net8.0/publish

# Build the CDK infrastructure project
dotnet build src/Infrastructure/Infrastructure.csproj

# Run all BDD specs
dotnet test tests/Specs/Specs.csproj
```

### Infrastructure

```bash
# Synth the CDK stack (validates infrastructure before any deploy)
cdk synth --app "dotnet run --project src/Infrastructure/Infrastructure.csproj"

# Show what will change before deploying
cdk diff --app "dotnet run --project src/Infrastructure/Infrastructure.csproj"

# Deploy to AWS (always publish first)
dotnet publish src/Api/Api.csproj -c Release -o src/Api/bin/Release/net8.0/publish
cdk deploy --app "dotnet run --project src/Infrastructure/Infrastructure.csproj"
```

> Prerequisites: AWS credentials configured (`aws configure` or env vars), CDK bootstrapped in the target account/region (`cdk bootstrap`).
