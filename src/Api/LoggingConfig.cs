namespace Api;

public class LoggingConfig
{
    internal static void AddLogging(WebApplication app)
    {
        app.UseExceptionHandler(exApp => exApp.Run(async ctx =>
        {
            var ex = ctx.Features.Get<Microsoft.AspNetCore.Diagnostics.IExceptionHandlerFeature>()?.Error;
            var log = ctx.RequestServices.GetRequiredService<ILoggerFactory>().CreateLogger("Api");
            log.LogError(ex, "Unhandled exception on {Method} {Path}", ctx.Request.Method, ctx.Request.Path);
            ctx.Response.StatusCode = 500;
            await ctx.Response.WriteAsJsonAsync(new { error = "internal server error" });
        }));
    }
}