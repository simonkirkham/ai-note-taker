using Api.Exceptions;
using AWS.Lambda.Powertools.Logging;
using Domain.Workspaces;
using EventStore;

namespace Api;

public static class LoggingConfig
{
    public const string CorrelationIdHeader = "x-correlation-id";
    public const string TraceIdHeader = "x-amzn-trace-id";

    // Appended to the Powertools logger for the request scope so every log line carries
    // the same value returned in the x-correlation-id header. Powertools emits it as the
    // snake_case field "correlation_id" (matching xray_trace_id, command_type, etc.).
    private const string CorrelationIdLogKey = "CorrelationId";

    // Stamps every response with the request's correlation ID and the X-Ray trace
    // ID. Registered as the first middleware so even short-circuited responses
    // (e.g. 401 from auth) carry the headers. OnStarting runs just before headers
    // are sent, which is the only safe point to add a header regardless of who
    // writes the response. The trace ID echoes the inbound X-Amzn-Trace-Id set by
    // API Gateway/Lambda so a browser error (12-F RUM) links to its backend trace;
    // off Lambda it falls back to the request identifier so the header is always present.
    //
    // The same correlation ID is appended to the Powertools logger so every log line for
    // the request carries it as "correlation_id" — without this the value handed to the
    // client could not be found in CloudWatch (BUG-8). AppendKey is AsyncLocal-scoped, so
    // concurrent requests never see each other's key; RemoveKeys clears it once the
    // request unwinds so the value never leaks to a later request on a warm Lambda.
    internal static void UseCorrelationId(WebApplication app)
    {
        app.Use(async (ctx, next) =>
        {
            ctx.Response.OnStarting(() =>
            {
                ctx.Response.Headers[CorrelationIdHeader] = ctx.TraceIdentifier;
                var inboundTrace = ctx.Request.Headers[TraceIdHeader].ToString();
                ctx.Response.Headers[TraceIdHeader] =
                    string.IsNullOrEmpty(inboundTrace) ? ctx.TraceIdentifier : inboundTrace;
                return Task.CompletedTask;
            });

            Logger.AppendKey(CorrelationIdLogKey, ctx.TraceIdentifier);
            try
            {
                await next();
            }
            finally
            {
                Logger.RemoveKeys(CorrelationIdLogKey);
            }
        });
    }

    // TI-38: catch and map exceptions here rather than via ASP.NET's UseExceptionHandler.
    // That built-in registers ExceptionHandlerMiddleware, which logs EVERY escaped exception
    // at Error ("An unhandled exception has occurred…", category
    // Microsoft.AspNetCore.Diagnostics.ExceptionHandlerMiddleware) BEFORE invoking our
    // handler — so an exception we then re-mapped to 409/404 double-logged: once at Error
    // (framework) and once at Warning (ours), drowning real 500s on the ops dashboard.
    // Owning the try/catch keeps the framework middleware out of the pipeline entirely, so
    // each request logs exactly one line at the level Map() implies. The response contract
    // (status, JSON body shape, and the x-correlation-id header) is unchanged.
    internal static void AddLogging(WebApplication app)
    {
        app.Use(async (ctx, next) =>
        {
            try
            {
                await next();
            }
            catch (Exception ex)
            {
                await WriteMappedResponseAsync(ctx, ex);
            }
        });
    }

    private static async Task WriteMappedResponseAsync(HttpContext ctx, Exception ex)
    {
        var log = ctx.RequestServices.GetRequiredService<ILoggerFactory>().CreateLogger("Api");
        // RequestAborted tells Map() a bare OperationCanceledException apart: cancelled because
        // the CLIENT went away (genuine abort, not our fault → no 503) vs. an SDK per-op timeout
        // that cancelled with its own token (transient → 503). A TimeoutException is always the
        // latter. See Map() and BoundedWrites.IsTransient for the same distinction on the retry side.
        var (status, error) = Map(ex, ctx.RequestAborted.IsCancellationRequested);

        // Only a genuine 500 is a server fault worth an Error-level line on the ops
        // dashboard; an expected conflict/not-found — and a transient 503 (BUG-23): a
        // recoverable timeout the caller can retry, not a code fault — is logged at Warning
        // so it does not drown out real errors.
        if (status == StatusCodes.Status500InternalServerError)
            log.LogError(ex, "Unhandled exception on {Method} {Path} CorrelationId={CorrelationId}",
                ctx.Request.Method, ctx.Request.Path, ctx.TraceIdentifier);
        else
            log.LogWarning("Request failed {Method} {Path} -> {Status} {ExceptionType} CorrelationId={CorrelationId}",
                ctx.Request.Method, ctx.Request.Path, status, ex.GetType().Name, ctx.TraceIdentifier);

        // If the response has already begun streaming, headers/status are committed and the
        // body cannot be rewritten — log only and let the connection fault.
        if (ctx.Response.HasStarted)
            return;

        ctx.Response.Clear();
        ctx.Response.StatusCode = status;
        ctx.Response.Headers[CorrelationIdHeader] = ctx.TraceIdentifier;
        await ctx.Response.WriteAsJsonAsync(new { error, correlationId = ctx.TraceIdentifier });
    }

    // Maps domain/store exceptions that escape a handler to a meaningful status, so a
    // concurrency conflict or a write to a vanished note never surfaces as a 500. This
    // is the cross-cutting backstop: endpoints that already catch and translate (e.g.
    // NoteNotFoundException -> 404) win before reaching here; anything they miss is
    // mapped uniformly rather than re-mapped per-route.
    private static (int Status, string Error) Map(Exception? ex, bool requestAborted = false) => ex switch
    {
        ConcurrencyException => (StatusCodes.Status409Conflict, "conflict"),
        RebuildInProgressException => (StatusCodes.Status409Conflict, "rebuild in progress"),
        DefaultWorkspaceUndeletableException => (StatusCodes.Status409Conflict, "default workspace cannot be deleted"),
        WorkspaceNotEmptyException => (StatusCodes.Status409Conflict, "workspace not empty"),
        NoteNotFoundException or ActionItemNotFoundException or FolderNotFoundException or WorkspaceNotFoundException
            => (StatusCodes.Status404NotFound, "not found"),
        // BUG-23: a transient DynamoDB timeout that survives the rebuild's bounded retry (e.g. the
        // request nears the Lambda/API-Gateway 29 s budget) is recoverable — surface 503 "retry",
        // not an unhandled 500. A TimeoutException is always transient (the SDK cancels with its OWN
        // token). A bare OperationCanceledException is 503 ONLY when the request was NOT aborted by
        // the client; a genuine client abort falls through to 500 (the client is gone, so the body
        // is moot — we just log it).
        TimeoutException => (StatusCodes.Status503ServiceUnavailable, "timed out, retry"),
        OperationCanceledException when !requestAborted
            => (StatusCodes.Status503ServiceUnavailable, "timed out, retry"),
        _ => (StatusCodes.Status500InternalServerError, "internal server error"),
    };
}
