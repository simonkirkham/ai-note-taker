# Learnings — Slice 12-H: Unified error view (frontend RUM errors on the ops dashboard)

## A derived resource name beats a hard-coded one — RUM's log group from the monitor GUID

RUM (with `CwLogEnabled = true`) auto-creates a log group named `/aws/vendedlogs/RUMService_<appMonitorName><first-8-of-monitor-GUID>`. To query it from a dashboard `LogQueryWidget` you need that exact name, but the GUID suffix is environment-specific and not known at author time. The suffix is the **first hyphen-segment** of the monitor GUID (`5a2b155e-05cd-…` → `5a2b155e`), which CDK can derive without hard-coding:

```csharp
var rumLogGroupName = $"/aws/vendedlogs/RUMService_{rumMonitorName}{Fn.Select(0, Fn.Split("-", rumAppMonitor.AttrId))}";
```

CDK renders the multi-log-group widget as a Logs Insights `SOURCE '<api>' | SOURCE '<rum>'` query with the token interpolated into the SOURCE clause — confirmed in the synthesized template and verified live (the deploy succeeded and the unified table resolves both groups).

**Rule:** when a managed service names a resource after another resource's attribute, derive the name with `Fn.*` intrinsics from that attribute rather than copying an environment-specific literal into source.

## Ordering constraint: the RUM monitor is declared after the dashboard

The 12-D dashboard block is built near the top of the constructor; `rumAppMonitor` is created much later (the RUM block from 12-F). So the dashboard's *original* `AddWidgets` call can't reference RUM. Rather than reorder the whole RUM block above the dashboard (a large, conflict-prone diff — and this slice was running in parallel with 12-E on the same file), 12-H adds a **second** `dashboard.AddWidgets(...)` call after the RUM monitor. Net effect: the dashboard now has the original backend-only "All errors" table *and* a combined "All errors (backend + frontend)" table. Two near-titled panels is a mild cost; the alternative reorder wasn't worth the churn/conflict risk. If the stack is ever reordered so `rumAppMonitor` precedes the dashboard, collapse to the single combined table.

## A combined query must match both log shapes

Backend (Powertools) log lines carry `level` / `correlationId` / `message`; RUM events are JSON with `event_type = com.amazon.rum.js_error_event` and the message under `event_details`. One Logs Insights query spans both groups, so its filter ORs the two shapes (`level in ["Error","Warning"] or @message like /com.amazon.rum.js_error_event/`) and projects a unified field set. Each source leaves the other's columns blank — acceptable for an ops table; a future polish would `coalesce(message, event_details.message)`.

## RUM default metrics may need a metrics destination — verify, don't assume

The `AWS/RUM` `JsErrorCount`/`HttpErrorCount` metric widget relies on RUM publishing default metrics to CloudWatch automatically. We did **not** add a `CfnMetricsDestination`. This is the one part of the slice that can silently no-op: if those metrics don't appear once real traffic flows, the widget stays empty and the fix is a one-line `CfnMetricsDestination` (`Destination = "CloudWatch"`). Tracked as the open post-deploy TODO on 12-H — the Logs Insights table (which reads the RUM log group directly) works regardless, so error *detail* is covered even if the *count* metric needs the destination.

## Parallel slices on a shared file: dev parallelism, sequential merges, conflict tax

12-E and 12-H were built concurrently in separate worktrees. Both append to `NoteTakerStack.cs` and `InfraAssertionsTests.cs`, so every merge after the first conflicted. Worse, 12-E shipped a deploy-breaker (see [[phase-12e-alarms-sns]]), so 12-H had to be re-rebased onto the *corrected* main, re-resolving the same conflict twice. The reliable resolution for "both sides only appended methods" was `git show :2:<file>` (take the merged-base/ours version cleanly) then re-insert the other side's additions, rather than hand-editing interleaved conflict markers. **Takeaway:** parallel worktrees pay off when slices touch *disjoint* files; when they share a file, the conflict tax + serialized deploys often erase the wall-clock saving — prefer sequential.
