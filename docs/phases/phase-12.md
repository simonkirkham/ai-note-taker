# Phase 12 — Observability

**Goal:** Make the app properly observable for production — one place to answer "is it healthy?", "what broke?", and "why is it slow?". Today there is a single Lambda log group with unstructured text logs, no correlation IDs, no metrics, no traces, no dashboards, no alarms, and zero frontend visibility. This phase closes every one of those gaps using AWS-native tooling only.

## Summary

| Slice | Summary | Status | Depends on |
|-------|---------|--------|------------|
| 12-A | Structured logging, correlation IDs, and log retention | Done | — |
| 12-B | Domain metrics (EMF) and event-sourcing log fields | Done | 12-A |
| 12-C | Distributed tracing with AWS X-Ray | Done | 12-A |
| 12-D | CloudWatch Dashboard and the "all errors" view | Done | 12-A, 12-B |
| 12-E | CloudWatch Alarms and SNS notifications | Done (concurrency alarm deferred) | 12-B |
| 12-F | Frontend monitoring (CloudWatch RUM) | Done | — |
| 12-G | Observability runbook and saved Logs Insights queries | Done | 12-A–12-F |
| 12-H | Unified error view — surface frontend (RUM) errors on the ops dashboard | Done | 12-D, 12-F |

Recommended build order: **12-A → 12-B → 12-C → 12-D → 12-E**, with **12-F** runnable in parallel any time, then **12-H** (needs both the dashboard and RUM), and **12-G** last once all the surfaces it documents exist.

---

## Slice 12-A — Structured logging, correlation IDs, and log retention

**Status:** Done

### Scenarios

```
Scenario: Successful response carries a correlation ID
  Given the API is running
  When  I make any request
  Then  the response includes an x-correlation-id header

Scenario: Unhandled exception is logged with its correlation ID and returned to the caller
  Given an endpoint that throws an unhandled exception
  When  I call it
  Then  the response status is 500
  And   the response body contains the same correlation ID as the x-correlation-id header
  And   a structured error log line is emitted carrying that correlation ID, method, and path

Scenario: Log group has a finite retention
  Given the deployed stack
  Then  the API function's log group has a one-month retention policy
  And   the log group is managed by CDK (not auto-created)
```

### Acceptance criteria

- [x] `AWS.Lambda.Powertools.Logging` referenced in `Api.csproj`; solution builds on .NET 10
- [x] Default logging providers cleared; Powertools logger registered with `Service = "note-taker"`
- [x] Logs are emitted as JSON (structured) in the Lambda environment
- [x] Every HTTP response carries an `x-correlation-id` header
- [x] Unhandled exceptions return 500 with the correlation ID in the body and a structured `Error` log line carrying correlation ID, method, and path
- [x] `Authorization` header / bearer token never appears in any log line (code-level guard: `LogEvent` left off; no log path touches the header)
- [x] An explicit `LogGroup` with one-month retention is defined in CDK and attached to the function
- [x] `tests/Infrastructure.Assertions` asserts the log group + retention; `tests/Api.Integration` asserts the correlation-ID header and error body
- [x] `cdk synth` succeeds; `cdk diff` reviewed before deploy

---

## Slice 12-B — Domain metrics (EMF) and event-sourcing log fields

**Status:** Done — except `ProjectionUpdateDuration`/`ProjectionRebuildDuration`, deferred (see acceptance criteria)

### Scenarios

```
Scenario: A successful command emits CommandHandled and EventsAppended
  Given a valid CreateNote command
  When  the handler processes it
  Then  a CommandHandled metric is emitted with CommandType and Aggregate dimensions
  And   an EventsAppended metric is emitted for the Note aggregate
  And   a structured log line records the stream ID and new version

Scenario: A domain rule violation is a Warning, not an Error, and emits CommandFailed
  Given a command that violates a domain rule
  When  the handler processes it
  Then  a CommandFailed metric is emitted with the ExceptionType dimension
  And   the log line is at Warning level
  And   it does not appear in the error view

Scenario: An optimistic-concurrency conflict emits ConcurrencyConflict
  Given two commands target the same stream at the same expected version
  When  the second append fails the conditional check
  Then  a ConcurrencyConflict metric is emitted for the aggregate
  And   a Warning log line records the stream ID and expected version

Scenario: A projection update emits its duration
  Given a domain event is dispatched to a projection handler
  When  the handler finishes
  Then  a ProjectionUpdateDuration metric (ms) is emitted tagged with the ProjectionName
```

### Acceptance criteria

- [x] `AWS.Lambda.Powertools.Metrics` referenced; metrics registered via `IDomainMetrics` (`PowertoolsDomainMetrics`) in `Builder.cs`
- [x] Append path logs `Events appended {StreamId} Version={Version} EventCount={Count}`; command handlers log receipt (`CommandType`, `Aggregate`)
- [x] `CommandHandled` + `EventsAppended` emitted on success; `CommandFailed` (with `ExceptionType`) on domain exception; `ConcurrencyConflict` on OCC failure
- [x] Domain exceptions are logged at `Warning`, never `Error`
- [ ] Projection handlers emit `ProjectionUpdateDuration`; the rebuild path emits `ProjectionRebuildDuration` and logs start/count/duration — **deferred:** projections are updated inline in four structurally different ways (the registered `IDomainEventDispatcher` is dead code), so a uniform timing seam warrants its own focused change. Candidate follow-up slice.
- [x] Metric dimensions are low-cardinality; no IDs or free text used as dimensions
- [x] No PII / event payload bodies logged at `Information`
- [x] Tests assert metric emission on success, domain-failure, and concurrency-conflict paths
- [x] All existing BDD specs remain green; `cdk synth` succeeds

---

## Slice 12-C — Distributed tracing with AWS X-Ray

**Status:** Done — explicit projection-update subsegments deferred (see acceptance criteria)

### Scenarios

```
Scenario: Lambda has active tracing enabled
  Given the deployed stack
  Then  the API function has X-Ray active tracing
  And   its execution role can put trace segments and telemetry records

Scenario: A request returns its trace ID
  Given the API is running
  When  I make a request
  Then  the response includes an x-amzn-trace-id header

Scenario: Event store calls appear as subsegments
  Given a command that reads and appends events
  When  it is traced
  Then  the trace shows named ReadEvents and AppendEvents subsegments
  And   the underlying DynamoDB calls appear under them

Scenario: A subsegment is always closed even when the operation throws
  Given an event store append that throws
  When  the subsegment is in scope
  Then  it is ended in a finally block and does not orphan the trace
```

### Acceptance criteria

- [x] `Tracing.ACTIVE` set on the Lambda in CDK; `Infrastructure.Assertions` confirms it and the X-Ray IAM grants
- [x] `AWSXRayRecorder.Handlers.AwsSdk` referenced; `RegisterXRayForAllServices()` called before the DynamoDB client is built
- [x] Event store read and append appear as named, stable subsegments (`ReadEvents`/`AppendEvents`). **Projection-update subsegments deferred** — projections are updated inline four different ways (the dispatcher is unused); SDK auto-instrumentation already captures the DynamoDB writes beneath the command. Same deferral as 12-B's `ProjectionUpdateDuration`.
- [x] Every subsegment is ended in a `finally` block — no orphaned segments
- [x] `x-amzn-trace-id` header returned on responses (echoes inbound API Gateway/Lambda trace id; falls back to the request id)
- [x] `Api.Integration` asserts the trace-ID header; `cdk synth` succeeds
- [x] `AWS_XRAY_CONTEXT_MISSING=LOG_ERROR` + recorder strategy so off-Lambda (local/tests) logs rather than throws on missing trace context

---

## Slice 12-D — CloudWatch Dashboard and the "all errors" view

**Status:** Done

### Scenarios

```
Scenario: The ops dashboard exists with the expected widgets
  Given the deployed stack
  Then  a CloudWatch dashboard named "notetaker-ops" exists
  And   it includes widgets for Lambda errors/invocations, latency, DynamoDB, and domain metrics
  And   it includes a Logs Insights widget that lists error-level log lines

Scenario: The error widget queries the API log group
  Given the dashboard's log-query widget
  Then  its query targets the API function's log group
  And   it surfaces correlation ID, CommandType, and StreamId fields

Scenario: The dashboard URL is output by the stack
  Given the deployed stack
  Then  a stack output provides the dashboard URL
```

### Acceptance criteria

- [x] A `notetaker-ops` dashboard is defined in CDK with the four metric widgets above
- [x] A Logs Insights `LogQueryWidget` lists recent error-level lines (`level`/`correlationId`/`message`), newest first
- [x] The dashboard relies on the dashboard time-range picker for "how far back" (no fixed window hard-coded)
- [x] The dashboard URL is emitted as a `CfnOutput`
- [x] `Infrastructure.Assertions` asserts the dashboard name, the errors-widget + domain-metric content, the `SUM(SEARCH)` domain queries, and the URL output
- [x] `cdk synth` succeeds
- Note: the domain widget queries metrics via `SUM(SEARCH('Namespace="NoteTaker/Domain" MetricName=…', 'Sum'))` — a free-text search that matches every dimension combination (Powertools injects a `Service` dimension alongside `CommandType`/`Aggregate`), rather than a fixed dimension schema. `CommandFailed` and `EventsAppended` are emitted by 12-B but intentionally not surfaced on this overview dashboard.

---

## Slice 12-E — CloudWatch Alarms and SNS notifications

**Status:** Done — error-rate + P99 latency alarms shipped; concurrency-conflict alarm deferred (CloudWatch rejects `SEARCH` on metric alarms — see acceptance criteria)

### Scenarios

```
Scenario: An alarm topic with an email subscription exists
  Given the deployed stack
  Then  an SNS topic "notetaker-alarms" exists
  And   it has an email subscription to the configured address

Scenario: Error-rate alarm is wired
  Given the deployed stack
  Then  an alarm fires when error rate exceeds 1% over 5 minutes
  And   it notifies the alarm topic

Scenario: Latency alarm is wired
  Given the deployed stack
  Then  an alarm fires when P99 duration exceeds 5s
  And   it notifies the alarm topic

Scenario: Concurrency-conflict alarm is wired
  Given the deployed stack
  Then  an alarm fires when more than 10 conflicts occur in 5 minutes
  And   it notifies the alarm topic
```

### Acceptance criteria

- [x] SNS `notetaker-alarms` topic defined with an email subscription to the configured address; address guarded with `string.IsNullOrEmpty` if sourced from config/secret
- [x] Error-rate alarm (>1% / 5 min, 2 periods, `NOT_BREACHING` on missing data) wired to the topic
- [x] P99 latency alarm (>5s / 5 min) wired to the topic
- [ ] Concurrency-conflict alarm (>10 / 5 min) wired to the topic — **deferred:** `ConcurrencyConflict` is emitted with per-`Aggregate` dimensions (plus Powertools' `Service` dimension), so aggregating across aggregates needs `SUM(SEARCH(...))` — which CloudWatch **rejects on metric alarms** ("SEARCH is not supported on Metric Alarms"; it is allowed only on dashboard widgets, which is why the 12-D dashboard uses it). The initial implementation shipped this and the deploy failed at the CloudWatch API (synth/`Template.FromStack` don't catch it). Alarming on it requires first emitting an alarmable dimensionless (or `Service`-only) `ConcurrencyConflict` metric — a follow-up. The dashboard still surfaces the conflict trend.
- [x] `Infrastructure.Assertions` asserts the topic, subscription, and the two shipped alarm thresholds + actions
- [ ] Alarm verified manually post-deploy via `aws cloudwatch set-alarm-state` (notification arrives) — pending
- [x] `cdk synth` succeeds; `cdk diff` reviewed before deploy

---

## Slice 12-F — Frontend monitoring (CloudWatch RUM)

**Status:** Done

### Scenarios

```
Scenario: A RUM AppMonitor exists for the app domain
  Given the deployed stack
  Then  a CloudWatch RUM AppMonitor "notetaker-rum" exists
  And   it is scoped to the app's domain
  And   it captures errors, performance, and http telemetry with X-Ray enabled

Scenario: The RUM snippet is injected at deploy time, not hard-coded
  Given the production build
  Then  index.html contains the RUM snippet populated with the AppMonitor ID
  And   the AppMonitor ID does not appear in source-controlled files

Scenario: RUM is not injected into non-production builds
  Given a local or PR-preview build
  Then  the RUM snippet placeholder is left empty
```

### Acceptance criteria

- [x] `CfnAppMonitor` "notetaker-rum" defined in CDK, scoped to the app domain, X-Ray enabled, telemetries errors/performance/http — plus the Cognito identity pool + guest role the browser client needs (see implementation note)
- [x] AppMonitor ID emitted as a `CfnOutput` (`RumMonitorId`); identity pool ID emitted as `RumIdentityPoolId`
- [x] `web/index.html` has an empty `rum-snippet` placeholder; the ID is never committed to source
- [x] `deploy.yml` injects the snippet (with the deployed AppMonitor ID) into `dist/index.html` for the deploy build only (both `deploy-test` and `deploy-production` jobs), fail-closed on missing outputs
- [x] `Infrastructure.Assertions` asserts the AppMonitor config (telemetries, X-Ray, sample rate), the unauthenticated identity pool, the `rum:PutRumEvents` guest role, and both outputs
- [x] Post-deploy: a deliberately-thrown browser error appears in the RUM console — verified on the live site (required the BUG-6 loader-host fix first)
- [x] `cdk synth` succeeds; `cdk diff` reviewed before deploy

---

## Slice 12-G — Observability runbook and saved Logs Insights queries

**Status:** Done — runbook `docs/observability.md` + four `NoteTaker/` saved queries live in prod. Note: the "By correlation ID" query became **"By trace ID"** (filters `xray_trace_id`) because `correlationId` is not actually a log field (see BUG-8); "Slowest commands" shipped as **"Slowest requests"** (Lambda `@duration` is per-invocation; X-Ray covers per-command). See `docs/learnings/_archive.md`.

### Scenarios

```
Scenario: The runbook documents where to find each signal
  Given docs/observability.md
  Then  it explains where to see errors, latency, a single request, and frontend crashes
  And   it includes the dashboard URL and the console paths for X-Ray and RUM

Scenario: Common queries are saved in Logs Insights
  Given the deployed stack
  Then  named saved queries exist for "All errors", "Slowest commands", and "Concurrency conflicts"
```

### Acceptance criteria

- [x] `docs/observability.md` written: a "how do I see X" runbook covering all three pillars + dashboard + alarms + RUM, with console paths and stack outputs
- [x] `CfnQueryDefinition`s added for All errors, Slowest requests, Concurrency-conflict timeline, and By trace ID — live in prod under the `NoteTaker/` folder (query fields verified against the real Powertools snake_case log shape)
- [x] `Infrastructure.Assertions` asserts the saved query definitions (count + each name + the concurrency query's filter text)
- [x] `CLAUDE.md` links to the runbook
- [x] `cdk synth` succeeds; deployed green and the four saved queries confirmed live

---

## Slice 12-H — Unified error view (frontend RUM errors on the ops dashboard)

**Status:** Done — implementation note: kept the existing 12-D backend "All errors" widget and added a *second* combined "All errors (backend + frontend)" `LogQueryWidget` (over both the API and derived RUM log groups) plus a RUM `JsErrorCount`/`HttpErrorCount` metric widget, rather than reordering the stack to extend the original widget. See `docs/learnings/_archive.md`.

### Scenarios

```
Scenario: The ops dashboard shows frontend error counts
  Given the deployed stack
  Then  the notetaker-ops dashboard has a widget plotting AWS/RUM JsErrorCount and HttpErrorCount for notetaker-rum

Scenario: The "all errors" table includes frontend errors
  Given the dashboard's all-errors log widget
  Then  it queries both the API Lambda log group and the RUM log group
  And   its query matches both backend Powertools error lines and RUM js_error_event entries

Scenario: A frontend error links to its backend trace
  Given a RUM http error that carried an X-Ray trace id (12-C)
  Then  the trace id is visible in the unified error view so it can be opened in X-Ray
```

### Acceptance criteria

- [x] `notetaker-ops` gains a `GraphWidget` for `AWS/RUM` `JsErrorCount` + `HttpErrorCount` (dimension `application_name = notetaker-rum`); no `CfnMetricsDestination` added — relying on RUM's default metrics (**verify they populate post-deploy; see TODO below**)
- [x] A combined "All errors (backend + frontend)" `LogQueryWidget` queries both the API and the RUM log group (name derived from the monitor GUID via `Fn.Select`/`Fn.Split`, not hard-coded) and matches both the Powertools and RUM `js_error_event` shapes (the original 12-D backend-only widget was left in place rather than reordering the stack)
- [x] The widget relies on the dashboard time-range picker (no fixed window)
- [x] `Infrastructure.Assertions` asserts the RUM namespace widget and the RUM log group + `js_error_event` query fragment (3 new tests)
- [x] `cdk synth` succeeds; deployed green
- [ ] Post-deploy: a real frontend error appears in the unified "All errors" table and the RUM metric widget increments — **TODO (verify on live):** confirm the `AWS/RUM` `JsErrorCount`/`HttpErrorCount` widget actually populates; if it stays empty, add a `CfnMetricsDestination` (`Destination = CloudWatch`) — Hawk flagged this as the most likely silent no-op
