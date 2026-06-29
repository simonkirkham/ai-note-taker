# 24-C — Rebuild operability: per-projection summary, fault visibility, concurrency guard

**Slice:** 24-C · **PR** #206 · **Deployed** 2026-06-09.

## What shipped

`POST /admin/projections/rebuild` is now observable and single-flight. Response changed from `{"rebuilt":N}` to a per-projection count map plus `staleDeleted`. A duration metric, a fault metric, and two CloudWatch alarms (fault, duration→20s) wire the rebuild into the dashboard. A static semaphore rejects an overlapping rebuild with `409` instead of letting two runs interleave.

## Non-obvious whys

1. **Single-flight is `SemaphoreSlim(1,1).WaitAsync(0)`, not a queue.** `WaitAsync(0)` returns immediately false when the lock is held → throw `RebuildInProgressException` (mapped to 409). A rebuild is a rare manual maintenance op; the caller should be told "already running", not silently queued behind a 20s job. The semaphore is **static** so it gates across requests on a warm Lambda. **Cross-instance overlap on a horizontally-scaled Lambda is deliberately not guarded** — a distributed lock is the documented next step if rebuild ever moves off the manual path; not worth it now.

2. **Expected backpressure (409) must not trip the fault alarm.** `AdminHandlers.RebuildProjections` catches `RebuildInProgressException` separately and rethrows **without** calling `ProjectionRebuildFault()` — only the generic `catch` emits the fault metric. A rejected concurrent request is normal operation; counting it as a fault would page on a non-incident.

3. **`staleDeleted` is surfaced, not just logged.** The reconcile pass (24-B) deletes `existing − keep`. Returning that count in the response body makes an unexpectedly-large prune visible to the operator immediately — a non-zero `staleDeleted` on a rebuild that should have been a no-op is the signal that the keep-set or a live-delete path drifted.

4. **The duration alarm at 20s is an escalation trigger, not a latency SLO.** The rebuild rides the HTTP path with a 29s API Gateway ceiling. The 20s alarm is the agreed line at which the async Step Functions/SQS offload (deferred this phase) becomes justified — it fires on growth, not on a user-facing regression.

## Process note

Backend-only slice (no event-model, aggregate, or frontend change). The response-shape break (`{"rebuilt":N}` → map) required updating the post-deploy smoke caller in the same PR; that the smoke step passed in the deploy run confirms the caller was migrated. Tests live in `tests/Api.Integration/RebuildOperabilityTests.cs` (summary shape; second concurrent rebuild → 409) and `InfraAssertionsTests.cs` (the two alarms exist). CDK assertions catch a missing/renamed alarm at synth time, before deploy.

## Deploy-gate footnote (not a 24-C defect)

24-C's first deploy run (#496) went red on the post-deploy E2E `TagsJourney.RemoveTag_GoneAfterNavigation`, a multi-tag test in code 24-C never touched. The actual cdk deploy + frontend upload had already succeeded; only the post-deploy E2E gate failed. This is the recurring `TagsJourney` multi-tag race — **not fully eliminated by the BUG-14 fix (#205)**, which the scribe doc had marked "Resolved". Re-opened as a standing flake item; see `technical-improvements.md`.
