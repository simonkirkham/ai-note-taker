using Api.Services;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace Api.Integration;

// Phase 32-A: CALENDAR_PROVIDER selects which ICalendarClient is bound.
// STUB_CALENDAR_JSON (test/local) always wins. Default is Google (Phase 9 behaviour).
public sealed class CalendarProviderSelectionTests
{
    private static ICalendarClient Resolve(string? provider, string? stubJson)
    {
        var prevProvider = Environment.GetEnvironmentVariable("CALENDAR_PROVIDER");
        var prevStub = Environment.GetEnvironmentVariable("STUB_CALENDAR_JSON");
        try
        {
            Environment.SetEnvironmentVariable("CALENDAR_PROVIDER", provider);
            Environment.SetEnvironmentVariable("STUB_CALENDAR_JSON", stubJson);

            var services = new ServiceCollection();
            services.AddLogging(b => b.AddProvider(Microsoft.Extensions.Logging.Abstractions.NullLoggerProvider.Instance));
            CalendarClientRegistration.Register(services);
            using var sp = services.BuildServiceProvider();
            return sp.GetRequiredService<ICalendarClient>();
        }
        finally
        {
            Environment.SetEnvironmentVariable("CALENDAR_PROVIDER", prevProvider);
            Environment.SetEnvironmentVariable("STUB_CALENDAR_JSON", prevStub);
        }
    }

    [Fact]
    public void DefaultProvider_IsGoogle() =>
        Assert.IsType<GoogleCalendarClient>(Resolve(provider: null, stubJson: null));

    [Fact]
    public void ProviderGoogle_BindsGoogleClient() =>
        Assert.IsType<GoogleCalendarClient>(Resolve(provider: "google", stubJson: null));

    [Fact]
    public void ProviderMicrosoft_BindsMicrosoftClient() =>
        Assert.IsType<MicrosoftCalendarClient>(Resolve(provider: "microsoft", stubJson: null));

    [Fact]
    public void ProviderMicrosoft_IsCaseInsensitive() =>
        Assert.IsType<MicrosoftCalendarClient>(Resolve(provider: "Microsoft", stubJson: null));

    [Fact]
    public void StubJson_AlwaysWins_EvenWithMicrosoftProvider() =>
        Assert.IsType<StubGoogleCalendarClient>(
            Resolve(provider: "microsoft", stubJson: """[]"""));
}
