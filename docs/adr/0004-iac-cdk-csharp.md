# ADR 0004 — Infrastructure-as-code with AWS CDK in C#

**Status:** Accepted

## Context

Need IaC for the AWS resources (Lambda, DynamoDB, API Gateway, S3/CloudFront for the frontend). Three sensible options:

- **AWS CDK in C#** — same language as backend, type-safe, full IDE support.
- **AWS SAM** — YAML-based, simpler for Lambda-heavy apps.
- **Terraform** — multi-cloud, transferable skill, adds another language (HCL).

## Decision

Use **AWS CDK** with the **C# bindings**.

## Consequences

- Single language across backend and infra — fewer context switches.
- Type-safe infra; IDE autocomplete on AWS resources.
- Adds infra-as-code as a deliberate fourth learning surface inside the existing language.
- Snapshot tests on CDK output catch unintended infra changes.

## Alternatives considered

- **AWS SAM** — lower friction but YAML offers little learning depth and isn't as expressive for non-Lambda resources.
- **Terraform** — more transferable, but adds HCL as another language to learn on top of three already.
