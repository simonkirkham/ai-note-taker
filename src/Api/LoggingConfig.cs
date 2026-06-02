namespace Api;

public static class LoggingConfig
{
    public const string CorrelationIdHeader = "x-correlation-id";

    // Stamps every response with the request's correlation ID. Registered as the
    // first middleware so even short-circuited responses (e.g. 401 from auth)
    // carry the header. OnStarting runs just before headers are sent, which is
    // the only safe point to add a header regardless of who writes the response.
    internal static void UseCorrelationId(WebApplication app)
    {
        app.Use(async (ctx, next) =>
        {
            ctx.Response.OnStarting(() =>
            {
                ctx.Response.Headers[CorrelationIdHeader] = ctx.TraceIdentifier;
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
            log.LogError(ex, "Unhandled exception on {Method} {Path} CorrelationId={CorrelationId}",
                ctx.Request.Method, ctx.Request.Path, ctx.TraceIdentifier);
            ctx.Response.StatusCode = 500;
            ctx.Response.Headers[CorrelationIdHeader] = ctx.TraceIdentifier;
            await ctx.Response.WriteAsJsonAsync(new { error = "internal server error", correlationId = ctx.TraceIdentifier });
        }));
    }
}
