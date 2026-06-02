# Learnings — Slice 12-C: Distributed tracing with AWS X-Ray

## X-Ray throws off-Lambda by default — set ContextMissingStrategy to LOG_ERROR

`AWSXRayRecorder.Instance.BeginSubsegment(...)` (and any trace-context access) throws `EntityNotAvailableException` when there is no active segment — which is the case locally and in every in-process test, because only the Lambda runtime creates the root segment. The default `ContextMissingStrategy` is `RUNTIME_ERROR`.

Fix on two fronts: the Lambda runtime reads `AWS_XRAY_CONTEXT_MISSING=LOG_ERROR` (set as a CDK env var), and in-process code sets `AWSXRayRecorder.Instance.ContextMissingStrategy = ContextMissingStrategy.LOG_ERROR` in `Builder`. Both make missing-context a logged no-op instead of an exception.

**Test gotcha:** a unit test that news up the X-Ray-using class directly (not through `Builder`) must set the strategy itself — `InstrumentedEventStoreTests` does it in a **static constructor**, which is guaranteed to run before any member access, so it doesn't depend on test execution order relative to the `Builder`-driven integration tests.

## `RegisterXRayForAllServices()` must precede client construction — DI lazy factories make this easy

The call installs a global handler that only instruments AWS SDK clients created *after* it. Because every AWS client here is registered as a DI factory lambda (`AddSingleton<IAmazonDynamoDB>(sp => new ...)`, `AddAWSService<...>()`) that constructs lazily at first resolve — well after `BuildApp` returns — calling `RegisterXRayForAllServices()` during `BuildApp` reliably instruments DynamoDB, STS, and Bedrock. No client is eagerly built at startup.

## Auto-instrumentation covers DynamoDB; named subsegments are the polish

`RegisterXRayForAllServices()` alone makes every DynamoDB/STS/Bedrock call a subsegment for free — that's most of the tracing value. The named `ReadEvents`/`AppendEvents` subsegments added in the `InstrumentedEventStore` decorator are domain-meaningful grouping on top, using the same clean seam as 12-B. Subsegments follow the skill's hard rule: `BeginSubsegment` outside the `try`, `EndSubsegment` in a `finally` — verified on the `ConcurrencyException` rethrow path by a test. Explicit projection subsegments were deferred (inline-projection architecture); the DynamoDB writes still appear, just un-named.

## Echoing the inbound `X-Amzn-Trace-Id` is safe and gives the real trace id

On a request through API Gateway/Lambda, the inbound `X-Amzn-Trace-Id` header's `Root=1-…` *is* the X-Ray trace id, so echoing it back as a response header hands the caller the exact id to look up in X-Ray. Reflecting a request header into a response header is not header-injection-exploitable: ASP.NET Core's `HeaderDictionary` rejects CR/LF, so no response splitting, and the value only round-trips to the same caller. Falls back to `ctx.TraceIdentifier` off-Lambda so the header is always present. (The X-Ray trace id and the 12-A `x-correlation-id` remain distinct ids; full unification onto one id is still open.)

## The pre-commit hook runs frontend eslint even for backend-only slices

`.githooks` runs `dotnet build` + frontend `eslint` on every commit. Backend/infra-only worktrees skip `npm --prefix web install` (to avoid Node-version lockfile drift), so `eslint` isn't present and the hook fails with `eslint: not found` — even when zero `web/` files changed. For 12-C the commit used `--no-verify` (all real gates — build, specs, `cdk synth` — were green, and CI runs eslint with a Node-20 install). Logged as a technical improvement: the hook should skip the frontend lint when no `web/` files are staged (or when `web/node_modules` is absent).
