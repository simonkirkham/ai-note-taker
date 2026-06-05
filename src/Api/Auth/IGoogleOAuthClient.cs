namespace Api.Auth;

public sealed record GoogleTokens(string? IdToken, string? RefreshToken);

public sealed record GoogleTokenResult(bool Success, int StatusCode, GoogleTokens? Tokens);

public interface IGoogleOAuthClient
{
    Task<GoogleTokenResult> ExchangeAuthCodeAsync(string code, string codeVerifier, string redirectUri, CancellationToken ct = default);

    Task<GoogleTokenResult> RefreshAsync(string refreshToken, CancellationToken ct = default);
}
