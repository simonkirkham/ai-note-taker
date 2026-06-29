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
//   4. A stored ICS feed URL for (user, workspace) → IcsFeedCalendarClient (34-E).
//   5. No in-app connection → UnavailableCalendarClient (→ calendar_unavailable → "Connect calendar").
// One provider per workspace is enforced at connect time (connecting one deletes the other two
// tokens), so at most one of steps 2/3/4 matches.
public interface ICalendarClientFactory
{
    Task<ICalendarClient> ForAsync(string workspaceId, CancellationToken ct = default);
}

public sealed class CalendarClientFactory(
    ICalendarScope scope,
    ICalendarTokenStore store,
    IServiceProvider services) : ICalendarClientFactory
{
    public async Task<ICalendarClient> ForAsync(string workspaceId, CancellationToken ct = default)
    {
        // The factory selects the provider using `scope.UserId` + this `workspaceId`, but the client it
        // returns loads its token via the token source keyed on `scope.WorkspaceId`. Those must be the
        // same workspace or the factory would check workspace A's token yet the client would load B's.
        // Every caller satisfies this (HTTP passes `currentWorkspace`, with scope defaulting to it; the
        // MCP tool sets scope to the same arg it passes), so a mismatch is a programming error — fail
        // closed rather than resolve a cross-workspace client.
        if (workspaceId != scope.WorkspaceId)
            throw new InvalidOperationException(
                $"Calendar scope workspace '{scope.WorkspaceId}' does not match requested '{workspaceId}'.");

        if (!string.IsNullOrEmpty(Environment.GetEnvironmentVariable("STUB_CALENDAR_JSON")))
            return services.GetRequiredService<StubCalendarClient>();

        if (await store.GetAsync(scope.UserId, workspaceId, "microsoft", ct).ConfigureAwait(false) is not null)
        {
            Logger.LogInformation("Calendar client resolved: microsoft (workspace {WorkspaceId})", workspaceId);
            return services.GetRequiredService<MicrosoftCalendarClient>();
        }
        if (await store.GetAsync(scope.UserId, workspaceId, "google", ct).ConfigureAwait(false) is not null)
        {
            Logger.LogInformation("Calendar client resolved: google (workspace {WorkspaceId})", workspaceId);
            return services.GetRequiredService<GoogleCalendarClient>();
        }
        if (await store.GetAsync(scope.UserId, workspaceId, "ics", ct).ConfigureAwait(false) is not null)
        {
            Logger.LogInformation("Calendar client resolved: ics (workspace {WorkspaceId})", workspaceId);
            return services.GetRequiredService<IcsFeedCalendarClient>();
        }

        Logger.LogInformation("No calendar connected for workspace {WorkspaceId}; reporting calendar_unavailable", workspaceId);
        return services.GetRequiredService<UnavailableCalendarClient>();
    }
}
