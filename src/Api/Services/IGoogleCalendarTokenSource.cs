using Amazon.SimpleSystemsManagement;
using Amazon.SimpleSystemsManagement.Model;
using Api.Auth;
using Microsoft.Extensions.Logging;

namespace Api.Services;

// Resolves the Google Calendar refresh token for the current user, store-first then SSM-fallback.
// Phase 34-A: the in-app "Connect calendar" flow writes a per-user token to ICalendarTokenStore;
// this returns it when present, else the out-of-band SSM token (Phase 9 coexistence — removed in
// 34-D). Mirrors IMicrosoftRefreshTokenSource. forceReload (after invalid_grant) only re-reads SSM;
// a stored token is always read fresh, so an invalid stored token returns unchanged → the client
// gives up and the UI offers "Reconnect".
public interface IGoogleCalendarTokenSource
{
    Task<string?> LoadAsync(bool forceReload, CancellationToken ct = default);
}

public sealed class GoogleCalendarTokenSource(
    ICurrentUser currentUser,
    ICalendarTokenStore store,
    ILogger<GoogleCalendarTokenSource> logger) : IGoogleCalendarTokenSource
{
    private const string Provider = "google";

    // SSM fallback is cached for the process lifetime (forceReload bypasses it); the per-user
    // stored token is read fresh each call (a cheap DynamoDB GetItem).
    private static string? _ssmToken;
    private static readonly SemaphoreSlim _ssmLock = new(1, 1);

    public async Task<string?> LoadAsync(bool forceReload, CancellationToken ct = default)
    {
        try
        {
            var stored = await store.GetAsync(currentUser.UserId, Provider, ct).ConfigureAwait(false);
            if (stored is not null)
            {
                logger.LogInformation("Google calendar token source: store (in-app connected)");
                return stored.RefreshToken;
            }
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Calendar token store read failed; falling back to SSM");
        }

        return await LoadFromSsmAsync(forceReload, ct).ConfigureAwait(false);
    }

    private async Task<string?> LoadFromSsmAsync(bool forceReload, CancellationToken ct)
    {
        if (!forceReload && _ssmToken is not null)
            return _ssmToken;

        await _ssmLock.WaitAsync(ct).ConfigureAwait(false);
        try
        {
            if (!forceReload && _ssmToken is not null)
                return _ssmToken;

            var ssmPath = Environment.GetEnvironmentVariable("GOOGLE_REFRESH_TOKEN_SSM_PATH");
            if (string.IsNullOrEmpty(ssmPath))
            {
                logger.LogWarning(
                    "No in-app Google calendar token for this user and GOOGLE_REFRESH_TOKEN_SSM_PATH is unset; reporting calendar_unavailable");
                return null;
            }

            logger.LogInformation("Google calendar token source: SSM fallback ({Path})", ssmPath);

            using var ssm = new AmazonSimpleSystemsManagementClient();
            var response = await ssm.GetParameterAsync(new GetParameterRequest
            {
                Name = ssmPath,
                WithDecryption = true
            }, ct).ConfigureAwait(false);
            _ssmToken = response.Parameter.Value;
            return _ssmToken;
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to load Google refresh token from SSM");
            return null;
        }
        finally
        {
            _ssmLock.Release();
        }
    }
}
