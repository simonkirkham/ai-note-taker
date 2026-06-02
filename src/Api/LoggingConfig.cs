using Api.Exceptions;
using EventStore;

namespace Api;

public static class LoggingConfig
{
    public const string CorrelationIdHeader = "x-correlation-id";
    public const string TraceIdHeader = "x-amzn-trace-id";

    // Stamps every response with the request's correlation ID and the X-Ray trace
    // ID. Registered as the first middleware so even short-circuited responses
    // (e.g. 401 from auth) carry the headers. OnStarting runs just before headers
    // are sent, which is the only safe point to add a header regardless of who
    // writes the response. The trace ID echoes the inbound X-Amzn-Trace-Id set by
    // API Gateway/Lambda so a browser error (12-F RUM) links to its backend trace;
    // off Lambda it falls back to the request identifier so the header is always present.
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
            await next();
        });
    }

    internal static void AddLogging(WebApplication app)
    {
        app.UseExceptionHandler(exApp => exApp.Run(async ctx =>
        {
            var ex = ctx.Features.Get<Microsoft.AspNetCore.Diagnostics.IExceptionHandlerFeature>()?.Error;
            var log = ctx.RequestServices.GetRequiredService<ILoggerFactory>().CreateLogger("Api");
            var (status, error) = Map(ex);

            // Only a genuine 500 is a server fault worth an Error-level line on the ops
            // dashboard; an expected conflict/not-found is logged at Warning so it does
            // not drown out real errors.
            if (status == StatusCodes.Status500InternalServerError)
                log.LogError(ex, "Unhandled exception on {Method} {Path} CorrelationId={CorrelationId}",
                    ctx.Request.Method, ctx.Request.Path, ctx.TraceIdentifier);
            else
                log.LogWarning("Request failed {Method} {Path} -> {Status} {ExceptionType} CorrelationId={CorrelationId}",
                    ctx.Request.Method, ctx.Request.Path, status, ex?.GetType().Name, ctx.TraceIdentifier);

            ctx.Response.StatusCode = status;
            ctx.Response.Headers[CorrelationIdHeader] = ctx.TraceIdentifier;
            await ctx.Response.WriteAsJsonAsync(new { error, correlationId = ctx.TraceIdentifier });
        }));
    }

    // Maps domain/store exceptions that escape a handler to a meaningful status, so a
    // concurrency conflict or a write to a vanished note never surfaces as a 500. This
    // is the single cross-cutting mapping point — endpoints must not re-map per-route.
    private static (int Status, string Error) Map(Exception? ex) => ex switch
    {
        ConcurrencyException => (StatusCodes.Status409Conflict, "conflict"),
        NoteNotFoundException or ActionItemNotFoundException or FolderNotFoundException
            => (StatusCodes.Status404NotFound, "not found"),
        _ => (StatusCodes.Status500InternalServerError, "internal server error"),
    };
}
