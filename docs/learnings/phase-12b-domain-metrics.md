# Learnings — Slice 12-B: Domain metrics (EMF) + event-sourcing log fields

## Instrument at the architectural chokepoint, not per-handler, when appends fan out

The observability skill prescribes "instrument each command handler" for `EventsAppended` and `ConcurrencyConflict`. That model breaks on this codebase: `FolderCommandHandler.DeleteFolder` cascades (N appends across streams in a loop), and `ActionItemCommandHandler` appends from several methods. A per-handler wrapper would either miss appends or need bespoke counting in each handler.

The clean seam is a decorator on `IEventStore` — **every** append flows through `AppendAsync` exactly once, cascades included. The decorator emits `EventsAppended` (count) + a stream/version log line and counts `ConcurrencyConflict`, with zero handler edits. Command-level signals (`CommandHandled`/`CommandFailed`) that genuinely are one-per-command stayed in a helper wrapping each `HandleAsync`.

**Rule:** when a signal corresponds to an operation that fans out (one command → many appends), instrument the shared low-level operation, not the high-level caller. Split instrumentation by where the event *actually happens*, not by the skill's default boundary.

## Know which seams your test harness replaces before deciding where to assert

`ApiFactory` does `RemoveAll<IEventStore>()` + `AddSingleton<IEventStore, InMemoryEventStore>()` — replacing the **decorated** registration entirely. So the `InstrumentedEventStore` decorator is absent from the HTTP integration path: `EventsAppended`/`ConcurrencyConflict` would never fire in those tests. They are covered instead by direct unit tests of the decorator (wrapping a real `InMemoryEventStore`). `CommandHandled`/`CommandFailed` come from the handler, which the HTTP path *does* run, so those are asserted over HTTP via a fake `IDomainMetrics`.

**Rule:** before writing a test that asserts a cross-cutting behaviour, check whether the test harness swaps out the component that produces it. If it does, unit-test that component directly rather than assuming the integration path exercises it.

## `catch (Exception) when (IsDomainViolation(ex))` keeps CommandFailed honest

`CommandFailed` should count domain rule violations, not infrastructure failures. A bare `catch (Exception)` would conflate a DynamoDB outage with a "note already exists" rejection. A filtered catch (`InvalidOperationException` + the `*NotFoundException` types) emits the metric only for domain outcomes and lets everything else propagate to the global 500 handler (logged at `Error`). `ConcurrencyException` is a plain `Exception` (not `InvalidOperationException`), so it is naturally excluded from the filter — and is counted exactly once, by the decorator.

**Corollary:** `CycleDetectedException` derives from `InvalidOperationException`, so listing it in the filter is redundant (Hawk caught this). Don't list a subtype alongside its base in the same `or` pattern.

## `Metrics.PushSingleMetric` suits a host with no Lambda handler method

The Powertools `[Metrics]` decorator and the `AddMetric`/flush lifecycle assume a Lambda handler method to wrap. This app is ASP.NET Core on Lambda — there is no handler method to decorate. `Metrics.PushSingleMetric(...)` emits a self-contained EMF blob per call with its own namespace/dimensions, needing no decorator, no global namespace config, and no flush. It's the right primitive for emitting business metrics from arbitrary points in a web host.

## The registered `IDomainEventDispatcher` is dead code

`IDomainEventDispatcher`/`IDomainEventHandler` are registered in `Builder.cs` and the dispatcher has implementations, but **nothing calls `DispatchAsync`** — projections are updated inline inside each command handler. This is why a uniform `ProjectionUpdateDuration` seam doesn't exist (and why that metric was deferred from 12-B). Worth a future cleanup decision: either route projections through the dispatcher (restoring the documented pattern and giving one timing seam) or delete the unused dispatcher. Flagged as a candidate; not actioned in this slice.
