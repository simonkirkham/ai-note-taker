# Learnings — Slice 12-E: CloudWatch Alarms + SNS notifications

## `SEARCH()` works on dashboard widgets but is rejected on metric alarms

The concurrency-conflict alarm reused the exact pattern the 12-D dashboard uses for the same metric — `SUM(SEARCH('Namespace="NoteTaker/Domain" MetricName="ConcurrencyConflict"', 'Sum'))` — and the `cdk deploy` failed at `CREATE`:

> `SEARCH is not supported on Metric Alarms. (Service: CloudWatch, Status Code: 400)`

CloudWatch allows `SEARCH` expressions in **dashboard** math (a widget can plot a search across many series) but **not** as an **alarm's** metric — an alarm must resolve to a single, deterministic time series. The stack rolled back cleanly (no production impact), but main's pipeline went red until the fix.

Why the alarm even wanted SEARCH: `ConcurrencyConflict` is emitted with per-`Aggregate` dimensions (`{Service, Aggregate}` — Powertools adds `Service` from its `service:` arg, see [[phase-12d-ops-dashboard]]). To alarm on "conflicts across all aggregates" you'd have to aggregate over an unknown dimension set, which only SEARCH can do — and SEARCH is banned on alarms. So the alarm was deferred. Alarming on it properly requires first emitting an **alarmable** signal: either a dimensionless (or `Service`-only) `ConcurrencyConflict` metric, or one metric per known aggregate summed via `UsingMetrics` (metric math without SEARCH *is* allowed on alarms — the error-rate alarm uses `errors / invocations * 100` with `UsingMetrics` and deploys fine).

**Rule:** never put `SEARCH` in an alarm metric. If you need to alarm on a dimensioned EMF metric, emit an alarm-friendly aggregate of it (no dimensions, or a fixed known set), or use `MathExpression` + `UsingMetrics` over concrete metrics. Reserve `SEARCH` for dashboards.

## `cdk synth` / `Template.FromStack` validate template *shape*, not AWS *acceptance*

This is the second deploy-only failure this phase (the first: the RUM loader CDN host in [[phase-12f-frontend-rum]] / BUG-6). Both passed `dotnet build`, all `Template.FromStack` assertions, Hawk review, and `cdk synth` — and both failed only when CloudFormation called the real AWS API at deploy time. Synth proves the template is well-formed and matches your assertions; it does **not** prove AWS will accept every property value (a non-resolving CDN host, a SEARCH expression on an alarm, an invalid dimension, a quota, etc.).

**Rule:** for CDK changes whose correctness depends on an AWS service *accepting* a value (alarm metric math, RUM/Cognito wiring, cross-service ARNs, log-group names), treat the real deploy as the gate — and when deploying a risky infra change, watch the `cdk deploy` step specifically, not just the final pipeline conclusion. A green synth is necessary, not sufficient.

## Error-rate alarm: `NOT_BREACHING` avoids divide-by-zero false pages

The error-rate alarm computes `errors / invocations * 100`. During idle windows `invocations` is 0, so the expression is undefined and CloudWatch reports missing data. `TreatMissingData.NOT_BREACHING` keeps the alarm OK in that case rather than paging on "no traffic". The two shipped alarms (error rate >1% / 2 periods, P99 latency >5s) are the high-value ones; the SNS topic (`notetaker-alarms`) emails a single configured address — kept as a const since it's not config-sourced (the `IsNullOrEmpty` guardrail only applies to `${{ secrets }}`-sourced values that arrive as `""`).
