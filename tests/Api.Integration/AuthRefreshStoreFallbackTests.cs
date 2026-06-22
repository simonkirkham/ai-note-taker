using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;

namespace Api.Integration;

// 30-D: /auth/refresh falls back to the server-side store when the `rt` cookie is absent.
// As long as the request still identifies the user (Authorization id_token -> sub), the stored
// refresh token is used to refresh and the cookie is re-set. Absent both cookie and a resolvable
// stored token -> 401, as before. The refresh token is never returned to or logged for the browser.
[Collection("AuthEnv")]
public sealed class AuthRefreshStoreFallbackTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _factory;
    private readonly FakeGoogleOAuthClient _google;
    private readonly InMemoryRefreshTokenStore _store;

    public AuthRefreshStoreFallbackTests(ApiFactory factory)
    {
        _factory = factory;
        _google = factory.Services.GetRequiredService<FakeGoogleOAuthClient>();
        _store = factory.Services.GetRequiredService<InMemoryRefreshTokenStore>();
        _google.Reset();
        _store.Clear();
    }

    private HttpClient Client => _factory.CreateUnauthenticatedClient();

    // Given no `rt` cookie but a valid Authorization id_token whose sub has a stored refresh token
    // When /auth/refresh runs
    // Then the stored token is used to refresh, the response is 200 with an id_token, and the cookie is re-set.
    [Fact]
    public async Task NoCookie_StoredTokenForSub_RefreshesFromStore_SetsCookie()
    {
        _store.Seed("google-sub-d1", "stored-refresh-token");
        _google.RefreshResult = FakeGoogleOAuthClient.Success("fresh-id-token", null);

        var request = new HttpRequestMessage(HttpMethod.Post, "/auth/refresh");
        request.Headers.Add("Authorization", "Bearer " + TestJwt.WithSub("google-sub-d1"));

        var response = await Client.SendAsync(request);

        response.EnsureSuccessStatusCode();
        var json = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("fresh-id-token", json.GetProperty("id_token").GetString());

        // The stored token was the one presented to Google.
        Assert.Equal("stored-refresh-token", _google.LastRefreshTokenSeen);

        // The cookie is re-set from the stored token, and the body never leaks it.
        Assert.True(response.Headers.TryGetValues("Set-Cookie", out var cookies));
        var rt = Assert.Single(cookies, c => c.StartsWith("rt="));
        Assert.Contains("rt=stored-refresh-token", rt);
        var body = await response.Content.ReadAsStringAsync();
        Assert.DoesNotContain("stored-refresh-token", body);
    }

    // Given no `rt` cookie and no Authorization header
    // When /auth/refresh runs
    // Then 401 (unchanged).
    [Fact]
    public async Task NoCookie_NoAuthorization_Returns401()
    {
        var request = new HttpRequestMessage(HttpMethod.Post, "/auth/refresh");

        var response = await Client.SendAsync(request);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    // Given no `rt` cookie and a valid Authorization id_token whose sub has NO stored token
    // When /auth/refresh runs
    // Then 401 (unchanged).
    [Fact]
    public async Task NoCookie_NoStoredTokenForSub_Returns401()
    {
        var request = new HttpRequestMessage(HttpMethod.Post, "/auth/refresh");
        request.Headers.Add("Authorization", "Bearer " + TestJwt.WithSub("google-sub-d2"));

        var response = await Client.SendAsync(request);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    // Given no cookie, fallback to a stored token that Google then rejects as revoked
    // When /auth/refresh runs
    // Then the store entry is deleted (it matches the token used) and 401 is returned.
    [Fact]
    public async Task NoCookie_StoredTokenRejectedAsRevoked_DeletesStoreEntry_Returns401()
    {
        _store.Seed("google-sub-d3", "revoked-stored-token");
        _google.RefreshResult = FakeGoogleOAuthClient.Failure(400);

        var request = new HttpRequestMessage(HttpMethod.Post, "/auth/refresh");
        request.Headers.Add("Authorization", "Bearer " + TestJwt.WithSub("google-sub-d3"));

        var response = await Client.SendAsync(request);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.False(_store.Has("google-sub-d3"));
    }
}
