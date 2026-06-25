using Api.Auth;
using AWS.Lambda.Powertools.Logging;
using Microsoft.Extensions.DependencyInjection;

namespace Api.Services;

// Resolves the calendar client for a workspace per request from the workspace's in-app connection —
// the only source since 34-D2 retired the SSM/CALENDAR_PROVIDER fallback. The connection is
// authoritative via the token store (the WorkspaceCalendarConnected event is best-effort; cf. 34-B).
// Resolution order:
//   1. STUB_CALENDAR_JSON set → the stub (test/local), regardless of workspace.
//   2. A stored Microsoft token for (user, workspace) → Microsoft.
//   3. A stored Google token for (user, workspace) → Google.
//   4. No in-app connection → UnavailableCalendarClient (→ calendar_unavailable → "Connect calendar").
// One provider per workspace is enforced at connect time (connecting one deletes the other's token),
// so at most one of steps 2/3 matches.
public interface ICalendarClientFactory
{
    Task<ICalendarClient> ForAsync(string workspaceId, CancellationToken ct = default);
}

public sealed class CalendarClientFactory(
    ICurrentUser currentUser,
    ICalendarTokenStore store,
    IServiceProvider services) : ICalendarClientFactory
{
    public async Task<ICalendarClient> ForAsync(string workspaceId, CancellationToken ct = default)
    {
        if (!string.IsNullOrEmpty(Environment.GetEnvironmentVariable("STUB_CALENDAR_JSON")))
            return services.GetRequiredService<StubCalendarClient>();

        if (await store.GetAsync(currentUser.UserId, workspaceId, "microsoft", ct).ConfigureAwait(false) is not null)
        {
            Logger.LogInformation("Calendar client resolved: microsoft (workspace {WorkspaceId})", workspaceId);
            return services.GetRequiredService<MicrosoftCalendarClient>();
        }
        if (await store.GetAsync(currentUser.UserId, workspaceId, "google", ct).ConfigureAwait(false) is not null)
        {
            Logger.LogInformation("Calendar client resolved: google (workspace {WorkspaceId})", workspaceId);
            return services.GetRequiredService<GoogleCalendarClient>();
        }

        Logger.LogInformation("No calendar connected for workspace {WorkspaceId}; reporting calendar_unavailable", workspaceId);
        return services.GetRequiredService<UnavailableCalendarClient>();
    }
}
