using Api.Auth;

namespace Api.Integration;

public sealed class FakeGoogleOAuthClient : IGoogleOAuthClient
{
    public GoogleTokenResult ExchangeResult { get; set; } = Success("fake-id-token", "fake-refresh-token");
    public GoogleTokenResult RefreshResult { get; set; } = Success("refreshed-id-token", null);
    public string? LastRefreshTokenSeen { get; private set; }

    public void Reset()
    {
        ExchangeResult = Success("fake-id-token", "fake-refresh-token");
        RefreshResult = Success("refreshed-id-token", null);
        LastRefreshTokenSeen = null;
    }

    public Task<GoogleTokenResult> ExchangeAuthCodeAsync(string code, string codeVerifier, string redirectUri, CancellationToken ct = default)
        => Task.FromResult(ExchangeResult);

    public Task<GoogleTokenResult> RefreshAsync(string refreshToken, CancellationToken ct = default)
    {
        LastRefreshTokenSeen = refreshToken;
        return Task.FromResult(RefreshResult);
    }

    public static GoogleTokenResult Success(string? idToken, string? refreshToken)
        => new(true, 200, new GoogleTokens(idToken, refreshToken));

    public static GoogleTokenResult Failure(int statusCode)
        => new(false, statusCode, null);
}
