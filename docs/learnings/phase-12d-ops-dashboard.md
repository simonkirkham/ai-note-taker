# Learnings — Slice 12-D: CloudWatch ops dashboard + the "all errors" view

## A dashboard query for a dimensioned metric must match the *full* dimension set — or use a free-text SEARCH

The "Commands handled vs concurrency conflicts" widget was written twice wrong before it was right, both times producing an empty graph:

1. **Dimensionless `Metric`** (`Namespace=NoteTaker/Domain`, `MetricName=CommandHandled`, no dimensions). In CloudWatch a metric published *with* dimensions is a distinct time series from the same name *without* dimensions — the undimensioned series is never written, so the widget read nothing.
2. **Exact-schema `SUM(SEARCH('{NoteTaker/Domain,Aggregate,CommandType} …'))`.** Closer, but still empty: `Metrics.PushSingleMetric(service: "note-taker", …)` makes Powertools inject a **`Service` dimension** on top of the ones in the dict, so the real series carry `{Service, Aggregate, CommandType}`. The schema form matches the *exact* key set, and ours omitted `Service`.

The fix that's both correct and durable: a **free-text** search — `SUM(SEARCH('Namespace="NoteTaker/Domain" MetricName="CommandHandled"', 'Sum'))`. Free-text matches any metric with that namespace + name *regardless of dimension schema*, then `SUM` collapses the per-dimension series into one line. It can't go stale when dimensions change.

**Rule:** to chart a metric emitted with dimensions, prefer a free-text `SUM(SEARCH('Namespace="…" MetricName="…"', 'Sum'))` over a fixed `{ns,dim,…}` schema. And remember Powertools adds a `Service` dimension from its `service:` argument — it is *not* in your dimensions dict.

## CDK template assertions can't see whether a dashboard query matches runtime metrics

`Template.FromStack(...)` assertions verify the synthesized CloudFormation — they confirmed the dashboard existed and the body contained `NoteTaker/Domain` even while the widget was, at runtime, empty. Template tests validate *the template*, not *that a query returns data*. The empty-widget bug was invisible to them; it was caught by a reviewer reasoning about CloudWatch dimension semantics and decompiling Powertools to confirm the `Service` dimension.

**Rule:** for dashboards/metrics, a green CDK-assertion suite is necessary but not sufficient. The real check is the live metric explorer (CloudWatch → Metrics → the namespace) showing the exact dimension set, and the deployed widget actually plotting. Add an assertion that pins the query *expression* (we assert each domain widget uses `SUM(SEARCH…MetricName…)`), but treat it as a regression guard on the string, not proof the data flows.

## Logs Insights widget: the time-range picker is the "how far back" control

The "All errors" widget is a `LogQueryWidget` with no hard-coded time window — the dashboard's built-in time-range picker scopes it, which is exactly the "see all errors, choose how far back" requirement. The query filters `level in ["Error","Warning"]` (Powertools' casing) with an `@message` regex fallback so it still catches errors even if the structured `level` field shape changes. Don't bake a fixed window into a widget the picker is meant to drive.
