using Api.Auth;
using Microsoft.Extensions.Logging;

namespace Api.Services;

// 34-C: resolves the Microsoft refresh token for the current user + workspace, store-first then the
// legacy SSM fallback — the Microsoft mirror of GoogleCalendarTokenSource. The in-app "Connect
// Outlook" flow writes a per-(user,workspace) token to ICalendarTokenStore; this returns it when
// present, else delegates to the global SSM token (Phase 32 coexistence — removed in 34-D).
// forceReload (after Entra invalid_grant) only re-reads SSM; a stored token is always read fresh.
public sealed class MicrosoftCalendarTokenSource(
    ICurrentUser currentUser,
    ICurrentWorkspace currentWorkspace,
    ICalendarTokenStore store,
    SsmMicrosoftRefreshTokenSource ssmFallback,
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
            logger.LogWarning(ex, "Calendar token store read failed; falling back to SSM");
        }

        return await ssmFallback.LoadAsync(forceReload).ConfigureAwait(false);
    }
}
