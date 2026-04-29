# Learnings: 1-B — DynamoDbEventStore

## What was inefficient or went wrong

- `cdk synth` cannot be run locally on this machine (Node.js/CDK not in PATH in bash shell) — the CDK validation step only runs in CI. This creates a longer feedback loop for infrastructure changes.
- Two compile errors hit on the CDK stack (`Attribute` ambiguity, `Tags.Of` instance vs static) — caught immediately by the build step but added a round-trip.

## Suggested process improvements

- **Pip** should check whether `cdk synth` can run locally before starting CDK work. If it can't, note that explicitly in the PR description so Hawk knows the CDK-specific gate only runs in CI.
- **Pip** should qualify CDK DynamoDB `Attribute` as `Amazon.CDK.AWS.DynamoDB.Attribute` from the outset — the `System.Attribute` ambiguity is a recurring gotcha with `ImplicitUsings`.

## Hawk review findings

| Finding | File | How to prevent |
|---|---|---|
| No pagination on `ReadAsync` — silent truncation for streams > 1 MB | `src/EventStore/DynamoDbEventStore.cs` | Pip should implement `LastEvaluatedKey` loop as part of any `QueryAsync` call |
| Post-conflict version read is approximate (second round-trip after failure) | `src/EventStore/DynamoDbEventStore.cs` | Add a comment at write time; Pip should document approximation at the call site |
| `Placeholder.cs` left as dead code | `src/EventStore/Placeholder.cs` | Pip should delete scaffolding stubs when the real implementation lands |
