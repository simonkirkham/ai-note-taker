---
name: observability
description: Add or extend observability (structured logs, distributed traces, custom metrics, dashboards, alarms) across the .NET Lambda + DynamoDB + CloudFront stack. Use when adding a new slice that needs instrumentation, when debugging a production incident and visibility is insufficient, or when wiring up observability for the first time. Triggers include "add logging", "add tracing", "add metrics", "I can't see what's happening", "dashboard", "alarm", "observability".
---

# Observability

This skill adds production-grade observability to the app using three pillars: **structured logs**, **distributed traces**, and **custom metrics**. All tooling is AWS-native — no third-party APM.

## Pillar overview

| Pillar | Tool | Where it lands |
|--------|------|---------------|
| Logs | AWS Lambda Powertools (Logging) | CloudWatch Logs |
| Traces | AWS X-Ray via Lambda Powertools (Tracing) | X-Ray service map |
| Metrics | AWS Lambda Powertools (Metrics, EMF) | CloudWatch Metrics |
| Frontend | CloudWatch RUM | CloudWatch RUM console |
| Dashboards | CloudWatch Dashboard (CDK) | CloudWatch Dashboards |
| Alarms | CloudWatch Alarms (CDK) | SNS → email / PagerDuty |

---

## Step 1 — Add Lambda Powertools packages

In `src/Api/Api.csproj`, add:

```xml
<PackageReference Include="AWS.Lambda.Powertools.Logging" Version="3.2.2" />
<PackageReference Include="AWS.Lambda.Powertools.Tracing" Version="1.*" />
<PackageReference Include="AWS.Lambda.Powertools.Metrics" Version="1.*" />
```

These three packages share a common Powertools core and add zero cold-start overhead beyond their own init. They emit JSON, embed correlation IDs, and push EMF metric blobs to stdout (Lambda picks them up automatically).

> **Version note (learned in 12-A):** the `builder.Logging.AddPowertoolsLogger(...)` ILogger-provider API in Step 2 only exists from Powertools **v2+** — pinning `1.*` for Logging will not compile against that snippet (v1 used the static `Logger` API and the `[Logging]` handler decorator). 12-A shipped on Logging `3.2.2`. Pin the latest current-major version and check the package feed before pinning; the Tracing/Metrics pins above are still illustrative — verify them the same way when 12-C/12-B implement them.

---

## Step 2 — Configure structured logging

Replace the raw `AddLogging(app)` call in `LoggingConfig.cs` with Powertools-backed structured logging.

**In `src/Api/Builder.cs`**, register Powertools logging before `builder.Build()`:

```csharp
builder.Logging.ClearProviders();
builder.Logging.AddPowertoolsLogger(options =>
{
    options.Service = "note-taker";
    options.LogLevel = LogLevel.Information;
    options.SamplingRate = 0;        // 0 = log all; raise to 0.1 for debug sampling in prod
    options.LogEvent = true;         // include Lambda event in cold-start log
});
```

**In `src/Api/LoggingConfig.cs`**, update the exception handler to log correlation context:

```csharp
log.LogError(ex, "Unhandled exception on {Method} {Path} CorrelationId={CorrelationId}",
    ctx.Request.Method, ctx.Request.Path,
    ctx.TraceIdentifier);
ctx.Response.StatusCode = 500;
ctx.Response.Headers["x-correlation-id"] = ctx.TraceIdentifier;
await ctx.Response.WriteAsJsonAsync(new { error = "internal server error" });
```

**Structured log fields every command handler must emit** (add to the command handler's `ILogger<T>` calls):

```csharp
// On command receipt:
logger.LogInformation("Command received {CommandType} {StreamId}", commandType, streamId);

// On successful append:
logger.LogInformation("Events appended {StreamId} Version={Version} EventCount={Count}",
    streamId, newVersion, events.Length);

// On concurrency conflict:
logger.LogWarning("Concurrency conflict {StreamId} ExpectedVersion={Expected}",
    streamId, expectedVersion);

// On domain exception:
logger.LogWarning("Domain rule violation {CommandType} {StreamId} {ExceptionType} {Message}",
    commandType, streamId, ex.GetType().Name, ex.Message);
```

---

## Step 3 — Enable distributed tracing

### 3a — Lambda function: enable active tracing in CDK

In `src/Infrastructure/NoteTakerStack.cs`, add to the Lambda `FunctionProps`:

```csharp
Tracing = Amazon.CDK.AWS.Lambda.Tracing.ACTIVE,
```

CDK automatically grants `xray:PutTraceSegments` and `xray:PutTelemetryRecords` to the function when `Tracing.ACTIVE` is set — no extra IAM needed.

### 3b — DynamoDB client: enable X-Ray instrumentation

In `src/Api/Builder.cs`, wrap the DynamoDB client registration so the AWS SDK participates in the active trace. Add `RegisterXRayForAllServices()` before the DynamoDB client is created:

```csharp
// X-Ray instruments all AWS SDK calls (DynamoDB, etc.) automatically.
Amazon.XRay.Recorder.Handlers.AwsSdk.AWSSDKHandler.RegisterXRayForAllServices();
```

Add the NuGet package: `AWSXRayRecorder.Handlers.AwsSdk` to `Api.csproj`.

### 3c — Annotate command handlers with custom subsegments

For any method worth seeing as a named segment in the X-Ray trace, wrap with:

```csharp
using Amazon.XRay.Recorder.Core;

AWSXRayRecorder.Instance.BeginSubsegment("AppendEvents");
try
{
    // ... event store append ...
}
finally
{
    AWSXRayRecorder.Instance.EndSubsegment();
}
```

Do this for: event store reads, event store appends, and projection updates. Keep subsegment names stable (don't include IDs) — they become grouping keys in X-Ray Analytics.

### 3d — Propagate trace ID to the HTTP response

Add to `LoggingConfig.AddLogging`:

```csharp
app.Use(async (ctx, next) =>
{
    ctx.Response.Headers["x-amzn-trace-id"] = ctx.TraceIdentifier;
    await next();
});
```

This lets browser DevTools correlate a frontend error with a specific X-Ray trace.

---

## Step 4 — Publish custom metrics

Custom metrics use CloudWatch's Embedded Metric Format (EMF). Lambda Powertools flushes them to stdout; Lambda ships them to CloudWatch Metrics automatically.

**Register the metrics provider in `Builder.cs`**:

```csharp
builder.Services.AddSingleton<IMetrics>(Metrics.Instance);
```

**Key metrics to emit** — one `Metrics.AddMetric` call per business event, not per HTTP request:

| Metric name | Unit | When to emit | Dimensions |
|-------------|------|-------------|------------|
| `CommandHandled` | Count | command handler success | `CommandType`, `Aggregate` |
| `CommandFailed` | Count | domain exception thrown | `CommandType`, `ExceptionType` |
| `EventsAppended` | Count | after successful append | `Aggregate` |
| `ConcurrencyConflict` | Count | on `ConditionalCheckFailedException` | `Aggregate` |
| `ProjectionUpdateDuration` | Milliseconds | after each `IDomainEventHandler` | `ProjectionName` |
| `ProjectionRebuildDuration` | Milliseconds | after a full rebuild | `ProjectionName` |

**Example in a command handler**:

```csharp
Metrics.AddMetric("CommandHandled", 1, MetricUnit.Count,
    ("CommandType", nameof(CreateNoteCommand)),
    ("Aggregate", "Note"));
```

**Namespace**: use `NoteTaker/Domain` for business metrics, `NoteTaker/Infrastructure` for DynamoDB-level metrics.

---

## Step 5 — CloudWatch Dashboard (CDK)

Add a dashboard construct in `NoteTakerStack.cs`. A minimal starter:

```csharp
var dashboard = new Amazon.CDK.AWS.CloudWatch.Dashboard(this, "Dashboard", new Amazon.CDK.AWS.CloudWatch.DashboardProps
{
    DashboardName = "notetaker-ops"
});

dashboard.AddWidgets(
    new Amazon.CDK.AWS.CloudWatch.GraphWidget(new Amazon.CDK.AWS.CloudWatch.GraphWidgetProps
    {
        Title = "Lambda errors & invocations",
        Left = new[]
        {
            apiFunction.MetricErrors(),
            apiFunction.MetricInvocations()
        },
        Width = 12
    }),
    new Amazon.CDK.AWS.CloudWatch.GraphWidget(new Amazon.CDK.AWS.CloudWatch.GraphWidgetProps
    {
        Title = "Lambda P50/P99 duration",
        Left = new[]
        {
            apiFunction.MetricDuration(new Amazon.CDK.AWS.CloudWatch.MetricOptions { Statistic = "p50" }),
            apiFunction.MetricDuration(new Amazon.CDK.AWS.CloudWatch.MetricOptions { Statistic = "p99" })
        },
        Width = 12
    }),
    new Amazon.CDK.AWS.CloudWatch.GraphWidget(new Amazon.CDK.AWS.CloudWatch.GraphWidgetProps
    {
        Title = "DynamoDB consumed write capacity",
        Left = new[]
        {
            eventsTable.MetricConsumedWriteCapacityUnits(),
            eventsTable.MetricSystemErrorsForOperations()
        },
        Width = 12
    }),
    new Amazon.CDK.AWS.CloudWatch.GraphWidget(new Amazon.CDK.AWS.CloudWatch.GraphWidgetProps
    {
        Title = "Commands & concurrency conflicts",
        Left = new[]
        {
            new Amazon.CDK.AWS.CloudWatch.Metric(new Amazon.CDK.AWS.CloudWatch.MetricProps
            {
                Namespace = "NoteTaker/Domain",
                MetricName = "CommandHandled",
                Statistic = "Sum"
            }),
            new Amazon.CDK.AWS.CloudWatch.Metric(new Amazon.CDK.AWS.CloudWatch.MetricProps
            {
                Namespace = "NoteTaker/Domain",
                MetricName = "ConcurrencyConflict",
                Statistic = "Sum"
            })
        },
        Width = 12
    })
);
```

---

## Step 6 — CloudWatch Alarms (CDK)

Add these alarms after the dashboard. Wire an SNS topic for email notification:

```csharp
var alarmTopic = new Amazon.CDK.AWS.SNS.Topic(this, "AlarmTopic", new Amazon.CDK.AWS.SNS.TopicProps
{
    TopicName = "notetaker-alarms"
});
// Subscribe an email address:
// new Amazon.CDK.AWS.SNS.Subscriptions.EmailSubscription("oncall@example.com")

// Lambda error rate > 1% over 5 minutes
var errorRateAlarm = new Amazon.CDK.AWS.CloudWatch.Alarm(this, "ErrorRateAlarm", new Amazon.CDK.AWS.CloudWatch.AlarmProps
{
    Metric = new Amazon.CDK.AWS.CloudWatch.MathExpression(new Amazon.CDK.AWS.CloudWatch.MathExpressionProps
    {
        Expression = "errors / invocations * 100",
        UsingMetrics = new Dictionary<string, Amazon.CDK.AWS.CloudWatch.IMetric>
        {
            ["errors"] = apiFunction.MetricErrors(new Amazon.CDK.AWS.CloudWatch.MetricOptions { Period = Duration.Minutes(5) }),
            ["invocations"] = apiFunction.MetricInvocations(new Amazon.CDK.AWS.CloudWatch.MetricOptions { Period = Duration.Minutes(5) })
        }
    }),
    Threshold = 1,
    EvaluationPeriods = 2,
    AlarmDescription = "Lambda error rate > 1%",
    TreatMissingData = Amazon.CDK.AWS.CloudWatch.TreatMissingData.NOT_BREACHING
});
errorRateAlarm.AddAlarmAction(new Amazon.CDK.AWS.CloudWatch.Actions.SnsAction(alarmTopic));

// Lambda P99 > 5s over 5 minutes
var latencyAlarm = new Amazon.CDK.AWS.CloudWatch.Alarm(this, "LatencyAlarm", new Amazon.CDK.AWS.CloudWatch.AlarmProps
{
    Metric = apiFunction.MetricDuration(new Amazon.CDK.AWS.CloudWatch.MetricOptions
    {
        Statistic = "p99",
        Period = Duration.Minutes(5)
    }),
    Threshold = 5000,
    EvaluationPeriods = 2,
    AlarmDescription = "Lambda P99 duration > 5s"
});
latencyAlarm.AddAlarmAction(new Amazon.CDK.AWS.CloudWatch.Actions.SnsAction(alarmTopic));

// Concurrency conflicts spike
var conflictAlarm = new Amazon.CDK.AWS.CloudWatch.Alarm(this, "ConcurrencyConflictAlarm", new Amazon.CDK.AWS.CloudWatch.AlarmProps
{
    Metric = new Amazon.CDK.AWS.CloudWatch.Metric(new Amazon.CDK.AWS.CloudWatch.MetricProps
    {
        Namespace = "NoteTaker/Domain",
        MetricName = "ConcurrencyConflict",
        Statistic = "Sum",
        Period = Duration.Minutes(5)
    }),
    Threshold = 10,
    EvaluationPeriods = 2,
    AlarmDescription = "More than 10 optimistic-lock conflicts in 5 minutes"
});
conflictAlarm.AddAlarmAction(new Amazon.CDK.AWS.CloudWatch.Actions.SnsAction(alarmTopic));
```

---

## Step 7 — Frontend monitoring (CloudWatch RUM)

CloudWatch RUM captures browser errors, Core Web Vitals, and API call failures from the React app. Add the AppMonitor in CDK and inject the RUM snippet into the frontend build.

### 7a — Add AppMonitor in CDK

```csharp
var rumMonitor = new Amazon.CDK.AWS.RUM.CfnAppMonitor(this, "RumMonitor", new Amazon.CDK.AWS.RUM.CfnAppMonitorProps
{
    Name = "notetaker-rum",
    Domain = props.DomainName ?? distribution.DistributionDomainName,
    CwLogEnabled = true,
    AppMonitorConfiguration = new Amazon.CDK.AWS.RUM.CfnAppMonitor.AppMonitorConfigurationProperty
    {
        AllowCookies = true,
        EnableXRay = true,
        SessionSampleRate = 1.0,
        Telemetries = new[] { "errors", "performance", "http" }
    }
});

new CfnOutput(this, "RumMonitorId", new CfnOutputProps
{
    Value = rumMonitor.AttrId,
    Description = "CloudWatch RUM AppMonitor ID"
});
```

Add NuGet to `Infrastructure.csproj`: `Amazon.CDK.AWS.RUM`.

### 7b — Inject the RUM snippet into the React app

In `web/index.html`, add before `</head>`:

```html
<!-- CloudWatch RUM — populated at deploy time via sed in deploy.sh -->
<script id="rum-snippet"></script>
```

In your deploy script (GitHub Actions `deploy.yml`), after `cdk deploy`:

```bash
RUM_ID=$(aws cloudformation describe-stacks \
  --stack-name NoteTakerStack \
  --query "Stacks[0].Outputs[?OutputKey=='RumMonitorId'].OutputValue" \
  --output text)

RUM_SNIPPET=$(cat << EOF
(function(n,i,v,r,s,c,x,z){s=window.cwr;if(!s){...aws-rum-web snippet...}
EOF
)
sed -i "s|<script id=\"rum-snippet\"></script>|<script id=\"rum-snippet\">${RUM_SNIPPET}</script>|" dist/index.html
```

The full RUM snippet comes from the CloudWatch RUM console after the AppMonitor is created. Embed it verbatim. Do not hard-code the AppMonitor ID in source — inject at deploy time so it stays environment-specific.

---

## Event-sourcing observability checklist

The event-sourced architecture has specific observability needs beyond standard HTTP monitoring:

- [ ] **Stream ID on every log line** — all command handler logs include the aggregate stream ID so you can `grep` or Log Insights query a complete command lifecycle
- [ ] **Stream version on append** — log the version before and after every append; this makes optimistic concurrency debugging trivial
- [ ] **Projection lag** — if projections are updated synchronously (in-process), trace the dispatch + each handler as a subsegment; if async, add a metric for handler latency
- [ ] **Rebuild visibility** — `ProjectionRebuildHandler` must log start, event count processed, and total duration; emit a `ProjectionRebuildDuration` metric at the end
- [ ] **Domain exceptions** — every domain exception is a `Warning`, not an `Error`; it is expected business behaviour, not a bug
- [ ] **Cold starts** — Powertools logging automatically marks cold-start log entries; X-Ray shows init duration separately; do not suppress these

---

## Verification

1. **Deploy** with the new packages and CDK changes.
2. **Trigger a command** from the UI.
3. **Logs**: `aws logs tail /aws/lambda/<function-name> --follow` — confirm JSON structure with `StreamId`, `Version`, `CommandType` fields.
4. **Traces**: CloudWatch → X-Ray → Traces — find the trace for the command; confirm DynamoDB subsegments are visible.
5. **Metrics**: CloudWatch → Metrics → `NoteTaker/Domain` — confirm `CommandHandled` count incremented.
6. **Dashboard**: CloudWatch → Dashboards → `notetaker-ops` — all four widgets populated.
7. **Alarm test**: manually set the alarm to `ALARM` state with `aws cloudwatch set-alarm-state` and confirm notification arrives.

---

## Don't

- Don't log full request bodies or event payloads at `Information` level — they contain user data; log only IDs and types.
- Don't add a `Debug`-level log inside a tight loop (projection rebuild handles thousands of events).
- Don't create a new CloudWatch Log Group per command type — the function already has one group; use structured fields for filtering.
- Don't set `LogEvent = true` in production without understanding the cold-start log will include the full Lambda payload — strip sensitive fields from auth-bearing endpoints.
- Don't use `AWSXRayRecorder.Instance.BeginSubsegment` without a matching `EndSubsegment` in a `finally` block — orphaned segments block the trace.
- Don't add RUM to a localhost or PR preview environment — RUM only works when the domain matches the AppMonitor's configured domain.
