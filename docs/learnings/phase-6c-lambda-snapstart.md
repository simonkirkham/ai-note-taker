# Phase 6-C Learnings — Lambda SnapStart

## What we built

Enabled Lambda SnapStart for the .NET 10 API function. SnapStart snapshots the initialised execution environment after each deploy and restores from that snapshot instead of re-initialising on cold starts. Baseline cold start was ~490 ms Init Duration (measured from CloudWatch logs).

CDK changes:
- Added `SnapStart = SnapStartConf.ON_PUBLISHED_VERSIONS` to the Lambda function
- Published a versioned snapshot via `apiFunction.CurrentVersion`
- Created a `"live"` alias pointing to `CurrentVersion`
- Routed both `/{proxy+} ANY` and `/{proxy+} OPTIONS` API Gateway integrations through the alias (SnapStart only applies when API Gateway targets an alias, not `$LATEST`)
- Removed the `sleep 15` warm-up step from deploy.yml

## CDK gotcha: `Version` class vs `CurrentVersion` property

The phase doc specced `new Amazon.CDK.AWS.Lambda.Version(...)`. That class does not exist in the C# CDK 2.x bindings — a compile error reveals this. The correct approach is `apiFunction.CurrentVersion`, which CDK synthesises as a `AWS::Lambda::Version` resource. Using `CurrentVersion` avoids having to manage a physical version ID.

## Concurrent event-stream appends fail silently on the client

When the frontend adds multiple tags at once (space-separated input → `handleAddTags`), it fired parallel `POST /tags` calls. Each call reads the event stream, appends at the current version, and updates the projection. The second call read a stale version — the event store rejected it with 409 — but the client ignored 409 silently and showed both tags optimistically. After navigation the re-fetch revealed the truth: only one tag was persisted.

**Fix:** serialise the loop with `await` so each POST completes before the next starts. No concurrent stream modifications, no version conflict.

**Lesson:** optimistic UI state and server state can diverge when concurrent writes hit an OCC-protected stream. Tests that only check the optimistic state (no navigation) are false positives for this class of bug.

## `react-hooks/rules-of-hooks` is tripped by early returns

Placing an early return (`if (...) return <PrototypeRoot />`) before any hook calls in a component violates the Rules of Hooks. ESLint catches this correctly. Move the early return to after all hook declarations, or extract the conditional rendering into a sub-component.

## Prototype files must be committed or the import must be removed

An import of `./prototype/PrototypeRoot` from App.tsx succeeded locally (file present but untracked) and failed in CI (file absent from the repo). Always ensure prototype imports are either committed or absent from production components.

## Done

- [x] Baseline Init Duration recorded (~490 ms)
- [x] SnapStart enabled and deployed
- [x] Alias-backed API Gateway routing
- [x] `sleep 15` warm-up step removed
- [x] InfraAssertions test for SnapStart config
- [x] All acceptance and E2E tests green
