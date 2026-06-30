using Api.Auth;
using Api.Services;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;

namespace Api.Integration;

// 42-A: proves the load-bearing wiring of the MCP calendar path — that overriding the SCOPED
// CalendarScope (what the MCP tools do) is seen by the interface consumers (the factory + token
// sources), because the concrete CalendarScope and ICalendarScope resolve to the SAME scoped instance.
// The MCP integration test can't cover this (it swaps in a FixedCalendarClientFactory that ignores
// scope); the existing calendar unit tests only exercise the default (no-override) path. This guards
// against an AddScoped→AddTransient slip or injecting ICalendarScope (not the concrete) into the tools.
[Collection("CalendarEnv")]
public sealed class CalendarScopeTests
{
    // The "route" defaults — deliberately DIFFERENT from the override below, so a test that passed by
    // reading the default instead of the override would fail.
    private sealed class StubCurrentUser : ICurrentUser
    {
        public string UserId => "route-user";
        public string Name => "Route";
    }

    private sealed class StubCurrentWorkspace : ICurrentWorkspace
    {
        public string WorkspaceId => "__default__";
    }

    private static ServiceProvider BuildContainer(InMemoryCalendarTokenStore store)
    {
        var services = new ServiceCollection();
        services.AddLogging(b => b.AddProvider(NullLoggerProvider.Instance));
        services.AddScoped<ICurrentUser, StubCurrentUser>();
        services.AddScoped<ICurrentWorkspace, StubCurrentWorkspace>();
        services.AddSingleton<ICalendarTokenStore>(store);
        CalendarClientRegistration.Register(services);
        return services.BuildServiceProvider();
    }

    [Fact]
    public void Override_OnConcrete_IsSeenThroughTheInterface_SameInstance()
    {
        using var sp = BuildContainer(new InMemoryCalendarTokenStore());
        using var scope = sp.CreateScope();

        scope.ServiceProvider.GetRequiredService<CalendarScope>().Set("mcp-user", "mcp-ws");

        var asInterface = scope.ServiceProvider.GetRequiredService<ICalendarScope>();
        Assert.Equal("mcp-user", asInterface.UserId);
        Assert.Equal("mcp-ws", asInterface.WorkspaceId);
    }

    [Fact]
    public void Default_NoOverride_ReadsRouteAndClaims()
    {
        using var sp = BuildContainer(new InMemoryCalendarTokenStore());
        using var scope = sp.CreateScope();

        var s = scope.ServiceProvider.GetRequiredService<ICalendarScope>();
        Assert.Equal("route-user", s.UserId);
        Assert.Equal("__default__", s.WorkspaceId);
    }

    [Fact]
    public async Task FactoryResolvesProviderForTheOverriddenIdentity_NotTheRouteDefault()
    {
        var prevStub = Environment.GetEnvironmentVariable("STUB_CALENDAR_JSON");
        try
        {
            Environment.SetEnvironmentVariable("STUB_CALENDAR_JSON", null);
            // A google token exists ONLY for the override identity, not the route default.
            var store = new InMemoryCalendarTokenStore();
            store.Seed("mcp-user", "mcp-ws", "google", "rt-mcp");

            using var sp = BuildContainer(store);
            using var scope = sp.CreateScope();
            scope.ServiceProvider.GetRequiredService<CalendarScope>().Set("mcp-user", "mcp-ws");

            var factory = scope.ServiceProvider.GetRequiredService<ICalendarClientFactory>();
            // Resolves the override workspace's provider — proving the factory read the overridden scope.
            Assert.IsType<GoogleCalendarClient>(await factory.ForAsync("mcp-ws"));
        }
        finally
        {
            Environment.SetEnvironmentVariable("STUB_CALENDAR_JSON", prevStub);
        }
    }

    [Fact]
    public async Task Factory_RejectsWorkspaceMismatchWithScope()
    {
        var prevStub = Environment.GetEnvironmentVariable("STUB_CALENDAR_JSON");
        try
        {
            Environment.SetEnvironmentVariable("STUB_CALENDAR_JSON", null);
            using var sp = BuildContainer(new InMemoryCalendarTokenStore());
            using var scope = sp.CreateScope();
            scope.ServiceProvider.GetRequiredService<CalendarScope>().Set("mcp-user", "ws-a");

            var factory = scope.ServiceProvider.GetRequiredService<ICalendarClientFactory>();
            // Asking for a different workspace than the scope is a programming error → fail closed.
            await Assert.ThrowsAsync<InvalidOperationException>(() => factory.ForAsync("ws-b"));
        }
        finally
        {
            Environment.SetEnvironmentVariable("STUB_CALENDAR_JSON", prevStub);
        }
    }
}
