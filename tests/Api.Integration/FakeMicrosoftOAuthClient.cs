using Api.Auth;

namespace Api.Integration;

public sealed class FakeMicrosoftOAuthClient : IMicrosoftOAuthClient
{
    public MicrosoftTokenResult ExchangeResult { get; set; } = Success("ms-refresh-token", "owner@outlook.com");

    public void Reset() => ExchangeResult = Success("ms-refresh-token", "owner@outlook.com");

    public Task<MicrosoftTokenResult> ExchangeAuthCodeAsync(string code, string codeVerifier, string redirectUri, CancellationToken ct = default)
        => Task.FromResult(ExchangeResult);

    public static MicrosoftTokenResult Success(string? refreshToken, string? email)
        => new(true, 200, new MicrosoftTokens(refreshToken, email));

    public static MicrosoftTokenResult Failure(int statusCode)
        => new(false, statusCode, null);
}
