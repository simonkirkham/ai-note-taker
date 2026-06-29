# Debugging with AWS X-Ray

The API Lambda runs with **X-Ray active tracing** (added in slice 12-C). Every sampled
request becomes a trace: the Lambda invocation, the AWS SDK calls it makes (DynamoDB, STS,
Bedrock — auto-instrumented), and named `ReadEvents` / `AppendEvents` subsegments around the
event store. This guide explains how to use those traces to answer *"is it healthy?"*,
*"what broke?"*, and *"why is it slow?"*.

Region is **eu-west-2** in the prod account; CLI examples assume `--profile prod --region eu-west-2`.

## Before you start — two things to know

- **Tracing is sampled.** X-Ray does not record every request. If you're hunting one specific
  request and don't see it, make a few more and/or widen the time range. (Faults aren't
  guaranteed to be sampled unless a sampling rule targets them.)
- **The browser isn't traced yet.** This is backend-only. Frontend errors and their link to
  backend traces arrive with CloudWatch RUM (slice 12-F). Until then, X-Ray shows only what
  happens inside the Lambda and downstream AWS calls.

## 1. Get to the traces

CloudWatch console → **X-Ray traces** (or the **Service map**), region eu-west-2.

The **service map** draws the system as nodes — the `notetaker-api` Lambda and its downstream
DynamoDB tables — annotated with latency, request rate, and error/fault percentage. A red or
orange node is where to look first; click it, then "View traces".

## 2. Find the specific request

Every API response carries two headers:

| Header | What it is | Use |
|--------|-----------|-----|
| `x-amzn-trace-id` | The real X-Ray trace id on a request through API Gateway (`Root=1-…`) | Paste the `1-…` part into X-Ray traces search to open that exact trace |
| `x-correlation-id` | The per-request id (ASP.NET `TraceIdentifier`) | Ties the trace to the structured logs (see §4) |

So when a user reports an error: in browser DevTools → Network → the failing request →
Response Headers, grab both values, then look the trace up by its `Root` id.

No specific id? Use a **filter expression** in the X-Ray console:

```
service("notetaker-api") AND fault = true        # 5xx / unhandled exceptions
service("notetaker-api") AND responsetime > 2      # slow requests (> 2s)
service("notetaker-api") AND http.status = 409      # e.g. concurrency conflicts
```

## 3. Read the trace (the waterfall)

A trace is a timeline of nested segments. For this app you'll typically see:

- the Lambda **invocation** — and, on a cold start, the SnapStart **Restore** time broken out
  separately (handy for confirming SnapStart is doing its job);
- the named **`ReadEvents`** / **`AppendEvents`** subsegments from the event-store decorator;
- the **DynamoDB** calls nested beneath them (auto-instrumented), each with its own duration
  and error flag.

This tells you *where* the time or failure is. "Request took 1.8s and 1.5s of it was a single
`AppendEvents` → DynamoDB `TransactWriteItems`" points at DynamoDB, not your code. A red
subsegment names exactly which downstream call faulted.

## 4. Cross over to the logs for the *why*

X-Ray tells you *where*; the structured logs (slice 12-A/12-B) tell you *why*. Take the
`x-correlation-id` and run it in **CloudWatch Logs Insights** against the API log group:

```
fields @timestamp, @message
| filter @message like /<correlation-id>/
| sort @timestamp asc
```

You'll see that request's `Command received …`, `Events appended … Version=…`, and any
`Concurrency conflict …` / `Command failed …` lines, alongside the trace's timing.

## 5. From the terminal

```bash
# recent faulting traces in the last 30 minutes
aws xray get-trace-summaries --profile prod --region eu-west-2 \
  --start-time $(date -d '30 min ago' +%s) --end-time $(date +%s) \
  --filter-expression 'service("notetaker-api") AND fault = true'

# full detail for one trace id
aws xray batch-get-traces --profile prod --region eu-west-2 --trace-ids 1-<...>
```

## Typical debugging moments

| Symptom | Where to look |
|---------|---------------|
| "It's slow" | Service map / `responsetime` filter → which subsegment dominates (your code vs DynamoDB vs Bedrock) |
| "It 500'd" | `fault = true` → the red subsegment names the failing downstream; `x-correlation-id` → the exception log line |
| "Cold starts?" | The SnapStart **Restore** segment in the trace timeline |
| "Is DynamoDB throttling?" | The DynamoDB subsegments show throttle/error flags and latency |

## Known limits (today)

- **Sampling** — a one-off request may not be captured; repeat it or widen the window.
- **Projection writes are un-named** — explicit projection-update subsegments were deferred
  (the projection code path is inline and structurally varied), so projection DynamoDB writes
  appear as raw SDK subsegments rather than a named `UpdateProjection` span.
- **No frontend traces** until CloudWatch RUM (slice 12-F).
- **Correlation id ≠ trace id** — `x-correlation-id` is the ASP.NET request id; `x-amzn-trace-id`
  is the X-Ray trace id. They're emitted as separate headers; unifying them onto one id is a
  possible future enhancement.

## Related

- The `notetaker-ops` CloudWatch dashboard (slice 12-D) surfaces Lambda latency/error rates and
  the domain metrics without hunting — start there for the overview, come here to drill in.
- Structured logging and correlation ids: slice 12-A. Domain metrics and the stream/version log
  lines: slice 12-B.
