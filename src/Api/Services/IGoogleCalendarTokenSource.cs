using Api.Auth;
using Microsoft.Extensions.Logging;

namespace Api.Services;

// Resolves the Google Calendar refresh token for the current user + workspace from the in-app
// connection (CalendarTokenStore), keyed by (user, workspace). 34-D1 removed the legacy SSM fallback
// — Google is now fully in-app — so a workspace with no stored token resolves to null →
// calendar_unavailable + the UI's "Connect calendar". The stored token is read fresh each call (a
// cheap DynamoDB GetItem), so forceReload is a no-op retained only for interface compatibility (the
// old SSM cache it bypassed is gone); an invalid stored token returns unchanged → the client gives
// up and the UI offers "Reconnect".
public interface IGoogleCalendarTokenSource
{
    Task<string?> LoadAsync(bool forceReload, CancellationToken ct = default);
}

public sealed class GoogleCalendarTokenSource(
    ICurrentUser currentUser,
    ICurrentWorkspace currentWorkspace,
    ICalendarTokenStore store,
    ILogger<GoogleCalendarTokenSource> logger) : IGoogleCalendarTokenSource
{
    private const string Provider = "google";

    public async Task<string?> LoadAsync(bool forceReload, CancellationToken ct = default)
    {
        // A transient store failure must degrade to calendar_unavailable (null), never a 500 — the
        // GET handler maps null gracefully but has no catch for a thrown exception. Mirrors
        // MicrosoftCalendarTokenSource.
        try
        {
            var stored = await store.GetAsync(currentUser.UserId, currentWorkspace.WorkspaceId, Provider, ct).ConfigureAwait(false);
            if (stored is not null)
            {
                logger.LogInformation("Google calendar token source: store (in-app connected, workspace {WorkspaceId})", currentWorkspace.WorkspaceId);
                return stored.RefreshToken;
            }
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Calendar token store read failed; reporting calendar_unavailable");
            return null;
        }

        logger.LogInformation("No in-app Google calendar token for workspace {WorkspaceId}; reporting calendar_unavailable", currentWorkspace.WorkspaceId);
        return null;
    }
}
