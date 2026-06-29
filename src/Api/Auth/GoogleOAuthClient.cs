using System.Text.Json;

namespace Api.Auth;

public sealed class GoogleOAuthClient(HttpClient http) : IGoogleOAuthClient
{
    private const string TokenUrl = "https://oauth2.googleapis.com/token";

    public Task<GoogleTokenResult> ExchangeAuthCodeAsync(string code, string codeVerifier, string redirectUri, CancellationToken ct = default)
        => PostAsync(new Dictionary<string, string>
        {
            ["code"] = code,
            ["code_verifier"] = codeVerifier,
            ["redirect_uri"] = redirectUri,
            ["grant_type"] = "authorization_code",
        }, ct);

    public Task<GoogleTokenResult> RefreshAsync(string refreshToken, CancellationToken ct = default)
        => PostAsync(new Dictionary<string, string>
        {
            ["refresh_token"] = refreshToken,
            ["grant_type"] = "refresh_token",
        }, ct);

    private async Task<GoogleTokenResult> PostAsync(Dictionary<string, string> form, CancellationToken ct)
    {
        form["client_id"] = Environment.GetEnvironmentVariable("GOOGLE_CLIENT_ID") ?? "";
        form["client_secret"] = Environment.GetEnvironmentVariable("GOOGLE_CLIENT_SECRET") ?? "";

        var response = await http.PostAsync(TokenUrl, new FormUrlEncodedContent(form), ct);
        var body = await response.Content.ReadAsStringAsync(ct);

        if (!response.IsSuccessStatusCode)
            return new GoogleTokenResult(false, (int)response.StatusCode, null);

        using var doc = JsonDocument.Parse(body);
        var idToken = doc.RootElement.TryGetProperty("id_token", out var idEl) ? idEl.GetString() : null;
        var refreshToken = doc.RootElement.TryGetProperty("refresh_token", out var rtEl) ? rtEl.GetString() : null;
        return new GoogleTokenResult(true, (int)response.StatusCode, new GoogleTokens(idToken, refreshToken));
    }
}
