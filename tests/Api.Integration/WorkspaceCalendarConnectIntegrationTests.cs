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
    private readonly InMemoryCalendarTokenStore _store;
    private readonly IEventStore _events;

    private const string TestUser = FakeCurrentUser.TestUserId;

    public WorkspaceCalendarConnectIntegrationTests(ApiFactory factory)
    {
        _client = factory.CreateClient();
        _oauth = factory.Services.GetRequiredService<FakeGoogleOAuthClient>();
        _store = factory.Services.GetRequiredService<InMemoryCalendarTokenStore>();
        _events = factory.Services.GetRequiredService<IEventStore>();
        _oauth.Reset();
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

    private async Task<(string status, string? email)> ConnectionAsync(string wsId)
    {
        var body = await (await _client.GetAsync($"/w/{wsId}/calendar/connection")).Content.ReadFromJsonAsync<JsonElement>();
        return (body.GetProperty("status").GetString()!,
            body.GetProperty("email").ValueKind == JsonValueKind.Null ? null : body.GetProperty("email").GetString());
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

        (await _client.PostAsync($"/w/{wsA}/calendar/disconnect/google", null)).EnsureSuccessStatusCode();

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
}
