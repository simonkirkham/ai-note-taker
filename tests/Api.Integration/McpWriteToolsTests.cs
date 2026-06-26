using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Domain.Workspaces;
using EventStore.Projections;
using Microsoft.Extensions.DependencyInjection;

namespace Api.Integration;

// 41-A: the first MCP WRITE tool. create_note goes through INoteCommandHandler's identity-explicit
// overload (the token `sub` is the owner), so the whole flow is exercised end-to-end against the
// in-process host (SyncProjectingEventStore folds the events, so the note is immediately readable via
// get_note). Asserts: a create in an owned workspace lands and is readable + user-scoped; a create in
// an unowned workspace is rejected (MCP error, nothing written); a blank create is rejected.
public sealed class McpWriteToolsTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private const string ProtocolVersion = "2025-06-18";
    private const string Owner = "test-user-123";        // allowlisted sub (FakeCurrentUser.TestUserId)
    private const string OtherUser = "other-user-456";   // also allowlisted, owns nothing here
    private const string OtherWorkspace = "ws-other-user";

    private readonly ApiFactory _factory = factory;

    [Fact]
    public async Task ToolsList_IncludesCreateNote()
    {
        var client = _factory.CreateUnauthenticatedClient();
        var result = await CallAsync(client, "tools/list", new { }, McpTestTokens.Valid());

        var names = result.GetProperty("tools").EnumerateArray()
            .Select(t => t.GetProperty("name").GetString())
            .ToList();
        Assert.Contains("create_note", names);
    }

    [Fact]
    public async Task CreateNote_InOwnedWorkspace_CreatesReadableNote()
    {
        var client = _factory.CreateUnauthenticatedClient();
        var created = await CallToolAsync(client, "create_note",
            new { workspaceId = WorkspaceId.DefaultValue, title = "Acme sync", content = "We agreed the Q3 plan" },
            McpTestTokens.Valid(Owner));

        Assert.False(IsToolError(created));
        var noteId = ParsePayload(created).GetProperty("noteId").GetString()!;

        // The note is immediately readable through get_note (the sync projector folded the events).
        var fetched = await CallToolAsync(client, "get_note",
            new { workspaceId = WorkspaceId.DefaultValue, noteId }, McpTestTokens.Valid(Owner));
        Assert.False(IsToolError(fetched));
        var payload = ParsePayload(fetched);
        Assert.Equal("Acme sync", payload.GetProperty("title").GetString());
        Assert.Contains("Q3 plan", payload.GetProperty("content").GetString());
    }

    [Fact]
    public async Task CreateNote_IsScopedToCreatingUser()
    {
        var client = _factory.CreateUnauthenticatedClient();
        var created = await CallToolAsync(client, "create_note",
            new { workspaceId = WorkspaceId.DefaultValue, title = "Mine only", content = "private" },
            McpTestTokens.Valid(Owner));
        var noteId = ParsePayload(created).GetProperty("noteId").GetString()!;

        // Another user reading the same default workspace never sees it.
        var theirList = await CallToolAsync(client, "list_notes",
            new { workspaceId = WorkspaceId.DefaultValue }, McpTestTokens.Valid(OtherUser));
        var theirIds = ParsePayload(theirList).GetProperty("notes").EnumerateArray()
            .Select(n => n.GetProperty("id").GetString()).ToList();
        Assert.DoesNotContain(noteId, theirIds);
    }

    [Fact]
    public async Task CreateNote_InUnownedWorkspace_IsRejected_NothingWritten()
    {
        // OtherUser owns OtherWorkspace; Owner does not → the create is an MCP error.
        SeedWorkspace(OtherUser, OtherWorkspace, "Not Mine");

        var client = _factory.CreateUnauthenticatedClient();
        var result = await CallToolAsync(client, "create_note",
            new { workspaceId = OtherWorkspace, title = "Intruder", content = "should not land" },
            McpTestTokens.Valid(Owner));

        Assert.True(IsToolError(result));

        // Nothing landed: the real owner sees no note in that workspace.
        var ownerList = await CallToolAsync(client, "list_notes",
            new { workspaceId = OtherWorkspace }, McpTestTokens.Valid(OtherUser));
        Assert.Empty(ParsePayload(ownerList).GetProperty("notes").EnumerateArray());
    }

    [Fact]
    public async Task CreateNote_BlankTitleAndContent_IsRejected()
    {
        var client = _factory.CreateUnauthenticatedClient();
        var result = await CallToolAsync(client, "create_note",
            new { workspaceId = WorkspaceId.DefaultValue, title = "   ", content = "" },
            McpTestTokens.Valid(Owner));

        Assert.True(IsToolError(result));
    }

    // ── Helpers (compact MCP JSON-RPC transport) ─────────────────────────

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
