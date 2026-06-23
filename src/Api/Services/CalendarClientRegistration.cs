using AWS.Lambda.Powertools.Logging;
using Microsoft.Extensions.DependencyInjection;

namespace Api.Services;

// Phase 32-A: binds ICalendarClient to a provider chosen by CALENDAR_PROVIDER
// (google | microsoft; default google). STUB_CALENDAR_JSON (test/local) always wins.
// Keeping all calendar DI here makes provider selection independently testable.
public static class CalendarClientRegistration
{
    public static void Register(IServiceCollection services)
    {
        // Always available; only consumed by the Microsoft client. The SSM read is lazy,
        // so registering this needs no AWS credentials/region.
        services.AddSingleton<IMicrosoftRefreshTokenSource, SsmMicrosoftRefreshTokenSource>();

        if (!string.IsNullOrEmpty(Environment.GetEnvironmentVariable("STUB_CALENDAR_JSON")))
        {
            Logger.LogInformation("Calendar provider bound: {Provider}", "stub");
            services.AddSingleton<ICalendarClient, StubCalendarClient>();
            return;
        }

        var provider = Environment.GetEnvironmentVariable("CALENDAR_PROVIDER");
        if (string.Equals(provider, "microsoft", StringComparison.OrdinalIgnoreCase))
        {
            Logger.LogInformation("Calendar provider bound: {Provider}", "microsoft");
            services.AddHttpClient<ICalendarClient, MicrosoftCalendarClient>(c =>
                c.Timeout = TimeSpan.FromSeconds(10));
            return;
        }

        // Default (incl. an unset/typo'd CALENDAR_PROVIDER) is Google — log the raw value so a
        // misconfigured provider is diagnosable rather than silently falling through.
        Logger.LogInformation(
            "Calendar provider bound: {Provider} (CALENDAR_PROVIDER={Raw})", "google", provider ?? "");
        services.AddSingleton<ICalendarClient, GoogleCalendarClient>();
    }
}
