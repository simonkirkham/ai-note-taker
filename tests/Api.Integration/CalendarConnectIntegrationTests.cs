using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;

namespace Api.Integration;

// Phase 34-A: in-app "Connect Google Calendar" → server-side token store. These exercise the
// default workspace (the harness rewrites un-prefixed `/calendar/*` to `/w/__default__/...`);
// per-workspace keying + isolation is covered in WorkspaceCalendarConnectIntegrationTests.
public sealed class CalendarConnectIntegrationTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _factory;
    private readonly HttpClient _client;
    private readonly FakeGoogleOAuthClient _oauth;
    private readonly InMemoryCalendarTokenStore _store;

    private const string TestUser = FakeCurrentUser.TestUserId;
    private const string DefaultWs = Domain.Workspaces.WorkspaceId.DefaultValue;

    public CalendarConnectIntegrationTests(ApiFactory factory)
    {
        _factory = factory;
        _client = factory.CreateClient();
        _oauth = factory.Services.GetRequiredService<FakeGoogleOAuthClient>();
        _store = factory.Services.GetRequiredService<InMemoryCalendarTokenStore>();
        _oauth.Reset();
        _store.Clear();
    }

    // Minimal unsigned JWT carrying the given claims (the app decodes the payload without verifying).
    private static string Jwt(object payload)
    {
        static string B64(byte[] b) => Convert.ToBase64String(b).TrimEnd('=').Replace('+', '-').Replace('/', '_');
        var header = B64("{\"alg\":\"none\"}"u8.ToArray());
        var body = B64(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(payload)));
        return $"{header}.{body}.sig";
    }

    private static HttpContent ConnectBody() => JsonContent.Create(new
    {
        code = "auth-code",
        codeVerifier = "verifier",
        redirectUri = "https://app.example.com/"
    });

    [Fact]
    public async Task Connect_StoresRefreshTokenAndEmail()
    {
        _oauth.ExchangeResult = FakeGoogleOAuthClient.Success(
            Jwt(new { sub = TestUser, email = "owner@example.com" }), "rt-google-123");

        var resp = await _client.PostAsync("/calendar/connect/google", ConnectBody());

        resp.EnsureSuccessStatusCode();
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(body.GetProperty("connected").GetBoolean());
        Assert.Equal("owner@example.com", body.GetProperty("email").GetString());

        var stored = _store.Peek(TestUser, DefaultWs, "google");
        Assert.NotNull(stored);
        Assert.Equal("rt-google-123", stored!.RefreshToken);
        Assert.Equal("owner@example.com", stored.Email);
    }

    [Fact]
    public async Task Connect_NoRefreshToken_ReturnsReconsentRequired()
    {
        _oauth.ExchangeResult = FakeGoogleOAuthClient.Success(Jwt(new { sub = TestUser }), refreshToken: null);

        var resp = await _client.PostAsync("/calendar/connect/google", ConnectBody());

        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("reconsent_required", body.GetProperty("error").GetString());
        Assert.False(_store.Has(TestUser, DefaultWs, "google"));
    }

    [Fact]
    public async Task Connect_RequiresAuthentication()
    {
        var resp = await _factory.CreateUnauthenticatedClient().PostAsync("/calendar/connect/google", ConnectBody());
        Assert.Equal(HttpStatusCode.Unauthorized, resp.StatusCode);
    }

    [Fact]
    public async Task Connection_NeedsAuth_WhenNotConnected()
    {
        var body = await (await _client.GetAsync("/calendar/connection")).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("needs_auth", body.GetProperty("status").GetString());
        // 34-C: provider is null when unconnected (no longer a fixed "google") — the workspace has no
        // connected provider until one is chosen at connect time.
        Assert.Equal(JsonValueKind.Null, body.GetProperty("provider").ValueKind);
    }

    [Fact]
    public async Task Connection_Connected_WithEmail_AfterConnect()
    {
        _store.Seed(TestUser, DefaultWs, "google", "rt-x", "owner@example.com");

        var body = await (await _client.GetAsync("/calendar/connection")).Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal("connected", body.GetProperty("status").GetString());
        Assert.Equal("owner@example.com", body.GetProperty("email").GetString());
    }

    [Fact]
    public async Task Disconnect_RemovesToken_AndConnectionReadsNeedsAuth()
    {
        _store.Seed(TestUser, DefaultWs, "google", "rt-x", "owner@example.com");

        var disconnect = await _client.PostAsync("/calendar/disconnect", content: null);
        disconnect.EnsureSuccessStatusCode();

        Assert.False(_store.Has(TestUser, DefaultWs, "google"));
        var body = await (await _client.GetAsync("/calendar/connection")).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("needs_auth", body.GetProperty("status").GetString());
    }

    [Fact]
    public async Task Connect_IsolatedPerUser()
    {
        // Two users share the default workspace id (`__default__`), so this is the load-bearing
        // check that the token key's userId partition prevents a cross-user leak there. Assert at
        // the HTTP `connection` read (not just the store) in BOTH directions.
        _oauth.ExchangeResult = FakeGoogleOAuthClient.Success(Jwt(new { sub = TestUser, email = "a@example.com" }), "rt-a");
        (await _client.PostAsync("/calendar/connect/google", ConnectBody())).EnsureSuccessStatusCode();

        var mine = await (await _client.GetAsync("/calendar/connection")).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("connected", mine.GetProperty("status").GetString());

        var other = _factory.CreateClientAsOtherUser();
        var theirs = await (await other.GetAsync("/calendar/connection")).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("needs_auth", theirs.GetProperty("status").GetString());

        Assert.True(_store.Has(TestUser, DefaultWs, "google"));
        Assert.False(_store.Has(ApiFactory.OtherTestUserId, DefaultWs, "google"));
    }
}
