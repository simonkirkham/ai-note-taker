using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;

namespace Api.Integration;

[Collection("AuthEnv")]
public sealed class AuthTokenExchangeTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private readonly HttpClient _client = factory.CreateClient();

    [Fact]
    public async Task PostAuthToken_MissingCode_Returns400()
    {
        var body = new { code = "", codeVerifier = "verifier", redirectUri = "https://example.com" };
        var response = await _client.PostAsJsonAsync("/auth/token", body);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task PostAuthToken_MissingCodeVerifier_Returns400()
    {
        var body = new { code = "some-code", codeVerifier = "", redirectUri = "https://example.com" };
        var response = await _client.PostAsJsonAsync("/auth/token", body);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task PostAuthToken_MissingRedirectUri_Returns400()
    {
        var body = new { code = "some-code", codeVerifier = "verifier", redirectUri = "" };
        var response = await _client.PostAsJsonAsync("/auth/token", body);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task PostAuthToken_Success_SetsHttpOnlyRefreshCookie()
    {
        var fake = factory.Services.GetRequiredService<FakeGoogleOAuthClient>();
        fake.Reset();
        fake.ExchangeResult = FakeGoogleOAuthClient.Success("an-id-token", "a-refresh-token");

        var body = new { code = "auth-code", codeVerifier = "verifier", redirectUri = "https://example.com" };
        var response = await _client.PostAsJsonAsync("/auth/token", body);

        response.EnsureSuccessStatusCode();
        var json = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("an-id-token", json.GetProperty("id_token").GetString());

        Assert.True(response.Headers.TryGetValues("Set-Cookie", out var cookies));
        var rt = Assert.Single(cookies, c => c.StartsWith("rt="));
        Assert.Contains("rt=a-refresh-token", rt);
        Assert.Contains("httponly", rt.ToLowerInvariant());
        Assert.Contains("samesite=strict", rt.ToLowerInvariant());
        Assert.Contains("path=/api/auth", rt.ToLowerInvariant());
    }

    // BUG-16: a returning user re-authenticates without prompt=consent, so Google may return
    // no refresh_token. The exchange must NOT set an empty rt cookie — that would clobber the
    // user's still-valid refresh cookie and degrade the session back to ~1h.
    [Fact]
    public async Task PostAuthToken_SuccessWithoutRefreshToken_DoesNotSetRefreshCookie()
    {
        var fake = factory.Services.GetRequiredService<FakeGoogleOAuthClient>();
        fake.Reset();
        fake.ExchangeResult = FakeGoogleOAuthClient.Success("an-id-token", null);

        var body = new { code = "auth-code", codeVerifier = "verifier", redirectUri = "https://example.com" };
        var response = await _client.PostAsJsonAsync("/auth/token", body);

        response.EnsureSuccessStatusCode();
        var json = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("an-id-token", json.GetProperty("id_token").GetString());

        if (response.Headers.TryGetValues("Set-Cookie", out var cookies))
            Assert.DoesNotContain(cookies, c => c.StartsWith("rt="));
    }

    [Fact]
    public async Task PostAuthToken_GoogleSecretsNotConfigured_Returns503()
    {
        var saved = (
            id: Environment.GetEnvironmentVariable("GOOGLE_CLIENT_ID"),
            secret: Environment.GetEnvironmentVariable("GOOGLE_CLIENT_SECRET"));
        try
        {
            Environment.SetEnvironmentVariable("GOOGLE_CLIENT_ID", "");
            Environment.SetEnvironmentVariable("GOOGLE_CLIENT_SECRET", "");

            var body = new { code = "some-code", codeVerifier = "verifier", redirectUri = "https://example.com" };
            var response = await _client.PostAsJsonAsync("/auth/token", body);
            Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
        }
        finally
        {
            Environment.SetEnvironmentVariable("GOOGLE_CLIENT_ID", saved.id);
            Environment.SetEnvironmentVariable("GOOGLE_CLIENT_SECRET", saved.secret);
        }
    }
}
