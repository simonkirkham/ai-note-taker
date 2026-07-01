using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Domain.Workspaces;
using EventStore.Projections;
using Microsoft.Extensions.DependencyInjection;

namespace Api.Integration;

// 47-A: the folder-admin MCP tools list_folders + create_folder. create_folder authorizes workspace
// ownership (the token `sub`) and appends through the folder command handler's identity-explicit
// overload (the whole flow runs end-to-end against the in-process host; SyncProjectingEventStore folds
// FolderCreated so list_folders reflects it). Proves the MCP → folder pipe on one real create.
public sealed class McpFolderToolsTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private const string ProtocolVersion = "2025-06-18";
    private const string Owner = "test-user-123";        // allowlisted sub (FakeCurrentUser.TestUserId)
    private const string OtherUser = "other-user-456";   // also allowlisted, owns nothing here

    private readonly ApiFactory _factory = factory;

    [Fact]
    public async Task ToolsList_IncludesFolderTools()
    {
        var client = _factory.CreateUnauthenticatedClient();
        var names = (await CallAsync(client, "tools/list", new { }, McpTestTokens.Valid()))
            .GetProperty("tools").EnumerateArray().Select(t => t.GetProperty("name").GetString()).ToList();
        Assert.Contains("create_folder", names);
        Assert.Contains("list_folders", names);
    }

    [Fact]
    public async Task CreateFolder_InOwnedWorkspace_AppearsInListFolders()
    {
        var client = _factory.CreateUnauthenticatedClient();

        var created = await CallToolAsync(client, "create_folder",
            new { workspaceId = WorkspaceId.DefaultValue, name = "Clients" }, McpTestTokens.Valid(Owner));
        Assert.False(IsToolError(created));
        var folderId = ParsePayload(created).GetProperty("folderId").GetString()!;

        var folders = await ListFoldersAsync(client, WorkspaceId.DefaultValue, Owner);
        var folder = folders.Single(f => f.GetProperty("id").GetString() == folderId);
        Assert.Equal("Clients", folder.GetProperty("name").GetString());
        Assert.True(folder.GetProperty("parentId").ValueKind == JsonValueKind.Null);
    }

    [Fact]
    public async Task CreateFolder_WithParent_NestsUnderParent()
    {
        var client = _factory.CreateUnauthenticatedClient();

        var parentId = ParsePayload(await CallToolAsync(client, "create_folder",
            new { workspaceId = WorkspaceId.DefaultValue, name = "Clients" }, McpTestTokens.Valid(Owner)))
            .GetProperty("folderId").GetString()!;
        var childId = ParsePayload(await CallToolAsync(client, "create_folder",
            new { workspaceId = WorkspaceId.DefaultValue, name = "Acme", parentId }, McpTestTokens.Valid(Owner)))
            .GetProperty("folderId").GetString()!;

        var folders = await ListFoldersAsync(client, WorkspaceId.DefaultValue, Owner);
        var child = folders.Single(f => f.GetProperty("id").GetString() == childId);
        Assert.Equal(parentId, child.GetProperty("parentId").GetString());
    }

    [Fact]
    public async Task CreateFolder_InUnownedWorkspace_IsRejected_AndCreatesNothing()
    {
        var client = _factory.CreateUnauthenticatedClient();
        SeedWorkspace(Owner, "ws-private", "Private");

        var result = await CallToolAsync(client, "create_folder",
            new { workspaceId = "ws-private", name = "Intruder" }, McpTestTokens.Valid(OtherUser));

        Assert.True(IsToolError(result));
        // The owner's workspace has no folders — nothing landed.
        var folders = await ListFoldersAsync(client, "ws-private", Owner);
        Assert.Empty(folders);
    }

    [Fact]
    public async Task CreateFolder_BlankName_IsRejected()
    {
        var client = _factory.CreateUnauthenticatedClient();

        var result = await CallToolAsync(client, "create_folder",
            new { workspaceId = WorkspaceId.DefaultValue, name = "   " }, McpTestTokens.Valid(Owner));

        Assert.True(IsToolError(result));
    }

    [Fact]
    public async Task ListFolders_InUnownedWorkspace_IsRejected()
    {
        var client = _factory.CreateUnauthenticatedClient();
        SeedWorkspace(Owner, "ws-private2", "Private");

        var result = await CallToolAsync(client, "list_folders",
            new { workspaceId = "ws-private2" }, McpTestTokens.Valid(OtherUser));

        Assert.True(IsToolError(result));
    }

    // ── Helpers ──────────────────────────────────────────────────────────

    private async Task<List<JsonElement>> ListFoldersAsync(HttpClient client, string workspaceId, string user)
    {
        var listed = await CallToolAsync(client, "list_folders", new { workspaceId }, McpTestTokens.Valid(user));
        Assert.False(IsToolError(listed));
        return ParsePayload(listed).GetProperty("folders").EnumerateArray().Select(f => f.Clone()).ToList();
    }

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
