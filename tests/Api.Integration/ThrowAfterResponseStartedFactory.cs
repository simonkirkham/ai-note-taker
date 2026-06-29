using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace Api.Integration;

// Hosts a sentinel endpoint that flushes the response body (committing status + headers)
// and then throws, exercising LoggingConfig's HasStarted branch — the only path where the
// 500 body cannot be rewritten. Endpoints run at the routing terminal, downstream of the
// AddLogging try/catch middleware, so the throw is caught there.
internal sealed class ThrowAfterResponseStartedFactory(CapturingLoggerProvider captured) : ApiFactory
{
    public const string Path = "/__test__/throw-after-start";

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        base.ConfigureWebHost(builder);
        builder.ConfigureTestServices(services =>
        {
            services.AddSingleton<ILoggerProvider>(captured);
            services.AddSingleton<IStartupFilter, ThrowAfterStartEndpointFilter>();
        });
    }

    private sealed class ThrowAfterStartEndpointFilter : IStartupFilter
    {
        public Action<IApplicationBuilder> Configure(Action<IApplicationBuilder> next) => app =>
        {
            next(app);
            app.UseEndpoints(endpoints => endpoints.MapGet(Path, async (HttpContext ctx) =>
            {
                ctx.Response.ContentType = "text/plain";
                await ctx.Response.Body.WriteAsync("partial"u8.ToArray());
                await ctx.Response.Body.FlushAsync();
                throw new InvalidOperationException("fault after response started");
            }));
        };
    }
}
