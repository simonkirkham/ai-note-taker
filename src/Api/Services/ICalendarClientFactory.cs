using Api.Auth;
using AWS.Lambda.Powertools.Logging;
using Microsoft.Extensions.DependencyInjection;

namespace Api.Services;

// 34-C: resolves the calendar client for a workspace per request, replacing the startup-bound
// singleton chosen by CALENDAR_PROVIDER. Resolution order (the in-app connection is authoritative —
// the WorkspaceCalendarConnected event is best-effort, so resolve from the token store, not the
// aggregate; cf. 34-B):
//   1. STUB_CALENDAR_JSON set → the stub (test/local), regardless of workspace.
//   2. A stored Microsoft token for (user, workspace) → Microsoft.
//   3. A stored Google token for (user, workspace) → Google.
//   4. No in-app connection → the legacy global CALENDAR_PROVIDER (its SSM token serves the
//      unconnected default during coexistence). Retained until 34-D removes the SSM path.
// One provider per workspace is enforced at connect time (connecting one deletes the other's
// token), so at most one of steps 2/3 matches.
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

        var provider = await ResolveProviderAsync(workspaceId, ct).ConfigureAwait(false);
        Logger.LogInformation("Calendar client resolved: {Provider} (workspace {WorkspaceId})", provider, workspaceId);
        return provider == "microsoft"
            ? services.GetRequiredService<MicrosoftCalendarClient>()
            : services.GetRequiredService<GoogleCalendarClient>();
    }

    private async Task<string> ResolveProviderAsync(string workspaceId, CancellationToken ct)
    {
        if (await store.GetAsync(currentUser.UserId, workspaceId, "microsoft", ct).ConfigureAwait(false) is not null)
            return "microsoft";
        if (await store.GetAsync(currentUser.UserId, workspaceId, "google", ct).ConfigureAwait(false) is not null)
            return "google";
        // Unconnected workspace → legacy global default (its SSM token serves it during coexistence).
        return string.Equals(Environment.GetEnvironmentVariable("CALENDAR_PROVIDER"), "microsoft", StringComparison.OrdinalIgnoreCase)
            ? "microsoft"
            : "google";
    }
}
