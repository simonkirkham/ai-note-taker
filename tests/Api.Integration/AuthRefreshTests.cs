using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;

namespace Api.Integration;

[Collection("AuthEnv")]
public sealed class AuthRefreshTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _factory;
    private readonly FakeGoogleOAuthClient _google;

    public AuthRefreshTests(ApiFactory factory)
    {
        _factory = factory;
        _google = factory.Services.GetRequiredService<FakeGoogleOAuthClient>();
        _google.Reset();
    }

    [Fact]
    public async Task PostAuthRefresh_NoCookie_Returns401()
    {
        var client = _factory.CreateUnauthenticatedClient();
        var response = await client.PostAsync("/auth/refresh", null);
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task PostAuthRefresh_WithValidCookie_ReturnsFreshIdToken()
    {
        _google.RefreshResult = FakeGoogleOAuthClient.Success("rotated-id-token", null);

        var client = _factory.CreateUnauthenticatedClient();
        var request = new HttpRequestMessage(HttpMethod.Post, "/auth/refresh");
        request.Headers.Add("Cookie", "rt=stored-refresh-token");

        var response = await client.SendAsync(request);

        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("rotated-id-token", body.GetProperty("id_token").GetString());
        Assert.Equal("stored-refresh-token", _google.LastRefreshTokenSeen);

        // Cookie is re-issued (window slid forward) even though Google returned no rotated token.
        Assert.True(response.Headers.TryGetValues("Set-Cookie", out var cookies));
        Assert.Contains(cookies, c => c.StartsWith("rt=stored-refresh-token"));
    }

    [Fact]
    public async Task PostAuthRefresh_PersistsRotatedRefreshToken_WhenGoogleReturnsOne()
    {
        _google.RefreshResult = FakeGoogleOAuthClient.Success("rotated-id-token", "rotated-refresh-token");

        var client = _factory.CreateUnauthenticatedClient();
        var request = new HttpRequestMessage(HttpMethod.Post, "/auth/refresh");
        request.Headers.Add("Cookie", "rt=old-refresh-token");

        var response = await client.SendAsync(request);

        response.EnsureSuccessStatusCode();
        Assert.True(response.Headers.TryGetValues("Set-Cookie", out var cookies));
        Assert.Contains(cookies, c => c.StartsWith("rt=rotated-refresh-token"));
    }

    [Fact]
    public async Task PostAuthRefresh_WhenGoogleRejectsRefreshToken_Returns401()
    {
        _google.RefreshResult = FakeGoogleOAuthClient.Failure(400);

        var client = _factory.CreateUnauthenticatedClient();
        var request = new HttpRequestMessage(HttpMethod.Post, "/auth/refresh");
        request.Headers.Add("Cookie", "rt=expired-refresh-token");

        var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }
}
