using Microsoft.Extensions.DependencyInjection;

namespace Api.Services;

// Calendar DI. 34-C: provider is no longer bound at startup by CALENDAR_PROVIDER — both clients are
// registered and ICalendarClientFactory.ForAsync(workspaceId) picks per request (Google or Microsoft
// per the workspace's in-app connection, else the legacy CALENDAR_PROVIDER fallback). Handlers
// resolve the client via the factory, never a single bound ICalendarClient.
public static class CalendarClientRegistration
{
    public static void Register(IServiceCollection services)
    {
        // SSM fallbacks (singletons; lazy SSM read needs no AWS creds to register). The store-first
        // token sources delegate to these for an unconnected workspace during coexistence (→ 34-D).
        services.AddSingleton<SsmMicrosoftRefreshTokenSource>();
        // Store-first token sources (scoped — they read ICurrentUser + ICurrentWorkspace), each
        // resolving the per-(user,workspace) in-app token then its SSM fallback.
        services.AddScoped<IGoogleCalendarTokenSource, GoogleCalendarTokenSource>();
        services.AddScoped<IMicrosoftRefreshTokenSource, MicrosoftCalendarTokenSource>();

        // Concrete clients the factory resolves. Google uses the Google SDK (no HttpClient);
        // Microsoft is a typed HttpClient. Stub is forced by STUB_CALENDAR_JSON in the factory.
        services.AddScoped<GoogleCalendarClient>();
        services.AddHttpClient<MicrosoftCalendarClient>(c => c.Timeout = TimeSpan.FromSeconds(10));
        services.AddSingleton<StubCalendarClient>();

        services.AddScoped<ICalendarClientFactory, CalendarClientFactory>();
    }
}
