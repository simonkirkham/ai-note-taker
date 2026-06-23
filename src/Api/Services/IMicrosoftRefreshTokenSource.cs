using Amazon.SimpleSystemsManagement;
using Amazon.SimpleSystemsManagement.Model;
using Microsoft.Extensions.Logging;

namespace Api.Services;

// Loads the Microsoft (Entra) refresh token used to mint Graph access tokens.
// Split out from MicrosoftCalendarClient so the client's invalid_grant heal path
// (reload + retry) is unit-testable with a fake source. See Phase 32-A.
public interface IMicrosoftRefreshTokenSource
{
    // Returns the cached token, or loads it from the backing store. forceReload
    // bypasses the cache (used after Entra rejects the token with invalid_grant,
    // so an operator can heal a running Lambda by re-minting into SSM).
    Task<string?> LoadAsync(bool forceReload);
}

// Default source: the encrypted SSM parameter at MICROSOFT_REFRESH_TOKEN_SSM_PATH.
// Cached for the Lambda process lifetime (registered as a singleton); a force-reload
// re-reads SSM so re-minting heals without a redeploy. Mirrors GoogleCalendarClient's
// own SSM read (the SSM client is created lazily, so resolving this type needs no AWS
// region/credentials until the first real load).
public sealed class SsmMicrosoftRefreshTokenSource : IMicrosoftRefreshTokenSource
{
    private readonly ILogger<SsmMicrosoftRefreshTokenSource> _logger;
    private string? _refreshToken;
    private readonly SemaphoreSlim _initLock = new(1, 1);

    public SsmMicrosoftRefreshTokenSource(ILogger<SsmMicrosoftRefreshTokenSource> logger)
    {
        _logger = logger;
    }

    public async Task<string?> LoadAsync(bool forceReload)
    {
        if (!forceReload && _refreshToken is not null)
            return _refreshToken;

        await _initLock.WaitAsync();
        try
        {
            if (!forceReload && _refreshToken is not null)
                return _refreshToken;

            var ssmPath = Environment.GetEnvironmentVariable("MICROSOFT_REFRESH_TOKEN_SSM_PATH");
            if (string.IsNullOrEmpty(ssmPath))
            {
                _logger.LogWarning(
                    "MICROSOFT_REFRESH_TOKEN_SSM_PATH is not set; Microsoft Calendar integration is disabled and will report calendar_unavailable");
                return null;
            }

            _logger.LogInformation("Loading Microsoft refresh token from SSM path {Path}", ssmPath);

            using var ssm = new AmazonSimpleSystemsManagementClient();
            var response = await ssm.GetParameterAsync(new GetParameterRequest
            {
                Name = ssmPath,
                WithDecryption = true
            });
            _refreshToken = response.Parameter.Value;
            return _refreshToken;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to load Microsoft refresh token from SSM path {Path}",
                Environment.GetEnvironmentVariable("MICROSOFT_REFRESH_TOKEN_SSM_PATH"));
            return null;
        }
        finally
        {
            _initLock.Release();
        }
    }
}
