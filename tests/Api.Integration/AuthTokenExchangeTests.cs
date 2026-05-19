using System.Net;
using System.Net.Http.Json;

namespace Api.Integration;

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
