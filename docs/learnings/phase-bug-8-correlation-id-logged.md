# Learnings: BUG-8 — `x-correlation-id` returned to clients was never logged

- The 12-A correlation ID was only half-wired: the value was written to the response header and the 500 body but never to any **log field**, so a user-quoted ID resolved to zero log lines. The lesson is that "return an ID to the client" and "make that ID greppable in logs" are two separate obligations — a correlation identifier is worthless for support unless *both* halves ship. **Action:** the fix appends it to the logger and the acceptance criteria now explicitly cover the log half — Done.

- **Powertools `BeginScope(dictionary)` only tags the logger instance that opens the scope** — it does *not* propagate to the other `ILogger<T>` instances resolved by the command handler / event store, even from the same factory. Verified by reflection probe: a key set via `BeginScope` on logger A was absent from logger B's output. `Logger.AppendKey(key, value)` is the correct mechanism: it tags *every* Powertools logger instance, and its state is backed by `AsyncLocal<ConcurrentDictionary<>>`, so concurrent requests never leak into each other and `RemoveKeys` in a `finally` cleans up before the next request on a warm Lambda. **Action:** mechanism choice + AsyncLocal rationale recorded in the `UseCorrelationId` comment — Done.

- **To assert on real Powertools JSON output in a test, redirect `Console.Out` — do not try to override `PowertoolsLoggerConfiguration.LogOutput` via `services.Configure<>`.** Powertools snapshots its configuration (including `LogOutput`/`LogFormatter`) when `AddPowertoolsLogger` runs; a later `Configure<PowertoolsLoggerConfiguration>` in `ConfigureTestServices` is silently ignored (verified: capture received 0 lines). Powertools reads `Console.Out` *lazily on each write*, so `Console.SetOut(...)` around the request captures exactly what would reach CloudWatch. An earlier attempt to inject a custom `IConsoleWrapper` also hit a `CS0433` ambiguity because that type is embedded in *both* the Logging and Metrics packages — another reason the console-redirect route is simpler and faithful. **Action:** test captures via `Console.SetOut`; the redirect is process-global so the test lives in a `DisableParallelization` collection — Done.

- Powertools applies its snake_case output casing to appended keys too, so the key `"CorrelationId"` is emitted as the field **`correlation_id`**, consistent with `xray_trace_id` / `command_type` / `stream_id`. The exception handler's message template `{CorrelationId}` does *not* create a duplicate field — it renders only into `message` — so the appended structured field is the single canonical place to query. **Action:** documented; Hawk flagged trimming the now-redundant `CorrelationId=…` message suffix as an optional follow-up (not taken in this PR).

## Applied status

| Learning | Status |
|---|---|
| 1. Returning a correlation ID and logging it are two separate obligations | Applied — acceptance criteria cover the log half |
| 2. Use `Logger.AppendKey` (AsyncLocal, tags all loggers), not `BeginScope`, to tag every line | Applied — `LoggingConfig.UseCorrelationId` |
| 3. Capture Powertools output in tests via `Console.SetOut`; `LogOutput` IOptions override is ignored | Documented — `CorrelationIdLoggingTests` + `DisableParallelization` collection |
| 4. Powertools snake_cases appended keys (`CorrelationId` → `correlation_id`); no duplicate field | Documented — runbook field reference |
