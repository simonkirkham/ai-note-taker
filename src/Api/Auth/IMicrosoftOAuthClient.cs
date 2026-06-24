namespace Api.Auth;

public sealed record MicrosoftTokens(string? RefreshToken, string? Email);

public sealed record MicrosoftTokenResult(bool Success, int StatusCode, MicrosoftTokens? Tokens);

// In-app Microsoft (Entra) OAuth — auth-code + PKCE exchanged server-side for the calendar
// connect (34-C), mirroring IGoogleOAuthClient. Public client (no secret), same tenant default as
// MicrosoftCalendarClient ("consumers" unless MS_TENANT_ID is set).
public interface IMicrosoftOAuthClient
{
    Task<MicrosoftTokenResult> ExchangeAuthCodeAsync(string code, string codeVerifier, string redirectUri, CancellationToken ct = default);
}
