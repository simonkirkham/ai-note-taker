using System.Text.Json;

namespace Api.Auth;

// Exchanges a Microsoft auth code (PKCE, public client — no client_secret) for a refresh token at
// the Entra token endpoint. Scopes mirror MicrosoftCalendarClient (Calendars.Read offline_access)
// plus openid/email so the id_token carries the connected account for the "Connected as …" label.
public sealed class MicrosoftOAuthClient(HttpClient http) : IMicrosoftOAuthClient
{
    private const string Scope = "openid email offline_access https://graph.microsoft.com/Calendars.Read";

    public async Task<MicrosoftTokenResult> ExchangeAuthCodeAsync(string code, string codeVerifier, string redirectUri, CancellationToken ct = default)
    {
        var tenant = Environment.GetEnvironmentVariable("MS_TENANT_ID") is { Length: > 0 } t ? t : "consumers";
        var tokenUrl = $"https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token";
        var form = new Dictionary<string, string>
        {
            ["client_id"] = Environment.GetEnvironmentVariable("MS_CLIENT_ID") ?? "",
            ["grant_type"] = "authorization_code",
            ["code"] = code,
            ["code_verifier"] = codeVerifier,
            ["redirect_uri"] = redirectUri,
            ["scope"] = Scope,
        };

        var response = await http.PostAsync(tokenUrl, new FormUrlEncodedContent(form), ct).ConfigureAwait(false);
        var body = await response.Content.ReadAsStringAsync(ct).ConfigureAwait(false);

        if (!response.IsSuccessStatusCode)
            return new MicrosoftTokenResult(false, (int)response.StatusCode, null);

        using var doc = JsonDocument.Parse(body);
        var refreshToken = doc.RootElement.TryGetProperty("refresh_token", out var rtEl) ? rtEl.GetString() : null;
        var idToken = doc.RootElement.TryGetProperty("id_token", out var idEl) ? idEl.GetString() : null;
        // Entra puts the sign-in name in `preferred_username` (usually the email/UPN); fall back to `email`.
        var email = JwtClaims.TryGetClaim(idToken, "preferred_username") ?? JwtClaims.TryGetClaim(idToken, "email");
        return new MicrosoftTokenResult(true, (int)response.StatusCode, new MicrosoftTokens(refreshToken, email));
    }
}
