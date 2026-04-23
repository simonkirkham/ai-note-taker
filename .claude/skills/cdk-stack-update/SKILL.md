---
name: cdk-stack-update
description: Make safe edits to the AWS CDK infrastructure in C#, with synth and diff gating before any deploy. Use when adding or modifying AWS resources (Lambda, DynamoDB, API Gateway, S3, IAM), wiring environment variables, or updating CDK constructs. Triggers include "add a new Lambda", "new DynamoDB table", "update CDK", "infra change", "permission needed for".
---

# CDK Stack Update

This skill applies safe-by-default changes to the CDK app in `src/Infrastructure/`.

## Pre-conditions

- Understand which stack the change belongs to (per-environment vs shared).
- Confirm the change is genuinely infra — many things people reach for CDK for (env config, feature flags) belong elsewhere.

## Steps

1. **Edit the C# CDK construct** in `src/Infrastructure/Stacks/`. Prefer L2 constructs over L1 (`CfnXxx`) unless you need a property L2 doesn't expose.

2. **Set explicit IDs and removal policies** on stateful resources (DynamoDB tables, S3 buckets, KMS keys). Default `RemovalPolicy.RETAIN` for any storage; `DESTROY` only when intentional.

3. **Tag every resource** with `Project=note-taker` and `Environment=<env>` via stack-level tagging.

4. **Run `cdk synth`.** The build must succeed. Synth output is a CloudFormation template.

5. **Run `cdk diff`.** Read the diff carefully. Check:
   - No unintended resource replacement (look for `[~]` becoming `[-]/[+]`)
   - IAM policy changes are minimal and least-privilege
   - No public exposure added (S3 ACLs, security groups)
   - No deletion of stateful resources unless explicitly intended

6. **Snapshot test.** If `tests/Infrastructure/` contains snapshot tests, update the snapshot only when the diff is the change you want.

7. **Commit the CDK change separately** from app code changes when feasible — makes reverts cleaner.

## IAM principle

Each Lambda gets only the permissions it needs:
- API Lambda → DynamoDB read/write on the event store table only
- Projection Lambda → DynamoDB read on the event store table, write on its own projection table

Never grant `dynamodb:*` or `*:*`.

## Don't

- Don't deploy without reading the `cdk diff` output.
- Don't change a stateful resource's logical ID (causes recreation = data loss).
- Don't put secrets in CDK source. Use AWS Secrets Manager or Parameter Store and pass ARNs.
- Don't relax `RemovalPolicy` from `RETAIN` to `DESTROY` on a stateful resource without flagging.
