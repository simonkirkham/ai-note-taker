using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Domain.Workspaces;
using EventStore.Projections;
using Microsoft.Extensions.DependencyInjection;

namespace Api.Integration;

// 41-B: the action-item write tools (add / complete / reopen). Each authorizes note ownership against
// the EVENT STREAM (INoteAuthorizer), so the note is created through the real create_note write path
// first (appending real events) rather than seeding a projection — the whole flow runs end-to-end
// against the in-process host (SyncProjectingEventStore folds the events, so get_note reflects them).
public sealed class McpActionItemWriteToolsTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private const string ProtocolVersion = "2025-06-18";
    private const string Owner = "test-user-123";        // allowlisted sub (FakeCurrentUser.TestUserId)
    private const string OtherUser = "other-user-456";   // also allowlisted, owns nothing here

    private readonly ApiFactory _factory = factory;

    [Fact]
    public async Task ToolsList_IncludesActionItemWriteTools()
    {
        var client = _factory.CreateUnauthenticatedClient();
        var names = (await CallAsync(client, "tools/list", new { }, McpTestTokens.Valid()))
            .GetProperty("tools").EnumerateArray().Select(t => t.GetProperty("name").GetString()).ToList();
        Assert.Contains("add_action_item", names);
        Assert.Contains("complete_action_item", names);
        Assert.Contains("reopen_action_item", names);
    }

    [Fact]
    public async Task AddCompleteReopen_FullLifecycle_OnOwnedNote()
    {
        var client = _factory.CreateUnauthenticatedClient();
        var noteId = await CreateNoteAsync(client, Owner, "Planning");

        // Add — the item appears open on the note.
        var added = await CallToolAsync(client, "add_action_item",
            new { noteId, description = "Send the deck" }, McpTestTokens.Valid(Owner));
        Assert.False(IsToolError(added));
        var actionId = ParsePayload(added).GetProperty("actionId").GetString()!;
        Assert.Equal((false, "Send the deck"), await ActionStateAsync(client, noteId, actionId));

        // Complete — the item is now complete.
        var completed = await CallToolAsync(client, "complete_action_item",
            new { noteId, actionId }, McpTestTokens.Valid(Owner));
        Assert.False(IsToolError(completed));
        Assert.Equal((true, "Send the deck"), await ActionStateAsync(client, noteId, actionId));

        // Reopen — the item is open again.
        var reopened = await CallToolAsync(client, "reopen_action_item",
            new { noteId, actionId }, McpTestTokens.Valid(Owner));
        Assert.False(IsToolError(reopened));
        Assert.Equal((false, "Send the deck"), await ActionStateAsync(client, noteId, actionId));
    }

    [Fact]
    public async Task AddActionItem_OnNoteIDoNotOwn_IsRejected()
    {
        var client = _factory.CreateUnauthenticatedClient();
        var noteId = await CreateNoteAsync(client, Owner, "Owner's note");

        var result = await CallToolAsync(client, "add_action_item",
            new { noteId, description = "intruder task" }, McpTestTokens.Valid(OtherUser));

        Assert.True(IsToolError(result));
        // Nothing landed: the owner's note has no action items.
        var fetched = await CallToolAsync(client, "get_note",
            new { workspaceId = WorkspaceId.DefaultValue, noteId }, McpTestTokens.Valid(Owner));
        Assert.Empty(ParsePayload(fetched).GetProperty("actionItems").EnumerateArray());
    }

    [Fact]
    public async Task CompleteActionItem_OnNoteIDoNotOwn_IsRejected()
    {
        var client = _factory.CreateUnauthenticatedClient();
        var noteId = await CreateNoteAsync(client, Owner, "Owner's note");
        var actionId = ParsePayload(await CallToolAsync(client, "add_action_item",
            new { noteId, description = "owner task" }, McpTestTokens.Valid(Owner))).GetProperty("actionId").GetString()!;

        var result = await CallToolAsync(client, "complete_action_item",
            new { noteId, actionId }, McpTestTokens.Valid(OtherUser));

        Assert.True(IsToolError(result));
        // Still open — the cross-user complete did not land.
        Assert.Equal((false, "owner task"), await ActionStateAsync(client, noteId, actionId));
    }

    [Fact]
    public async Task AddActionItem_BlankDescription_IsRejected()
    {
        var client = _factory.CreateUnauthenticatedClient();
        var noteId = await CreateNoteAsync(client, Owner, "Planning");

        var result = await CallToolAsync(client, "add_action_item",
            new { noteId, description = "   " }, McpTestTokens.Valid(Owner));

        Assert.True(IsToolError(result));
    }

    [Fact]
    public async Task ReopenAlreadyOpenItem_IsAConflictError_NotA500()
    {
        var client = _factory.CreateUnauthenticatedClient();
        var noteId = await CreateNoteAsync(client, Owner, "Planning");
        var actionId = ParsePayload(await CallToolAsync(client, "add_action_item",
            new { noteId, description = "open task" }, McpTestTokens.Valid(Owner))).GetProperty("actionId").GetString()!;

        // The item is open; reopening it is an illegal transition → a clean MCP error, not a 500.
        var result = await CallToolAsync(client, "reopen_action_item",
            new { noteId, actionId }, McpTestTokens.Valid(Owner));

        Assert.True(IsToolError(result));
    }

    // ── Helpers ──────────────────────────────────────────────────────────

    private async Task<string> CreateNoteAsync(HttpClient client, string user, string title)
    {
        var created = await CallToolAsync(client, "create_note",
            new { workspaceId = WorkspaceId.DefaultValue, title, content = "body" }, McpTestTokens.Valid(user));
        return ParsePayload(created).GetProperty("noteId").GetString()!;
    }

    // (completed, description) of a single action item, read back through get_note.
    private async Task<(bool Completed, string Description)> ActionStateAsync(HttpClient client, string noteId, string actionId)
    {
        var fetched = await CallToolAsync(client, "get_note",
            new { workspaceId = WorkspaceId.DefaultValue, noteId }, McpTestTokens.Valid(Owner));
        var item = ParsePayload(fetched).GetProperty("actionItems").EnumerateArray()
            .Single(a => a.GetProperty("id").GetString() == actionId);
        return (item.GetProperty("completed").GetBoolean(), item.GetProperty("description").GetString()!);
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
