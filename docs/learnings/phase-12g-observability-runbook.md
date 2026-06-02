# Learnings — Slice 12-G: Observability runbook + saved Logs Insights queries

## A saved query that matches nothing is the same failure class as a broken deploy

12-G is "just docs + four `CfnQueryDefinition`s", but its whole value is that the queries *return data*. The first cut filtered/projected on `correlationId`, `CommandType`, `StreamId` — none of which exist on the actual log lines. That passed `dotnet build`, all 65 infra assertions, and `cdk synth` (the template is well-formed; the field names are just strings). It would have shipped four official, picker-promoted queries that quietly return blank columns or nothing — the same "looks done, isn't" class as the RUM CDN host ([[phase-12f-frontend-rum]]) and SEARCH-on-alarm ([[phase-12e-alarms-sns]]) bugs. **For a query/runbook deliverable, the gate is "run it against real logs", not "it compiles".**

## Verify against the log group the function actually writes to

12-A assigned the Lambda an **explicit** CDK `LogGroup`, so the function writes to `NoteTakerStack-ApiFunctionLogGroup<hash>`, **not** the default `/aws/lambda/NoteTakerStack-ApiFunction<hash>` group (which still exists and holds *stale pre-12-A plain-text* logs). A reviewer checking the default group concluded "logs are plain text, nothing works" — a false alarm. Always resolve the real target first:

```bash
aws lambda get-function-configuration --function-name <fn> --query LoggingConfig
# → { "LogFormat": "Text", "LogGroup": "NoteTakerStack-ApiFunctionLogGroup..." }
```

The explicit group contains proper Powertools JSON. (Note `LogFormat: Text` is the Lambda *advanced-logging* setting and is independent of Powertools, which serializes the message itself to JSON regardless.)

## The real correlation key is `xray_trace_id`, not `correlationId` (→ BUG-8)

12-A returns an `x-correlation-id` header (and repeats it in 500 bodies) from `ctx.TraceIdentifier`, but **never appends it to the Powertools logger** — so that value appears on zero log lines. The only per-request correlation key in the logs is `xray_trace_id` (set by X-Ray, 12-C), corresponding to the `x-amzn-trace-id` header. So the "trace a user-reported correlation ID to its log line" workflow 12-A promised doesn't actually work; the runbook and saved query use `xray_trace_id` instead, and the gap is filed as **BUG-8**.

## Powertools .NET emits snake_case keys

Message-template properties serialize as snake_case: `{CommandType}` → `command_type`, `{StreamId}` → `stream_id`, `{EventCount}` → `count`, plus built-ins `xray_trace_id`, `cold_start`, `service`. Logs Insights field names are case-sensitive, so `fields CommandType` renders blank. **Caveat that bit us twice in one phase:** EMF **metric dimensions** are PascalCase (`CommandType`, `Aggregate` in `NoteTaker/Domain`), while **log fields** for the same concepts are snake_case. A term-search (`filter-pattern '"CommandType"'`) matches the metric EMF blocks and misleads you into thinking the log field exists; use a JSON-path probe (`{ $.command_type = "*" }` vs `{ $.CommandType = "*" }`) to tell them apart.

## "Slowest commands" → "Slowest requests"

There's no per-command duration in the logs. The honest Logs Insights signal is the Lambda REPORT line's `@duration` (per *invocation*), so the saved query is "Slowest requests"; per-command/subsegment latency lives in X-Ray (the `ReadEvents`/`AppendEvents` subsegments from 12-C). The runbook says so rather than implying the query does something it can't.

## Deriving a saved query's log-group scope

`CfnQueryDefinition.LogGroupNames` takes the CDK token `apiLogGroup.LogGroupName` — no hard-coded generated name — so the saved queries always target the managed group even though its physical name is CDK-generated. A `void SavedQuery(id, name, query) => new CfnQueryDefinition(...)` local helper kept the four definitions DRY (it constructs for the registration side-effect on `this`; the discarded return is intentional).
