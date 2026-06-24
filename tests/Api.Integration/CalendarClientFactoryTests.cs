using Api.Auth;
using Api.Services;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;

namespace Api.Integration;

// 34-C: ICalendarClientFactory resolves the calendar client per workspace. Order: STUB_CALENDAR_JSON
// wins; else the workspace's in-app connection (Microsoft then Google token in the store); else the
// legacy CALENDAR_PROVIDER fallback (Google default). Env mutation is serialized via the collection.
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

    private static async Task<ICalendarClient> ResolveAsync(
        string? provider, string? stubJson, Action<InMemoryCalendarTokenStore>? seed = null)
    {
        var prevProvider = Environment.GetEnvironmentVariable("CALENDAR_PROVIDER");
        var prevStub = Environment.GetEnvironmentVariable("STUB_CALENDAR_JSON");
        try
        {
            Environment.SetEnvironmentVariable("CALENDAR_PROVIDER", provider);
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
            Environment.SetEnvironmentVariable("CALENDAR_PROVIDER", prevProvider);
            Environment.SetEnvironmentVariable("STUB_CALENDAR_JSON", prevStub);
        }
    }

    [Fact]
    public async Task StubJson_AlwaysWins()
        => Assert.IsType<StubCalendarClient>(await ResolveAsync(provider: "microsoft", stubJson: "[]"));

    [Fact]
    public async Task StoredMicrosoftToken_ResolvesMicrosoft()
        => Assert.IsType<MicrosoftCalendarClient>(
            await ResolveAsync(provider: null, stubJson: null, seed: s => s.Seed(User, Ws, "microsoft", "rt-ms")));

    [Fact]
    public async Task StoredGoogleToken_ResolvesGoogle()
        => Assert.IsType<GoogleCalendarClient>(
            await ResolveAsync(provider: "microsoft", stubJson: null, seed: s => s.Seed(User, Ws, "google", "rt-g")));

    [Fact]
    public async Task Unconnected_FallsBackToCalendarProviderMicrosoft()
        => Assert.IsType<MicrosoftCalendarClient>(await ResolveAsync(provider: "microsoft", stubJson: null));

    [Fact]
    public async Task Unconnected_DefaultsToGoogle()
        => Assert.IsType<GoogleCalendarClient>(await ResolveAsync(provider: null, stubJson: null));

    [Fact]
    public async Task StoredMicrosoft_OverridesCalendarProviderGoogleFallback()
        // The in-app connection is authoritative — a stored MS token wins over CALENDAR_PROVIDER=google.
        => Assert.IsType<MicrosoftCalendarClient>(
            await ResolveAsync(provider: "google", stubJson: null, seed: s => s.Seed(User, Ws, "microsoft", "rt-ms")));
}
