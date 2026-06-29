using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;

namespace Api.Integration;

// 30-A: server-side refresh-token store. The backend persists the Google refresh token keyed
// by the user's `sub` and restores the `rt` cookie from it when a returning, prompt-less
// sign-in yields no refresh_token from Google.
[Collection("AuthEnv")]
public sealed class AuthRefreshTokenStoreTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _factory;
    private readonly FakeGoogleOAuthClient _google;
    private readonly InMemoryRefreshTokenStore _store;

    public AuthRefreshTokenStoreTests(ApiFactory factory)
    {
        _factory = factory;
        _google = factory.Services.GetRequiredService<FakeGoogleOAuthClient>();
        _store = factory.Services.GetRequiredService<InMemoryRefreshTokenStore>();
        _google.Reset();
        _store.Clear();
    }

    private HttpClient Client => _factory.CreateUnauthenticatedClient();

    private static object TokenBody() =>
        new { code = "auth-code", codeVerifier = "verifier", redirectUri = "https://example.com" };

    // Given a first-ever sign-in (consent shown, Google returns a refresh token)
    // When /auth/token runs
    // Then the token is stored keyed by sub and the cookie is set.
    [Fact]
    public async Task FirstSignIn_StoresRefreshTokenKeyedBySub_AndSetsCookie()
    {
        var idToken = TestJwt.WithSub("google-sub-111");
        _google.ExchangeResult = FakeGoogleOAuthClient.Success(idToken, "first-refresh-token");

        var response = await Client.PostAsJsonAsync("/auth/token", TokenBody());

        response.EnsureSuccessStatusCode();
        Assert.Equal("first-refresh-token", _store.Get("google-sub-111"));

        Assert.True(response.Headers.TryGetValues("Set-Cookie", out var cookies));
        Assert.Contains(cookies, c => c.StartsWith("rt=first-refresh-token"));
    }

    // Given a returning user with a stored token, signing in without consent (Google returns
    // no refresh token)
    // When /auth/token runs
    // Then the cookie is restored from the store and the session is long-lived.
    [Fact]
    public async Task ReturningSignInWithoutRefreshToken_RestoresCookieFromStore()
    {
        _store.Seed("google-sub-222", "stored-refresh-token");
        var idToken = TestJwt.WithSub("google-sub-222");
        _google.ExchangeResult = FakeGoogleOAuthClient.Success(idToken, null);

        var response = await Client.PostAsJsonAsync("/auth/token", TokenBody());

        response.EnsureSuccessStatusCode();
        var json = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(idToken, json.GetProperty("id_token").GetString());

        Assert.True(response.Headers.TryGetValues("Set-Cookie", out var cookies));
        var rt = Assert.Single(cookies, c => c.StartsWith("rt="));
        Assert.Contains("rt=stored-refresh-token", rt);
        // Long-lived: the 30-day window cookie, never the refresh token in the body.
        Assert.Contains("max-age=", rt.ToLowerInvariant());
        var body = await response.Content.ReadAsStringAsync();
        Assert.DoesNotContain("stored-refresh-token", body);
    }

    // Given no stored token and no refresh token from Google
    // When /auth/token runs
    // Then behaviour is unchanged (id_token returned, short session) — no regression.
    [Fact]
    public async Task NoStoredTokenAndNoRefreshToken_NoCookieSet_IdTokenReturned()
    {
        var idToken = TestJwt.WithSub("google-sub-333");
        _google.ExchangeResult = FakeGoogleOAuthClient.Success(idToken, null);

        var response = await Client.PostAsJsonAsync("/auth/token", TokenBody());

        response.EnsureSuccessStatusCode();
        var json = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(idToken, json.GetProperty("id_token").GetString());

        if (response.Headers.TryGetValues("Set-Cookie", out var cookies))
            Assert.DoesNotContain(cookies, c => c.StartsWith("rt="));
        Assert.False(_store.Has("google-sub-333"));
    }

    // Given a stored token Google now rejects as revoked
    // When /auth/refresh runs (cookie-based, with the id_token identifying the sub)
    // Then the store entry is deleted and the response is 401 (next sign-in re-consents).
    [Fact]
    public async Task RefreshRejectedAsRevoked_DeletesStoreEntry_Returns401()
    {
        _store.Seed("google-sub-444", "revoked-refresh-token");
        _google.RefreshResult = FakeGoogleOAuthClient.Failure(400);

        var request = new HttpRequestMessage(HttpMethod.Post, "/auth/refresh");
        request.Headers.Add("Cookie", "rt=revoked-refresh-token");
        request.Headers.Add("Authorization", "Bearer " + TestJwt.WithSub("google-sub-444"));

        var response = await Client.SendAsync(request);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.False(_store.Has("google-sub-444"));
    }

    // Revoked refresh with no resolvable sub (no Authorization header): still 401, never 500,
    // and the delete is skipped gracefully.
    [Fact]
    public async Task RefreshRejected_NoSubResolvable_Returns401NotServerError()
    {
        _google.RefreshResult = FakeGoogleOAuthClient.Failure(400);

        var request = new HttpRequestMessage(HttpMethod.Post, "/auth/refresh");
        request.Headers.Add("Cookie", "rt=some-refresh-token");

        var response = await Client.SendAsync(request);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    // Security: /auth/refresh is anonymous and `sub` is decoded without signature validation.
    // A forged Authorization `sub` paired with a cookie token that is NOT the victim's stored
    // token must NOT evict the victim's entry — the presented token must match the stored copy.
    [Fact]
    public async Task RefreshRejected_ForgedSubWithNonMatchingToken_DoesNotDeleteVictimEntry()
    {
        _store.Seed("victim-sub", "victims-real-refresh-token");
        _google.RefreshResult = FakeGoogleOAuthClient.Failure(400);

        var request = new HttpRequestMessage(HttpMethod.Post, "/auth/refresh");
        // Attacker presents a token they control (Google rejects it) but forges the victim's sub.
        request.Headers.Add("Cookie", "rt=attacker-controlled-token");
        request.Headers.Add("Authorization", "Bearer " + TestJwt.WithSub("victim-sub"));

        var response = await Client.SendAsync(request);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        // The victim's durable token survives the forged-sub eviction attempt.
        Assert.Equal("victims-real-refresh-token", _store.Get("victim-sub"));
    }

    // A successful refresh that rotates the refresh token also persists the rotation to the
    // store (keyed by the Authorization id_token's sub), so the durable copy stays current.
    [Fact]
    public async Task RefreshRotatesToken_PersistsRotationToStore()
    {
        _store.Seed("google-sub-555", "old-refresh-token");
        _google.RefreshResult = FakeGoogleOAuthClient.Success("rotated-id-token", "rotated-refresh-token");

        var request = new HttpRequestMessage(HttpMethod.Post, "/auth/refresh");
        request.Headers.Add("Cookie", "rt=old-refresh-token");
        request.Headers.Add("Authorization", "Bearer " + TestJwt.WithSub("google-sub-555"));

        var response = await Client.SendAsync(request);

        response.EnsureSuccessStatusCode();
        Assert.Equal("rotated-refresh-token", _store.Get("google-sub-555"));
    }
}
