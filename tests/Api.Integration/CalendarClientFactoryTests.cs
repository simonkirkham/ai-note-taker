using Api.Auth;
using Api.Services;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;

namespace Api.Integration;

// ICalendarClientFactory resolves the calendar client per workspace from the in-app connection only
// (34-D2 retired the SSM/CALENDAR_PROVIDER fallback). Order: STUB_CALENDAR_JSON wins; else the
// workspace's stored Microsoft token → Microsoft, stored Google token → Google; else Unavailable.
[Collection("CalendarEnv")]
public sealed class CalendarClientFactoryTests
{
    private const string User = "test-user";
    private const string Ws = "ws-1";

    private sealed class StubCurrentUser : ICurrentUser
    {
        public string UserId => User;
        public string Name => "Test";
    }

    private sealed class StubCurrentWorkspace : ICurrentWorkspace
    {
        public string WorkspaceId => Ws;
    }

    private static async Task<ICalendarClient> ResolveAsync(string? stubJson, Action<InMemoryCalendarTokenStore>? seed = null)
    {
        var prevStub = Environment.GetEnvironmentVariable("STUB_CALENDAR_JSON");
        try
        {
            Environment.SetEnvironmentVariable("STUB_CALENDAR_JSON", stubJson);

            var store = new InMemoryCalendarTokenStore();
            seed?.Invoke(store);

            var services = new ServiceCollection();
            services.AddLogging(b => b.AddProvider(NullLoggerProvider.Instance));
            services.AddScoped<ICurrentUser, StubCurrentUser>();
            services.AddScoped<ICurrentWorkspace, StubCurrentWorkspace>();
            services.AddSingleton<ICalendarTokenStore>(store);
            CalendarClientRegistration.Register(services);

            using var sp = services.BuildServiceProvider();
            using var scope = sp.CreateScope();
            var factory = scope.ServiceProvider.GetRequiredService<ICalendarClientFactory>();
            return await factory.ForAsync(Ws);
        }
        finally
        {
            Environment.SetEnvironmentVariable("STUB_CALENDAR_JSON", prevStub);
        }
    }

    [Fact]
    public async Task StubJson_AlwaysWins()
        => Assert.IsType<StubCalendarClient>(await ResolveAsync(stubJson: "[]", seed: s => s.Seed(User, Ws, "microsoft", "rt-ms")));

    [Fact]
    public async Task StoredMicrosoftToken_ResolvesMicrosoft()
        => Assert.IsType<MicrosoftCalendarClient>(
            await ResolveAsync(stubJson: null, seed: s => s.Seed(User, Ws, "microsoft", "rt-ms")));

    [Fact]
    public async Task StoredGoogleToken_ResolvesGoogle()
        => Assert.IsType<GoogleCalendarClient>(
            await ResolveAsync(stubJson: null, seed: s => s.Seed(User, Ws, "google", "rt-g")));

    [Fact]
    public async Task StoredIcsToken_ResolvesIcsFeedClient()
        => Assert.IsType<IcsFeedCalendarClient>(
            await ResolveAsync(stubJson: null, seed: s => s.Seed(User, Ws, "ics", "https://feeds.example.com/cal.ics")));

    [Fact]
    public async Task Unconnected_ResolvesUnavailable()
        // No in-app connection + no SSM/CALENDAR_PROVIDER fallback (34-D2) → calendar_unavailable.
        => Assert.IsType<UnavailableCalendarClient>(await ResolveAsync(stubJson: null));
}
