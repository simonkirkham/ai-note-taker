# Learnings: 1-C — POST /notes endpoint

## What was inefficient or went wrong

- The cold-start Lambda 500 failure on deployment is now a repeatable pattern: every `cdk deploy` triggers a Lambda redeploy, which cold-starts and fails the immediate acceptance test. This adds a manual re-run to every merge cycle. It needs a structural fix (warm-up sleep in the deploy pipeline, or retry logic in the acceptance test).
- `Deserialize` static function was placed in `Program.cs` — Hawk correctly flagged that it will need to be extracted before 1-D. A shared deserialiser belongs in `src/EventStore/`, not in the API layer.

## Suggested process improvements

- **Pip** should add a sleep or retry between CDK deploy and the acceptance test run in `.github/workflows/deploy.yml` before any further slices land — the cold-start issue blocks the pipeline on every merge and is now costing re-runs consistently.
- **Pip** should extract `Deserialize` into `src/EventStore/` as part of the 1-D slice setup, before writing the projection handler that also needs it.
- **Breaker** for acceptance specs should note in the spec file which scenarios require a live Lambda to be in a known state (e.g., the 409 test creates a note on the live API — this is not idempotent and could leave test data in production).

## Hawk review findings

| Finding | File | How to prevent |
|---|---|---|
| Unused index `i` in `Select((e, i) => ...)` | `src/Api/Program.cs` | Pip should not use index-overload of LINQ `Select` unless the index is needed |
| `Deserialize` in API layer will leak into every endpoint | `src/Api/Program.cs` | Pip should place event deserialisation in `src/EventStore/` from the first use |
| `EVENTS_TABLE_NAME` validation was lazy (first request, not startup) | `src/Api/Program.cs` | Pip should validate all required env vars before `builder.Build()` |
