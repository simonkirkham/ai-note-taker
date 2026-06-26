using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Domain.Workspaces;
using EventStore.Projections;
using Microsoft.Extensions.DependencyInjection;

namespace Api.Integration;

// 41-C: edit_note replaces a note's body. The note is created through the real create_note write path
// first (real events), then edited — end-to-end against the in-process host (SyncProjectingEventStore
// folds the events, so get_note reflects the rewrite). Authorizes note ownership against the event
// stream; a cross-user edit is rejected and the body is unchanged.
public sealed class McpEditNoteToolTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private const string ProtocolVersion = "2025-06-18";
    private const string Owner = "test-user-123";        // allowlisted sub (FakeCurrentUser.TestUserId)
    private const string OtherUser = "other-user-456";   // also allowlisted, owns nothing here

    private readonly ApiFactory _factory = factory;

    [Fact]
    public async Task ToolsList_IncludesEditNote()
    {
        var client = _factory.CreateUnauthenticatedClient();
        var names = (await CallAsync(client, "tools/list", new { }, McpTestTokens.Valid()))
            .GetProperty("tools").EnumerateArray().Select(t => t.GetProperty("name").GetString()).ToList();
        Assert.Contains("edit_note", names);
    }

    [Fact]
    public async Task EditNote_ReplacesBody_OnOwnedNote()
    {
        var client = _factory.CreateUnauthenticatedClient();
        var noteId = await CreateNoteAsync(client, Owner, "Roadmap", "original body");

        var edited = await CallToolAsync(client, "edit_note",
            new { noteId, content = "rewritten body with the Q3 plan" }, McpTestTokens.Valid(Owner));
        Assert.False(IsToolError(edited));

        Assert.Equal("rewritten body with the Q3 plan", await ContentAsync(client, noteId));
    }

    [Fact]
    public async Task EditNote_OnNoteIDoNotOwn_IsRejected_BodyUnchanged()
    {
        var client = _factory.CreateUnauthenticatedClient();
        var noteId = await CreateNoteAsync(client, Owner, "Owner's note", "owner body");

        var result = await CallToolAsync(client, "edit_note",
            new { noteId, content = "intruder rewrite" }, McpTestTokens.Valid(OtherUser));

        Assert.True(IsToolError(result));
        Assert.Equal("owner body", await ContentAsync(client, noteId));
    }

    [Fact]
    public async Task EditNote_BlankContent_IsRejected()
    {
        var client = _factory.CreateUnauthenticatedClient();
        var noteId = await CreateNoteAsync(client, Owner, "Roadmap", "keep me");

        var result = await CallToolAsync(client, "edit_note",
            new { noteId, content = "   " }, McpTestTokens.Valid(Owner));

        Assert.True(IsToolError(result));
        Assert.Equal("keep me", await ContentAsync(client, noteId));
    }

    [Fact]
    public async Task EditNote_UnknownNote_IsCleanError()
    {
        var client = _factory.CreateUnauthenticatedClient();
        var result = await CallToolAsync(client, "edit_note",
            new { noteId = Guid.NewGuid().ToString(), content = "body" }, McpTestTokens.Valid(Owner));

        Assert.True(IsToolError(result));
    }

    // ── Helpers ──────────────────────────────────────────────────────────

    private async Task<string> CreateNoteAsync(HttpClient client, string user, string title, string content)
    {
        var created = await CallToolAsync(client, "create_note",
            new { workspaceId = WorkspaceId.DefaultValue, title, content }, McpTestTokens.Valid(user));
        return ParsePayload(created).GetProperty("noteId").GetString()!;
    }

    private async Task<string> ContentAsync(HttpClient client, string noteId)
    {
        var fetched = await CallToolAsync(client, "get_note",
            new { workspaceId = WorkspaceId.DefaultValue, noteId }, McpTestTokens.Valid(Owner));
        return ParsePayload(fetched).GetProperty("content").GetString()!;
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
