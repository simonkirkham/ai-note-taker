# Observability runbook — "how do I see X?"

The app is instrumented across the three pillars (logs, metrics, traces) plus frontend RUM, all AWS-native. This page is the index: **where do I look to answer a given question.** Built by Phase 12 (slices 12-A → 12-H).

Region is **eu-west-2**; everything below is in the account the stack is deployed to. The stack is `NoteTakerStack`.

## Where each signal lives

| Question | Go to | Built in |
|----------|-------|----------|
| Is it healthy? | The `notetaker-ops` dashboard | 12-D |
| What errors happened (backend + frontend)? | Dashboard "All errors" widgets + saved Logs Insights queries | 12-D, 12-H |
| What did one request/user do? | Correlation ID → Logs Insights; trace ID → X-Ray | 12-A, 12-C |
| Why is it slow? | X-Ray service map & traces; Lambda p50/p99 widget | 12-C, 12-D |
| Are commands failing / conflicting? | Domain metrics on the dashboard + saved query | 12-B, 12-D |
| Did the browser crash? | CloudWatch RUM console (`notetaker-rum`) | 12-F |
| Did something breach a threshold? | SNS email (`notetaker-alarms`) | 12-E |

## Stack outputs (how to find the URLs)

The console URLs and IDs are environment-specific — fetch them from the stack outputs rather than hard-coding:

```bash
aws cloudformation describe-stacks --stack-name NoteTakerStack --region eu-west-2 \
  --query "Stacks[0].Outputs[].[OutputKey,OutputValue]" --output text
```

| Output | What it is |
|--------|-----------|
| `DashboardUrl` | Direct link to the `notetaker-ops` CloudWatch dashboard |
| `RumMonitorId` | CloudWatch RUM AppMonitor ID (also the suffix of the RUM log group) |
| `RumIdentityPoolId` | Cognito identity pool the browser RUM client authenticates with |
| `ApiUrl` / `WebUrl` | API and frontend URLs |

---

## Is it healthy? — the ops dashboard

Open the **`notetaker-ops`** dashboard (`DashboardUrl` output, or CloudWatch → Dashboards → `notetaker-ops`). It shows, with one shared time-range picker:

- Lambda errors & invocations, and p50/p99 duration
- Event-store DynamoDB write capacity & system errors
- Domain metrics: `CommandHandled` vs `ConcurrencyConflict` (`NoteTaker/Domain`)
- **All errors** (backend) and **All errors (backend + frontend)** Logs Insights tables
- **Frontend errors (RUM)** — `AWS/RUM` `JsErrorCount` / `HttpErrorCount`

The time-range picker (top-right) is the "how far back" control — there is no fixed window baked into any widget.

## What errors happened?

**Fastest:** the dashboard's "All errors (backend + frontend)" widget — backend Powertools error/warning lines *and* RUM `js_error_event` entries in one table.

**Ad-hoc / longer windows:** Logs Insights → the saved query **`NoteTaker/All errors`** (see [Saved queries](#saved-logs-insights-queries)). It filters `level in ["Error","Warning"]` (Powertools casing) with an `@message` regex fallback, newest first.

Domain rule violations (e.g. renaming a missing note) are logged at **Warning**, not Error, on purpose — they're expected business outcomes, so they don't clutter the error view. Infrastructure failures are Error.

## What did one request (or user-reported error) do?

There are two greppable identifiers, and **either** ties a request's log lines together:

- **`x-correlation-id`** header (12-A), which a 500 body also repeats for users to quote. This value (the ASP.NET `TraceIdentifier`) is logged on every line of the request as the **`correlation_id`** field (BUG-8), so a user-reported ID resolves straight to its log trail.
- **`x-amzn-trace-id`** header (the X-Ray trace, 12-C). Its `Root=1-…` value is logged on every line as **`xray_trace_id`** and is also the key into X-Ray itself.

To trace a request:

1. **From a user / 500 body:** take the `x-correlation-id` value and run, over the API log group:
   `filter correlation_id = "<value>" | sort @timestamp asc`
2. **From the `x-amzn-trace-id` header:** run the saved query **`NoteTaker/By trace ID`** and replace `REPLACE_WITH_XRAY_TRACE_ID` with the `Root=1-…` value.
3. Either gives that request's full log trail (command received → events appended → any warning/error), sorted oldest-first.
4. Paste the trace id into **X-Ray** (below) to see it as a timed trace with the `ReadEvents`/`AppendEvents` subsegments.

## Why is it slow?

- **X-Ray** (CloudWatch → X-Ray traces, or the service map): each request is a trace with named **`ReadEvents`** and **`AppendEvents`** subsegments around the event store, and the DynamoDB calls nested beneath them. The service map shows where latency and faults concentrate. This is the right tool for *per-command* timing.
- **Dashboard** "Lambda duration p50/p99" widget for the aggregate trend.
- **Saved query `NoteTaker/Slowest requests`** sorts Lambda invocations by `@duration` (from the REPORT line). Note this is per-*invocation*; for per-command/subsegment breakdown use X-Ray.

## Are commands failing or conflicting?

- **Metrics** (`NoteTaker/Domain` namespace, EMF): `CommandHandled`, `CommandFailed` (with `ExceptionType`), `EventsAppended`, `ConcurrencyConflict`. The dashboard plots `CommandHandled` vs `ConcurrencyConflict`. (Domain metrics carry a `Service` dimension from Powertools plus `CommandType`/`Aggregate`, so query them with `SUM(SEARCH(...))`, not a fixed-dimension metric.)
- **Saved query `NoteTaker/Concurrency conflicts`** lists each optimistic-concurrency warning (`Concurrency conflict {StreamId} ExpectedVersion=… ActualVersion=…`) over time.

## Did the browser crash?

**CloudWatch RUM → App monitors → `notetaker-rum`** (or use the `RumMonitorId` output). Tabs: **Errors** (JS errors with stack traces), **Performance** (Core Web Vitals), **Sessions**, **Browsers & Devices**. RUM also writes events to the log group `/aws/vendedlogs/RUMService_notetaker-rum<first-8-of-RumMonitorId>`, which the dashboard's combined error widget already queries. With X-Ray enabled on the monitor, a frontend error links to its backend trace via the propagated trace id (12-C).

> The RUM web client loads from the **global** CDN `client.rum.us-east-1.amazonaws.com` (not regional); only the data plane is regional. If RUM shows "no data", first confirm the snippet is in the deployed `index.html` and `PutRumEvents` → `dataplane.rum.eu-west-2.amazonaws.com` returns 200. (See `docs/learnings/phase-12f-frontend-rum.md` / BUG-6.)

## Did something breach a threshold?

The **`notetaker-alarms`** SNS topic emails the configured address when an alarm fires. Two alarms are live:

- **`notetaker-error-rate`** — Lambda error rate > 1% over 5 min (2 periods).
- **`notetaker-p99-latency`** — Lambda p99 duration > 5 s over 5 min (2 periods).

A concurrency-conflict alarm is **deferred** — CloudWatch rejects `SEARCH` on metric alarms, and `ConcurrencyConflict` is only queryable via SEARCH today (it's emitted with per-`Aggregate` dimensions). Watch it on the dashboard / saved query meanwhile. (See `docs/learnings/phase-12e-alarms-sns.md`.)

**To test the wiring** (the email subscription must be confirmed first — accept the AWS confirmation email):

```bash
aws cloudwatch set-alarm-state --alarm-name notetaker-error-rate \
  --state-value ALARM --state-reason "manual test" --region eu-west-2
```

## Saved Logs Insights queries

These persist as named queries in the Logs Insights picker under the **`NoteTaker/`** folder (CDK `CfnQueryDefinition`, scoped to the API Lambda log group):

| Name | Answers |
|------|---------|
| `NoteTaker/All errors` | All error/warning lines, newest first |
| `NoteTaker/By trace ID` | One request's full trail by `xray_trace_id` (replace the placeholder) |
| `NoteTaker/Slowest requests` | Lambda invocations by `@duration` |
| `NoteTaker/Concurrency conflicts` | Optimistic-concurrency conflict timeline |

## Log field reference (Powertools JSON)

Powertools emits **snake_case** keys — use these exact names in Logs Insights `fields`/`filter`:

| Field | Set by |
|-------|--------|
| `level`, `message`, `timestamp`, `service`, `xray_trace_id`, `correlation_id`, `name` | every line (12-A; `xray_trace_id` from 12-C; `correlation_id` = the `x-correlation-id` header, BUG-8) |
| `command_type`, `aggregate` | "Command received …" (12-B) |
| `stream_id`, `version`, `count` | "Events appended …" (12-B) |
| `exception_type` | "Command failed …" (Warning, 12-B) |

The bearer token / `Authorization` header is never logged (12-A).
