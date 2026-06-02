# Learnings — Slice 12-A: Structured logging, correlation IDs, log retention

## The observability skill's Powertools version pin is stale — `AddPowertoolsLogger` needs v2+

`.claude/skills/observability/SKILL.md` prescribes `AWS.Lambda.Powertools.Logging` `Version="1.*"` *and* the `builder.Logging.AddPowertoolsLogger(...)` ILogger-provider API. Those are incompatible: v1 used the static `Logger` API and the `[Logging]` handler decorator; the `AddPowertoolsLogger` `ILoggingBuilder` extension only exists from v2 onward. Pinning `1.*` would not compile against the snippet in the same skill. We used `3.2.2` (current major). 

**Rule:** when a skill bundles a version pin *and* an API snippet, trust the API and verify the version against the package feed — don't assume the pin is current.

## A 500-path test must target an endpoint with no try/catch

The first attempt forced an unhandled exception by swapping in a throwing `IEventStore` and calling `POST /notes`. It returned **409, not 500** — `NoteHandlers.CreateNote` catches `InvalidOperationException` and maps it to `Results.Conflict()`. Every command endpoint maps domain/`InvalidOperationException` to a 4xx, so they will *never* surface the global exception handler. `GET /notes` (`ListNotes`) calls `projStore.QueryAllAsync()` with no try/catch, so a throwing `INoteTitleListStore` propagates straight to `UseExceptionHandler`.

**Rule:** to exercise the global 500 handler from an integration test, throw from a read path that has no local catch — not from a command endpoint whose handler maps exceptions to status codes.

## Correlation header on *every* response = first middleware + `Response.OnStarting`

To guarantee `x-correlation-id` on all responses — including 401s short-circuited by auth and 500s written by the exception handler — the middleware must be registered **before** `UseCors`/`UseAuthentication` (Program.cs), and it must add the header inside a `Response.OnStarting` callback rather than after `await next()`. Setting it after `next()` is too late once a downstream component has started the response; registering it after auth misses auth's own short-circuited responses. `OnStarting` fires once just before headers flush, regardless of who writes the body.

## `gh pr merge --delete-branch` fails the local cleanup when main is in another worktree

`gh pr merge 93 --squash --delete-branch` reported `fatal: 'main' is already used by worktree at ...` and appeared to fail — but the **remote merge had already succeeded** (`gh pr view` showed `MERGED`). The error was only `gh` trying to switch the *local* slice checkout back to `main`, which the main worktree already holds. 

**Rule:** in a worktree setup, treat a post-merge `gh` git error as cosmetic — verify `gh pr view <n> --json state`, then delete the remote branch (`git push origin --delete <branch>`) and remove the worktree by hand.

## `TraceIdentifier` is not the X-Ray trace ID

The correlation ID is ASP.NET's per-request `HttpContext.TraceIdentifier` (e.g. `0HN…:00000001`), which is fine for log/response correlation now but is distinct from the X-Ray trace ID. Slice 12-C (tracing) must reconcile the two onto a single shared ID so frontend RUM (12-F), backend logs, and traces all join up. Flagged by Hawk; already noted in the phase doc.
