using Microsoft.Extensions.DependencyInjection;

namespace Api.Services;

// Calendar DI. Both provider clients are registered and ICalendarClientFactory.ForAsync(workspaceId)
// picks per request from the workspace's in-app connection (Google or Microsoft), else
// UnavailableCalendarClient. Since 34-D2 there is no SSM/CALENDAR_PROVIDER fallback — calendars are
// fully in-app. Handlers resolve the client via the factory, never a single bound ICalendarClient.
public static class CalendarClientRegistration
{
    public static void Register(IServiceCollection services)
    {
        // Token sources (scoped — they read ICurrentUser + ICurrentWorkspace): each resolves the
        // per-(user,workspace) in-app token only (no SSM fallback since 34-D1/34-D2).
        services.AddScoped<IGoogleCalendarTokenSource, GoogleCalendarTokenSource>();
        services.AddScoped<IMicrosoftRefreshTokenSource, MicrosoftCalendarTokenSource>();

        // Concrete clients the factory resolves. Google uses the Google SDK (no HttpClient);
        // Microsoft is a typed HttpClient. Stub is forced by STUB_CALENDAR_JSON; Unavailable is the
        // unconnected-workspace client.
        services.AddScoped<GoogleCalendarClient>();
        services.AddHttpClient<MicrosoftCalendarClient>(c => c.Timeout = TimeSpan.FromSeconds(10));
        // 34-E: ICS feed client — typed HttpClient (10s timeout, fetch-per-request), scoped (reads
        // ICurrentUser/ICurrentWorkspace + the token store to resolve the feed URL).
        services.AddHttpClient<IcsFeedCalendarClient>(c => c.Timeout = TimeSpan.FromSeconds(10));
        services.AddSingleton<StubCalendarClient>();
        services.AddSingleton<UnavailableCalendarClient>();

        // 34-E: short-timeout client used by the connect/ics endpoint's one-time validation fetch.
        services.AddHttpClient("ics-validate", c => c.Timeout = TimeSpan.FromSeconds(10));

        services.AddScoped<ICalendarClientFactory, CalendarClientFactory>();
    }
}
