using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Api.Services;
using Domain.Workspaces;
using EventStore.Projections;
using Microsoft.Extensions.DependencyInjection;

namespace Api.Integration;

// 42-A: list_meetings reads a workspace's calendar over MCP. The test factory swaps in a
// FixedCalendarClientFactory→FakeCalendarClient (so the tool plumbing — auth, date parsing, event
// shaping, calendar_unavailable — is exercised end-to-end); the ICalendarScope refactor's per-workspace
// token resolution is covered by the calendar unit tests (GoogleCalendarTokenSourceTests,
// CalendarClientFactoryTests).
public sealed class McpListMeetingsToolTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private const string ProtocolVersion = "2025-06-18";
    private const string Owner = "test-user-123";        // allowlisted sub (FakeCurrentUser.TestUserId)
    private const string OtherUser = "other-user-456";   // also allowlisted, owns nothing here

    private readonly ApiFactory _factory = factory;

    private FakeCalendarClient Calendar => _factory.Services.GetRequiredService<FakeCalendarClient>();

    [Fact]
    public async Task ToolsList_IncludesListMeetings()
    {
        var client = _factory.CreateUnauthenticatedClient();
        var names = (await CallAsync(client, "tools/list", new { }, McpTestTokens.Valid()))
            .GetProperty("tools").EnumerateArray().Select(t => t.GetProperty("name").GetString()).ToList();
        Assert.Contains("list_meetings", names);
    }

    [Fact]
    public async Task ListMeetings_ReturnsTheDaysMeetings()
    {
        Calendar.Reset();
        Calendar.SetEvents(new[]
        {
            new CalendarEvent("evt-1", "Acme standup",
                new DateTimeOffset(2026, 6, 29, 9, 0, 0, TimeSpan.Zero),
                new DateTimeOffset(2026, 6, 29, 9, 30, 0, TimeSpan.Zero), true, "series-acme"),
        });

        var client = _factory.CreateUnauthenticatedClient();
        var result = await CallToolAsync(client, "list_meetings",
            new { workspaceId = WorkspaceId.DefaultValue, date = "2026-06-29" }, McpTestTokens.Valid(Owner));

        Assert.False(IsToolError(result));
        var payload = ParsePayload(result);
        Assert.True(payload.GetProperty("calendarConnected").GetBoolean());
        var meetings = payload.GetProperty("meetings").EnumerateArray().ToList();
        Assert.Single(meetings);
        Assert.Equal("evt-1", meetings[0].GetProperty("calendarEventId").GetString());
        Assert.Equal("Acme standup", meetings[0].GetProperty("title").GetString());
        Assert.True(meetings[0].GetProperty("isRecurring").GetBoolean());
        Assert.Equal(new DateOnly(2026, 6, 29), Calendar.LastRequestedDate);
    }

    [Fact]
    public async Task ListMeetings_ForUnownedWorkspace_IsRejected()
    {
        SeedWorkspace(Owner, "ws-private", "Private");
        var client = _factory.CreateUnauthenticatedClient();

        var result = await CallToolAsync(client, "list_meetings",
            new { workspaceId = "ws-private", date = "2026-06-29" }, McpTestTokens.Valid(OtherUser));

        Assert.True(IsToolError(result));
    }

    [Fact]
    public async Task ListMeetings_WhenNoCalendarConnected_ReturnsNotConnected_NotAnError()
    {
        Calendar.Reset();
        Calendar.SetUnavailable();

        var client = _factory.CreateUnauthenticatedClient();
        var result = await CallToolAsync(client, "list_meetings",
            new { workspaceId = WorkspaceId.DefaultValue, date = "2026-06-29" }, McpTestTokens.Valid(Owner));

        Assert.False(IsToolError(result));
        var payload = ParsePayload(result);
        Assert.False(payload.GetProperty("calendarConnected").GetBoolean());
        Assert.Empty(payload.GetProperty("meetings").EnumerateArray());
    }

    [Fact]
    public async Task ListMeetings_MalformedDate_IsAnError()
    {
        var client = _factory.CreateUnauthenticatedClient();
        var result = await CallToolAsync(client, "list_meetings",
            new { workspaceId = WorkspaceId.DefaultValue, date = "29-06-2026" }, McpTestTokens.Valid(Owner));

        Assert.True(IsToolError(result));
    }

    // ── Helpers ──────────────────────────────────────────────────────────

    private void SeedWorkspace(string userId, string workspaceId, string name)
    {
        var store = _factory.Services.GetRequiredService<IWorkspaceListStore>();
        store.UpsertAsync(new WorkspaceListView(
            new WorkspaceId(workspaceId), name, DateTimeOffset.UtcNow, userId)).GetAwaiter().GetResult();
    }

    private static JsonElement ParsePayload(JsonElement toolResult)
    {
        using var doc = JsonDocument.Parse(RawText(toolResult));
        return doc.RootElement.Clone();
    }

    private static string RawText(JsonElement toolResult) =>
        toolResult.GetProperty("content").EnumerateArray()
            .First(c => c.GetProperty("type").GetString() == "text")
            .GetProperty("text").GetString()!;

    private static bool IsToolError(JsonElement toolResult) =>
        toolResult.TryGetProperty("isError", out var e) && e.ValueKind == JsonValueKind.True;

    private async Task<JsonElement> CallToolAsync(HttpClient client, string toolName, object arguments, string token) =>
        await CallAsync(client, "tools/call", new { name = toolName, arguments }, token);

    private async Task<JsonElement> CallAsync(HttpClient client, string method, object @params, string token)
    {
        await PostAsync(client, Envelope("initialize", InitializeParams()), token);
        var resp = await PostAsync(client, Envelope(method, @params), token);
        resp.EnsureSuccessStatusCode();
        return await ReadResultAsync(resp);
    }

    private static async Task<HttpResponseMessage> PostAsync(HttpClient client, string json, string bearer)
    {
        var req = new HttpRequestMessage(HttpMethod.Post, "/mcp")
        {
            Content = new StringContent(json, Encoding.UTF8, "application/json")
        };
        req.Headers.Add("MCP-Protocol-Version", ProtocolVersion);
        req.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        req.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("text/event-stream"));
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", bearer);
        return await client.SendAsync(req);
    }

    private static string Envelope(string method, object @params) =>
        JsonSerializer.Serialize(new { jsonrpc = "2.0", id = 1, method, @params });

    private static object InitializeParams() => new
    {
        protocolVersion = ProtocolVersion,
        capabilities = new { },
        clientInfo = new { name = "test-client", version = "1.0" }
    };

    private static async Task<JsonElement> ReadResultAsync(HttpResponseMessage resp)
    {
        var body = await resp.Content.ReadAsStringAsync();
        var json = body.TrimStart().StartsWith("{") ? body : ExtractSseData(body);
        using var doc = JsonDocument.Parse(json);
        return doc.RootElement.GetProperty("result").Clone();
    }

    private static string ExtractSseData(string body)
    {
        var sb = new StringBuilder();
        foreach (var line in body.Split('\n'))
            if (line.StartsWith("data:"))
                sb.Append(line.AsSpan("data:".Length).Trim());
        return sb.ToString();
    }
}
