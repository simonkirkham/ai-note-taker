using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Domain.Workspaces;
using EventStore;
using Microsoft.Extensions.DependencyInjection;

namespace Api.Integration;

// Phase 34-B: the calendar connection is keyed by workspace. Each workspace connects its own Google
// account; connecting one never affects another; the connect records a WorkspaceCalendarConnected
// event on the (non-default) workspace's aggregate.
public sealed class WorkspaceCalendarConnectIntegrationTests : IClassFixture<ApiFactory>
{
    private readonly HttpClient _client;
    private readonly FakeGoogleOAuthClient _oauth;
    private readonly FakeMicrosoftOAuthClient _msOauth;
    private readonly InMemoryCalendarTokenStore _store;
    private readonly IEventStore _events;

    private const string TestUser = FakeCurrentUser.TestUserId;

    public WorkspaceCalendarConnectIntegrationTests(ApiFactory factory)
    {
        _client = factory.CreateClient();
        _oauth = factory.Services.GetRequiredService<FakeGoogleOAuthClient>();
        _msOauth = factory.Services.GetRequiredService<FakeMicrosoftOAuthClient>();
        _store = factory.Services.GetRequiredService<InMemoryCalendarTokenStore>();
        _events = factory.Services.GetRequiredService<IEventStore>();
        _oauth.Reset();
        _msOauth.Reset();
        _store.Clear();
    }

    private static string Jwt(string? email)
    {
        static string B64(byte[] b) => Convert.ToBase64String(b).TrimEnd('=').Replace('+', '-').Replace('/', '_');
        var header = B64("{\"alg\":\"none\"}"u8.ToArray());
        var payload = email is null ? new { sub = TestUser } : (object)new { sub = TestUser, email };
        var body = B64(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(payload)));
        return $"{header}.{body}.sig";
    }

    private static HttpContent ConnectBody() => JsonContent.Create(new
    {
        code = "auth-code",
        codeVerifier = "verifier",
        redirectUri = "https://app.example.com/"
    });

    private async Task<string> CreateWorkspaceAsync(string name)
    {
        var resp = await _client.PostAsync("/workspaces",
            new StringContent($"{{\"name\":\"{name}\"}}", Encoding.UTF8, "application/json"));
        Assert.Equal(HttpStatusCode.Created, resp.StatusCode);
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        return body.GetProperty("workspaceId").GetString()!;
    }

    private async Task ConnectAsync(string wsId, string email, string refreshToken)
    {
        _oauth.ExchangeResult = FakeGoogleOAuthClient.Success(Jwt(email), refreshToken);
        var resp = await _client.PostAsync($"/w/{wsId}/calendar/connect/google", ConnectBody());
        resp.EnsureSuccessStatusCode();
    }

    private async Task ConnectMicrosoftAsync(string wsId, string email, string refreshToken)
    {
        _msOauth.ExchangeResult = FakeMicrosoftOAuthClient.Success(refreshToken, email);
        var resp = await _client.PostAsync($"/w/{wsId}/calendar/connect/microsoft", ConnectBody());
        resp.EnsureSuccessStatusCode();
    }

    // 34-E: a public-host feed URL (passes the SSRF guard offline) whose validation fetch is stubbed
    // by FakeIcsValidationHandler to return a valid ICS.
    private const string GoodIcsUrl = "https://8.8.8.8/cal.ics";

    private async Task ConnectIcsAsync(string wsId, string url)
    {
        var resp = await _client.PostAsync($"/w/{wsId}/calendar/connect/ics",
            JsonContent.Create(new { url }));
        resp.EnsureSuccessStatusCode();
    }

    private async Task<(string status, string? email)> ConnectionAsync(string wsId)
    {
        var body = await (await _client.GetAsync($"/w/{wsId}/calendar/connection")).Content.ReadFromJsonAsync<JsonElement>();
        return (body.GetProperty("status").GetString()!,
            body.GetProperty("email").ValueKind == JsonValueKind.Null ? null : body.GetProperty("email").GetString());
    }

    private async Task<string?> ConnectionProviderAsync(string wsId)
    {
        var body = await (await _client.GetAsync($"/w/{wsId}/calendar/connection")).Content.ReadFromJsonAsync<JsonElement>();
        return body.GetProperty("provider").ValueKind == JsonValueKind.Null ? null : body.GetProperty("provider").GetString();
    }

    private async Task<int> CalendarConnectedEventsAsync(string wsId)
    {
        var history = await _events.ReadAsync(new WorkspaceId(wsId).ToStreamId());
        return history.Count(e => e.EventType == nameof(WorkspaceCalendarConnected));
    }

    [Fact]
    public async Task TwoWorkspaces_HoldTwoDifferentCalendars()
    {
        var wsA = await CreateWorkspaceAsync("A");
        var wsB = await CreateWorkspaceAsync("B");

        await ConnectAsync(wsA, "calendar-a@gmail.com", "rt-a");
        await ConnectAsync(wsB, "calendar-b@gmail.com", "rt-b");

        Assert.Equal(("connected", "calendar-a@gmail.com"), await ConnectionAsync(wsA));
        Assert.Equal(("connected", "calendar-b@gmail.com"), await ConnectionAsync(wsB));
        Assert.Equal("rt-a", _store.Peek(TestUser, wsA, "google")!.RefreshToken);
        Assert.Equal("rt-b", _store.Peek(TestUser, wsB, "google")!.RefreshToken);
    }

    [Fact]
    public async Task Disconnect_ClearsOneWorkspaceOnly()
    {
        var wsA = await CreateWorkspaceAsync("A");
        var wsB = await CreateWorkspaceAsync("B");
        await ConnectAsync(wsA, "a@gmail.com", "rt-a");
        await ConnectAsync(wsB, "b@gmail.com", "rt-b");

        (await _client.PostAsync($"/w/{wsA}/calendar/disconnect", null)).EnsureSuccessStatusCode();

        Assert.Equal("needs_auth", (await ConnectionAsync(wsA)).status);
        Assert.Equal(("connected", "b@gmail.com"), await ConnectionAsync(wsB));
    }

    [Fact]
    public async Task WorkspaceWithNoConnection_ReadsNeedsAuth()
    {
        var wsC = await CreateWorkspaceAsync("C");
        Assert.Equal("needs_auth", (await ConnectionAsync(wsC)).status);
    }

    [Fact]
    public async Task Connect_IsolatedAcrossWorkspaces()
    {
        var wsA = await CreateWorkspaceAsync("A");
        var wsB = await CreateWorkspaceAsync("B");
        await ConnectAsync(wsA, "a@gmail.com", "rt-a");

        // B never connected → no token leaks from A.
        Assert.Equal("needs_auth", (await ConnectionAsync(wsB)).status);
        Assert.False(_store.Has(TestUser, wsB, "google"));
    }

    [Fact]
    public async Task Connect_RecordsWorkspaceCalendarConnectedEvent()
    {
        var wsA = await CreateWorkspaceAsync("A");
        await ConnectAsync(wsA, "a@gmail.com", "rt-a");

        Assert.Equal(1, await CalendarConnectedEventsAsync(wsA));
    }

    [Fact]
    public async Task DefaultWorkspaceConnect_StoresTokenButRecordsNoEvent()
    {
        // The default workspace has no per-user aggregate stream, so no event is recorded — the
        // token store alone carries its connection.
        await ConnectAsync(WorkspaceId.DefaultValue, "owner@gmail.com", "rt-default");

        Assert.True(_store.Has(TestUser, WorkspaceId.DefaultValue, "google"));
        Assert.Equal(0, await CalendarConnectedEventsAsync(WorkspaceId.DefaultValue));
    }

    // ── 34-C: Microsoft as a connectable provider per workspace ──────────────────────────

    [Fact]
    public async Task ConnectMicrosoft_StoredAndReadAsMicrosoft()
    {
        var wsA = await CreateWorkspaceAsync("A");
        await ConnectMicrosoftAsync(wsA, "owner@outlook.com", "rt-ms");

        Assert.Equal("microsoft", await ConnectionProviderAsync(wsA));
        Assert.Equal(("connected", "owner@outlook.com"), await ConnectionAsync(wsA));
        Assert.Equal("rt-ms", _store.Peek(TestUser, wsA, "microsoft")!.RefreshToken);
    }

    [Fact]
    public async Task TwoWorkspaces_OneGoogleOneOutlook()
    {
        var wsA = await CreateWorkspaceAsync("A");
        var wsB = await CreateWorkspaceAsync("B");
        await ConnectAsync(wsA, "a@gmail.com", "rt-a");
        await ConnectMicrosoftAsync(wsB, "b@outlook.com", "rt-b");

        Assert.Equal("google", await ConnectionProviderAsync(wsA));
        Assert.Equal("microsoft", await ConnectionProviderAsync(wsB));
    }

    [Fact]
    public async Task ConnectingSecondProvider_ReplacesFirst_OneProviderPerWorkspace()
    {
        // Connect Google, then Outlook on the SAME workspace → the Google token is cleared and only
        // Microsoft remains (decision #3: one provider per workspace).
        var wsA = await CreateWorkspaceAsync("A");
        await ConnectAsync(wsA, "a@gmail.com", "rt-a");
        await ConnectMicrosoftAsync(wsA, "a@outlook.com", "rt-ms");

        Assert.Equal("microsoft", await ConnectionProviderAsync(wsA));
        Assert.True(_store.Has(TestUser, wsA, "microsoft"));
        Assert.False(_store.Has(TestUser, wsA, "google"));
    }

    // ── 34-E: ICS feed as a connectable provider per workspace ───────────────────────────

    [Fact]
    public async Task ConnectIcs_StoresUrlAndReadsAsIcs()
    {
        var wsA = await CreateWorkspaceAsync("A");
        await ConnectIcsAsync(wsA, GoodIcsUrl);

        Assert.Equal("ics", await ConnectionProviderAsync(wsA));
        // ICS feeds carry no account identity → email is null.
        Assert.Equal(("connected", (string?)null), await ConnectionAsync(wsA));
        Assert.Equal(GoodIcsUrl, _store.Peek(TestUser, wsA, "ics")!.RefreshToken);
    }

    [Fact]
    public async Task ConnectingIcs_ClearsAPreExistingGoogleToken()
    {
        var wsA = await CreateWorkspaceAsync("A");
        await ConnectAsync(wsA, "a@gmail.com", "rt-a");
        await ConnectIcsAsync(wsA, GoodIcsUrl);

        Assert.Equal("ics", await ConnectionProviderAsync(wsA));
        Assert.True(_store.Has(TestUser, wsA, "ics"));
        Assert.False(_store.Has(TestUser, wsA, "google"));
    }

    [Fact]
    public async Task ConnectingGoogle_ClearsAPreExistingIcsToken()
    {
        var wsA = await CreateWorkspaceAsync("A");
        await ConnectIcsAsync(wsA, GoodIcsUrl);
        await ConnectAsync(wsA, "a@gmail.com", "rt-a");

        Assert.Equal("google", await ConnectionProviderAsync(wsA));
        Assert.True(_store.Has(TestUser, wsA, "google"));
        Assert.False(_store.Has(TestUser, wsA, "ics"));
    }

    [Fact]
    public async Task ConnectIcs_SsrfRejectedUrl_Returns400_AndStoresNothing()
    {
        var wsA = await CreateWorkspaceAsync("A");
        var resp = await _client.PostAsync($"/w/{wsA}/calendar/connect/ics",
            JsonContent.Create(new { url = "http://169.254.169.254/latest/meta-data/" }));

        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("invalid_request", body.GetProperty("error").GetString());
        Assert.False(_store.Has(TestUser, wsA, "ics"));
    }

    [Fact]
    public async Task ConnectIcs_UnparseableFeed_Returns400_AndStoresNothing()
    {
        var wsA = await CreateWorkspaceAsync("A");
        // FakeIcsValidationHandler returns non-ICS for a "bad-feed" path → invalid_feed.
        var resp = await _client.PostAsync($"/w/{wsA}/calendar/connect/ics",
            JsonContent.Create(new { url = "https://8.8.8.8/bad-feed.ics" }));

        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("invalid_feed", body.GetProperty("error").GetString());
        Assert.False(_store.Has(TestUser, wsA, "ics"));
    }

    [Fact]
    public async Task Disconnect_ClearsIcsToken()
    {
        var wsA = await CreateWorkspaceAsync("A");
        await ConnectIcsAsync(wsA, GoodIcsUrl);

        (await _client.PostAsync($"/w/{wsA}/calendar/disconnect", null)).EnsureSuccessStatusCode();

        Assert.Equal("needs_auth", (await ConnectionAsync(wsA)).status);
        Assert.False(_store.Has(TestUser, wsA, "ics"));
    }
}
