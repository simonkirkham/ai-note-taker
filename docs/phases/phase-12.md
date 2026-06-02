# Phase 12 — Observability

**Goal:** Make the app properly observable for production — one place to answer "is it healthy?", "what broke?", and "why is it slow?". Today there is a single Lambda log group with unstructured text logs, no correlation IDs, no metrics, no traces, no dashboards, no alarms, and zero frontend visibility. This phase closes every one of those gaps using AWS-native tooling only.

**Learning surface:** The three pillars of observability (logs, metrics, traces) and how they correlate via a shared trace/correlation ID; AWS Lambda Powertools for .NET; CloudWatch Embedded Metric Format (EMF); AWS X-Ray distributed tracing and service maps; CloudWatch Dashboards and Alarms as code (CDK); CloudWatch RUM for real-user frontend monitoring; the event-sourcing-specific signals worth instrumenting (stream version on append, optimistic-concurrency conflicts, projection lag and rebuild duration); log hygiene (no PII at `Information`, domain exceptions are `Warning` not `Error`).

**Reference:** the `observability` skill (`.claude/skills/observability/SKILL.md`) is the implementation blueprint for this phase — each slice maps to one or more of its seven steps.

---

## Current state (what exists today)

| Capability | Status | Evidence |
|------------|--------|----------|
| Backend error logging | Plain-text only, HTTP layer only | `src/Api/LoggingConfig.cs` — default `ILogger`, logs method + path |
| Structured fields / correlation ID | None | No `x-correlation-id`, no `StreamId`/`CommandType` on log lines |
| Command/event handler logging | None | `src/Api/CommandHandlers/NoteCommandHandler.cs` has zero logging |
| Custom metrics (EMF) | None | No Powertools.Metrics package in `src/Api/Api.csproj` |
| Distributed tracing (X-Ray) | None | No `Tracing.ACTIVE` on the Lambda in `src/Infrastructure/NoteTakerStack.cs` |
| CloudWatch Dashboard | None | No `Dashboard` construct in the CDK |
| CloudWatch Alarms / SNS | None | No `Alarm` or `Topic` constructs |
| Log retention | Never expires (implicit group) | No explicit `LogGroup` construct or retention set |
| Frontend monitoring | None | No CloudWatch RUM AppMonitor |

Errors are technically in one log group (`/aws/lambda/NoteTakerStack-ApiFunction*`) but spread across many invocation log streams with no structured field to query by — so "see all errors in one place, choose how far back" is not yet answerable without manual string-matching. Slice 12-A + 12-F fix this directly.

---

## Slice order and dependencies

```
12-A  Structured logging + correlation IDs + log retention ──── foundation (do first)
12-B  Domain metrics (EMF) + event-sourcing log fields ──────── builds on 12-A
12-C  Distributed tracing (X-Ray) ────────────────────────────── builds on 12-A (shared correlation/trace ID)
12-D  CloudWatch Dashboard + Logs Insights "all errors" view ── builds on 12-A, 12-B
12-E  CloudWatch Alarms + SNS notifications ──────────────────── builds on 12-B (domain metrics) + Lambda metrics
12-F  Frontend monitoring (CloudWatch RUM) ───────────────────── independent (frontend + CDK)
12-G  Observability runbook + saved Logs Insights queries ───── builds on 12-A..12-F (documentation slice)
```

Recommended build order: **12-A → 12-B → 12-C → 12-D → 12-E**, with **12-F** runnable in parallel any time, and **12-G** last once the surfaces it documents exist.

---

## Slice 12-A — Structured logging, correlation IDs, and log retention

**Status:** Done

**Value:** Every log line becomes a queryable JSON record carrying a correlation ID, the HTTP method/path, and (for command flows, completed in 12-B) the stream ID and command type. The correlation ID is returned to the browser on every response and on the 500 error body, so a user-reported error can be traced to its exact log line. An explicit log group with a retention policy stops logs accumulating forever (cost + hygiene). This is the foundation the rest of the phase depends on, and it is what makes "show me all errors, last 24h / 7d" a one-query answer.

**Backend changes:** Add Lambda Powertools Logging; replace default logging providers; update the global exception handler; add an explicit `LogGroup` construct with retention in CDK.

**Skill steps:** Step 1 (packages), Step 2 (structured logging).

---

### Design

- Add `AWS.Lambda.Powertools.Logging` to `src/Api/Api.csproj`.
- In `src/Api/Builder.cs`, clear default providers and register the Powertools logger with `Service = "note-taker"`, default level `Information`, sampling rate `0`. **Do not** enable `LogEvent = true` on auth-bearing endpoints — it would log the full Lambda payload including the bearer token; if enabled at all, scrub `Authorization` first.
- In `src/Api/LoggingConfig.cs`, the unhandled-exception handler logs `CorrelationId={ctx.TraceIdentifier}`, sets the `x-correlation-id` response header, and returns it in the JSON error body so a user can quote it.
- In CDK (`src/Infrastructure/NoteTakerStack.cs`), create an explicit `LogGroup` for the function with `Retention = RetentionDays.ONE_MONTH` and `RemovalPolicy.DESTROY` (learning project), and pass it to the function's `LogGroup` prop so CDK manages it rather than letting the runtime auto-create an unmanaged group.

### Key implementation files

- `src/Api/Api.csproj` — add Powertools Logging package
- `src/Api/Builder.cs` — register `AddPowertoolsLogger`, clear default providers
- `src/Api/LoggingConfig.cs` — correlation ID into log, response header, error body
- `src/Infrastructure/NoteTakerStack.cs` — explicit `LogGroup` with retention; wire to function
- `tests/Infrastructure.Assertions/` — assert the log group exists with the expected retention
- `tests/Api.Integration/` — assert `x-correlation-id` header present on success and on a forced 500; assert error body includes the correlation ID

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

**Implementation note:** rather than the skill's "instrument each handler" model, the slice uses two single-responsibility seams that fit this codebase's reality (cascading folder deletes, multi-append action items, an unused `IDomainEventDispatcher`): an `IEventStore` decorator (`InstrumentedEventStore`) for append-level signals (`EventsAppended`, `ConcurrencyConflict`, stream/version log) and a `CommandInstrumentation` helper wrapping each handler for command-level signals (`CommandHandled`/`CommandFailed`). Metrics go through an `IDomainMetrics` abstraction (Powertools `Metrics.PushSingleMetric`), not the raw `IMetrics`. See `docs/learnings/phase-12b-domain-metrics.md`.

**Value:** The command/append/projection path becomes measurable and queryable. Command handlers emit EMF metrics (`CommandHandled`, `CommandFailed`, `EventsAppended`, `ConcurrencyConflict`, projection durations) and structured log lines that include the stream ID and version, so a single command's whole lifecycle is greppable and concurrency-conflict spikes are visible as a metric instead of buried in text. Domain rule violations are logged as `Warning` (expected business behaviour), not `Error` — keeping the error view clean.

**Backend changes:** Add Powertools Metrics; register `IMetrics`; instrument command handlers, the event store append path, and projection event handlers with metrics and structured logs.

**Skill steps:** Step 2 (handler log fields), Step 4 (custom metrics), event-sourcing checklist.

---

### Design

- Add `AWS.Lambda.Powertools.Metrics` to `Api.csproj`; register `IMetrics` (`Metrics.Instance`) in `Builder.cs`.
- Metrics namespace: `NoteTaker/Domain` for business signals, `NoteTaker/Infrastructure` for store-level signals.
- In each `*CommandHandler` (`src/Api/CommandHandlers/`): log `Command received {CommandType} {StreamId}` on entry; on success log `Events appended {StreamId} Version={Version} EventCount={Count}` and emit `CommandHandled` (+`EventsAppended`); on a domain exception log a `Warning` and emit `CommandFailed` with `ExceptionType`; on `ConditionalCheckFailedException` log a `Warning` and emit `ConcurrencyConflict`.
- In projection event handlers (`src/Api/Projections/`): time each handler and emit `ProjectionUpdateDuration` (ms) tagged with `ProjectionName`. The rebuild handler emits `ProjectionRebuildDuration` and logs start, event count, and total duration.
- Metric dimensions per the skill's table — keep them low-cardinality (`CommandType`, `Aggregate`, `ExceptionType`, `ProjectionName`); never put IDs in dimensions.

### Key implementation files

- `src/Api/Api.csproj` — add Powertools Metrics package
- `src/Api/Builder.cs` — register `IMetrics`
- `src/Api/CommandHandlers/*CommandHandler.cs` — structured logs + metrics on each path
- `src/Api/Projections/*EventHandler.cs` — projection duration metrics + logs
- `src/EventStore/` — surface the conflict signal so the handler can emit `ConcurrencyConflict` (no new write paths; reuse the existing OCC exception)
- `tests/Api.Integration/` — assert a command emits the expected metric (capture EMF stdout or assert via an `IMetrics` test double) and that a forced concurrency conflict emits `ConcurrencyConflict` and logs a `Warning`

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

**Value:** A single request can be followed end to end as a trace: the Lambda invocation, each DynamoDB call (event store read, append, projection writes), and named subsegments for the domain steps. The X-Ray service map shows where latency lives and which downstream call failed. The trace ID is propagated to the HTTP response so a frontend error (12-F) links straight to its backend trace.

**Backend changes:** Enable active tracing on the Lambda in CDK; register X-Ray instrumentation for the AWS SDK; add subsegments around event store read/append and projection updates; propagate the trace ID header.

**Skill steps:** Step 3 (3a–3d).

---

### Design

- CDK: add `Tracing = Lambda.Tracing.ACTIVE` to the function props (CDK auto-grants `xray:PutTraceSegments` / `PutTelemetryRecords`).
- Add `AWSXRayRecorder.Handlers.AwsSdk` to `Api.csproj`; call `AWSSDKHandler.RegisterXRayForAllServices()` in `Builder.cs` before the DynamoDB client is created so all SDK calls join the active trace.
- Wrap event store **read**, event store **append**, and **projection update** in named subsegments (`ReadEvents`, `AppendEvents`, `UpdateProjection`) using `BeginSubsegment`/`EndSubsegment` in a `finally` block — never orphan a subsegment. Subsegment names are stable (no IDs) so they group in X-Ray Analytics.
- Add middleware to set `x-amzn-trace-id` on the response (reuse the correlation middleware from 12-A).

### Key implementation files

- `src/Infrastructure/NoteTakerStack.cs` — `Tracing.ACTIVE`
- `src/Api/Api.csproj` — add `AWSXRayRecorder.Handlers.AwsSdk`
- `src/Api/Builder.cs` — `RegisterXRayForAllServices()`
- `src/EventStore/` — subsegments around read/append (in a `finally`)
- `src/Api/Projections/` — subsegment around projection update
- `src/Api/LoggingConfig.cs` — `x-amzn-trace-id` response header
- `tests/Infrastructure.Assertions/` — assert `Tracing: ACTIVE` and the X-Ray IAM permissions on the function role
- `tests/Api.Integration/` — assert the `x-amzn-trace-id` response header is present

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

**Status:** Not started

**Value:** One URL — `notetaker-ops` — shows Lambda errors & invocations, P50/P99 latency, DynamoDB capacity & errors, and the domain metrics from 12-B (commands handled, concurrency conflicts). It includes a **Logs Insights errors widget** that lists recent errors across all invocation streams, plus the dashboard's built-in time-range picker — directly answering "see all errors in one place and choose how far back." This is defined in CDK so it is reproducible and reviewed like any other change.

**Backend changes:** Add a `Dashboard` construct with metric widgets and a Logs Insights query widget in CDK.

**Skill steps:** Step 5 (dashboard).

---

### Design

- Add a `Dashboard` (`DashboardName = "notetaker-ops"`) in `NoteTakerStack.cs` after the function and table are defined.
- Metric widgets (per the skill): Lambda errors & invocations; Lambda P50/P99 duration; DynamoDB consumed write capacity + system errors; domain `CommandHandled` vs `ConcurrencyConflict` (`NoteTaker/Domain`, `Sum`).
- Add a `LogQueryWidget` running a Logs Insights query over the API log group that filters to error-level lines and shows `@timestamp`, correlation ID, `CommandType`, `StreamId`, and `@message`, sorted newest first — this is the single "all errors" panel.
- Output the dashboard URL via `CfnOutput` so it's discoverable post-deploy.

### Key implementation files

- `src/Infrastructure/NoteTakerStack.cs` — `Dashboard`, `GraphWidget`s, `LogQueryWidget`, `CfnOutput` for the URL
- `tests/Infrastructure.Assertions/` — assert a dashboard named `notetaker-ops` exists with the expected number of widgets and that the error log-query widget targets the API log group

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

- [ ] A `notetaker-ops` dashboard is defined in CDK with the four metric widgets above
- [ ] A Logs Insights `LogQueryWidget` lists recent error-level lines with correlation ID, `CommandType`, `StreamId`, and message, newest first
- [ ] The dashboard relies on the dashboard time-range picker for "how far back" (no fixed window hard-coded into the widget where the picker should drive it)
- [ ] The dashboard URL is emitted as a `CfnOutput`
- [ ] `Infrastructure.Assertions` asserts the dashboard name, widget count, and log-query target
- [ ] `cdk synth` succeeds; `cdk diff` reviewed before deploy

---

## Slice 12-E — CloudWatch Alarms and SNS notifications

**Status:** Not started

**Value:** Problems find you instead of you finding them. An SNS topic emails a subscriber when the Lambda error rate exceeds 1%, when P99 latency exceeds 5s, or when optimistic-concurrency conflicts spike — turning the dashboard from something you remember to check into something that pages you.

**Backend changes:** Add an SNS topic with an email subscription and three CloudWatch alarms wired to it in CDK.

**Skill steps:** Step 6 (alarms).

---

### Design

- SNS `Topic` (`notetaker-alarms`) with an `EmailSubscription` to `simon.kirkham+note-taker-ai@gmail.com` (the address is the only environment-specific value — keep it in one place / a CDK prop so it's easy to change; guard with `string.IsNullOrEmpty` if sourced from a secret, per the project guardrail).
- Alarms (all → `SnsAction(topic)`):
  - **Error rate** > 1% over 5 min, 2 eval periods, via a `MathExpression` of `errors / invocations * 100`; `TreatMissingData.NOT_BREACHING`.
  - **P99 latency** > 5000 ms over 5 min, 2 eval periods.
  - **Concurrency conflicts** > 10 in 5 min over the `NoteTaker/Domain ConcurrencyConflict` metric (depends on 12-B).

### Key implementation files

- `src/Infrastructure/NoteTakerStack.cs` — `Topic`, `EmailSubscription`, three `Alarm`s with `SnsAction`
- `src/Infrastructure/Infrastructure.csproj` — ensure `Amazon.CDK.AWS.SNS` / `Subscriptions` / `CloudWatch.Actions` available (bundled in the main CDK lib)
- `tests/Infrastructure.Assertions/` — assert the topic, the email subscription, and each alarm's threshold + action

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

- [ ] SNS `notetaker-alarms` topic defined with an email subscription to the configured address; address guarded with `string.IsNullOrEmpty` if sourced from config/secret
- [ ] Error-rate alarm (>1% / 5 min, 2 periods, `NOT_BREACHING` on missing data) wired to the topic
- [ ] P99 latency alarm (>5s / 5 min) wired to the topic
- [ ] Concurrency-conflict alarm (>10 / 5 min) wired to the topic
- [ ] `Infrastructure.Assertions` asserts the topic, subscription, and all three alarm thresholds + actions
- [ ] Alarm verified manually post-deploy via `aws cloudwatch set-alarm-state` (notification arrives)
- [ ] `cdk synth` succeeds; `cdk diff` reviewed before deploy

---

## Slice 12-F — Frontend monitoring (CloudWatch RUM)

**Status:** Not started

**Value:** The blind spot — the browser — becomes visible. CloudWatch RUM captures JavaScript errors, Core Web Vitals, and failed API calls from real users on the deployed CloudFront domain, and (with X-Ray enabled on the monitor) links a frontend error to its backend trace via the trace ID propagated in 12-C. This is the other half of "see all errors in one place": frontend errors that never reach the Lambda.

**Backend changes:** Add a CloudWatch RUM `AppMonitor` in CDK; inject the RUM snippet into the built frontend at deploy time.

**Skill steps:** Step 7 (7a–7b).

---

### Design

- CDK: `CfnAppMonitor` (`notetaker-rum`) scoped to the CloudFront/custom domain, `CwLogEnabled = true`, `EnableXRay = true`, telemetries `errors`/`performance`/`http`, session sample rate `1.0` (learning project; lower for cost in real prod). Output the AppMonitor ID via `CfnOutput`.
- The RUM snippet is **injected at deploy time** (e.g. `sed` into `dist/index.html` in `deploy.yml`) using the AppMonitor ID read from stack outputs — the ID is **not** hard-coded in source, so it stays environment-specific. `web/index.html` carries an empty `<script id="rum-snippet"></script>` placeholder.
- Do **not** wire RUM into localhost or PR-preview builds — RUM only works when the domain matches the monitor's configured domain. Guard the injection so it runs only for the production/deploy build.

### Key implementation files

- `src/Infrastructure/NoteTakerStack.cs` — `CfnAppMonitor`, `CfnOutput` for the ID
- `src/Infrastructure/Infrastructure.csproj` — add `Amazon.CDK.AWS.RUM`
- `web/index.html` — empty `rum-snippet` placeholder before `</head>`
- `.github/workflows/deploy.yml` — read `RumMonitorId` output; inject the snippet into `dist/index.html` after build, before S3 upload
- `tests/Infrastructure.Assertions/` — assert the AppMonitor exists with the expected telemetries and X-Ray enabled

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

- [ ] `CfnAppMonitor` "notetaker-rum" defined in CDK, scoped to the app domain, X-Ray enabled, telemetries errors/performance/http
- [ ] AppMonitor ID emitted as a `CfnOutput`
- [ ] `web/index.html` has an empty `rum-snippet` placeholder; the ID is never committed to source
- [ ] `deploy.yml` injects the snippet (with the deployed AppMonitor ID) into `dist/index.html` for production only
- [ ] `Infrastructure.Assertions` asserts the AppMonitor config
- [ ] Post-deploy: a deliberately-thrown browser error appears in the RUM console
- [ ] `cdk synth` succeeds; `cdk diff` reviewed before deploy

---

## Slice 12-G — Observability runbook and saved Logs Insights queries

**Status:** Not started

**Value:** The surfaces built in 12-A..12-F are only useful if you know where to look. This slice writes a short runbook (`docs/observability.md`) — "where do I see errors / latency / a single user's request / a frontend crash", with the dashboard URL, the X-Ray console path, the RUM console path, and a set of copy-paste Logs Insights queries (all errors, errors for one correlation ID, slowest commands, concurrency-conflict timeline). The most-used queries are also saved as CDK `CfnQueryDefinition`s so they appear in the Logs Insights query picker for everyone.

**Backend changes:** Add `CfnQueryDefinition`s in CDK for the saved queries.

**Skill steps:** consolidates the verification section of the skill into living docs.

---

### Design

- Write `docs/observability.md`: a one-page "how do I see X" runbook covering logs, metrics, traces, dashboard, alarms, and RUM, with the exact console paths and the stack outputs (dashboard URL, RUM ID) that locate them.
- Add `CfnQueryDefinition` constructs in CDK for: **All errors** (filter error level, newest first), **By correlation ID** (parameterised note in the runbook), **Slowest commands**, **Concurrency-conflict timeline**. These persist as named saved queries in Logs Insights.
- Cross-link from `CLAUDE.md`'s skills/docs list so future agents find the runbook.

### Key implementation files

- `docs/observability.md` — new runbook
- `src/Infrastructure/NoteTakerStack.cs` — `CfnQueryDefinition`s for the saved queries
- `tests/Infrastructure.Assertions/` — assert the saved query definitions exist
- `CLAUDE.md` — add a pointer to `docs/observability.md`

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

- [ ] `docs/observability.md` written: a "how do I see X" runbook covering all three pillars + dashboard + alarms + RUM, with console paths and stack outputs
- [ ] `CfnQueryDefinition`s added for All errors, Slowest commands, and Concurrency-conflict timeline (and a documented by-correlation-ID query)
- [ ] `Infrastructure.Assertions` asserts the saved query definitions
- [ ] `CLAUDE.md` links to the runbook
- [ ] `cdk synth` succeeds

---

## Deferred / explicitly out of scope

- **Synthetic uptime canary (CloudWatch Synthetics)** — a heartbeat that catches "the whole app is down" when there is no user traffic to trigger the error-rate alarm. Worth a follow-up slice; deferred to keep this phase focused on observing real traffic.
- **SLO/SLI definitions and error budgets** — formalising targets (e.g. 99.5% success, P99 < 1s) once the metrics from 12-B/12-D have produced a baseline.
- **Log/metric cost controls beyond retention** — sampling at `Information`, metric-cardinality budgets; revisit if CloudWatch spend grows.
- **PagerDuty / on-call escalation** — the SNS topic in 12-E is the integration point; wiring a pager is out of scope for a learning project.
- **Anomaly-detection alarms** — static thresholds first; CloudWatch anomaly detection once there's enough history to train on.
