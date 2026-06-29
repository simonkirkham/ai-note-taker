using Api.Auth;
using Microsoft.Extensions.Logging;

namespace Api.Services;

// Resolves the Microsoft refresh token for the current user + workspace from the in-app connection
// (CalendarTokenStore, keyed by (user, workspace)) — the Microsoft mirror of GoogleCalendarTokenSource.
// 34-D2 removed the legacy SSM fallback: Outlook is fully in-app, so a workspace with no stored token
// resolves to null → calendar_unavailable. forceReload is a no-op retained for interface
// compatibility (the stored token is read fresh each call). A store failure degrades to null, never
// a 500 (the GET handler maps null gracefully but has no catch).
public sealed class MicrosoftCalendarTokenSource(
    ICurrentUser currentUser,
    ICurrentWorkspace currentWorkspace,
    ICalendarTokenStore store,
    ILogger<MicrosoftCalendarTokenSource> logger) : IMicrosoftRefreshTokenSource
{
    private const string Provider = "microsoft";

    public async Task<string?> LoadAsync(bool forceReload)
    {
        try
        {
            var stored = await store.GetAsync(currentUser.UserId, currentWorkspace.WorkspaceId, Provider).ConfigureAwait(false);
            if (stored is not null)
            {
                logger.LogInformation("Microsoft calendar token source: store (in-app connected, workspace {WorkspaceId})", currentWorkspace.WorkspaceId);
                return stored.RefreshToken;
            }
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Calendar token store read failed; reporting calendar_unavailable");
            return null;
        }

        logger.LogInformation("No in-app Microsoft calendar token for workspace {WorkspaceId}; reporting calendar_unavailable", currentWorkspace.WorkspaceId);
        return null;
    }
}
