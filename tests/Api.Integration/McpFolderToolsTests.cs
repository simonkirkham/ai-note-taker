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

    // ── 47-B: move_note_to_folder ─────────────────────────────────────────

    [Fact]
    public async Task ToolsList_IncludesMoveNoteToFolder()
    {
        var client = _factory.CreateUnauthenticatedClient();
        var names = (await CallAsync(client, "tools/list", new { }, McpTestTokens.Valid()))
            .GetProperty("tools").EnumerateArray().Select(t => t.GetProperty("name").GetString()).ToList();
        Assert.Contains("move_note_to_folder", names);
    }

    [Fact]
    public async Task MoveNoteToFolder_FilesNoteIntoFolder()
    {
        var client = _factory.CreateUnauthenticatedClient();
        var noteId = await CreateNoteAsync(client, Owner);
        var folderId = await CreateFolderAsync(client, WorkspaceId.DefaultValue, "Clients", Owner);

        var moved = await CallToolAsync(client, "move_note_to_folder",
            new { workspaceId = WorkspaceId.DefaultValue, noteId, folderId }, McpTestTokens.Valid(Owner));

        Assert.False(IsToolError(moved), RawText(moved));
        Assert.Equal(folderId, NoteFolderId(noteId));
    }

    [Fact]
    public async Task MoveNoteToFolder_ReFile_MovesToNewFolder()
    {
        var client = _factory.CreateUnauthenticatedClient();
        var noteId = await CreateNoteAsync(client, Owner);
        var folderA = await CreateFolderAsync(client, WorkspaceId.DefaultValue, "A", Owner);
        var folderB = await CreateFolderAsync(client, WorkspaceId.DefaultValue, "B", Owner);
        await CallToolAsync(client, "move_note_to_folder",
            new { workspaceId = WorkspaceId.DefaultValue, noteId, folderId = folderA }, McpTestTokens.Valid(Owner));

        await CallToolAsync(client, "move_note_to_folder",
            new { workspaceId = WorkspaceId.DefaultValue, noteId, folderId = folderB }, McpTestTokens.Valid(Owner));

        Assert.Equal(folderB, NoteFolderId(noteId));
    }

    [Fact]
    public async Task MoveNoteToFolder_ForeignNote_IsRejected_AndDoesNotMove()
    {
        var client = _factory.CreateUnauthenticatedClient();
        var ownersNote = await CreateNoteAsync(client, Owner);
        var intrudersFolder = await CreateFolderAsync(client, WorkspaceId.DefaultValue, "Intruder", OtherUser);

        var result = await CallToolAsync(client, "move_note_to_folder",
            new { workspaceId = WorkspaceId.DefaultValue, noteId = ownersNote, folderId = intrudersFolder },
            McpTestTokens.Valid(OtherUser));

        Assert.True(IsToolError(result));
        Assert.Null(NoteFolderId(ownersNote));
    }

    [Fact]
    public async Task MoveNoteToFolder_IntoUnownedFolder_IsRejected_AndDoesNotMove()
    {
        var client = _factory.CreateUnauthenticatedClient();
        var note = await CreateNoteAsync(client, Owner);
        var otherUsersFolder = await CreateFolderAsync(client, WorkspaceId.DefaultValue, "Theirs", OtherUser);

        var result = await CallToolAsync(client, "move_note_to_folder",
            new { workspaceId = WorkspaceId.DefaultValue, noteId = note, folderId = otherUsersFolder },
            McpTestTokens.Valid(Owner));

        Assert.True(IsToolError(result));
        Assert.Null(NoteFolderId(note));
    }

    // ── 47-C: rename_folder + delete_folder ───────────────────────────────

    [Fact]
    public async Task ToolsList_IncludesRenameAndDeleteFolder()
    {
        var client = _factory.CreateUnauthenticatedClient();
        var names = (await CallAsync(client, "tools/list", new { }, McpTestTokens.Valid()))
            .GetProperty("tools").EnumerateArray().Select(t => t.GetProperty("name").GetString()).ToList();
        Assert.Contains("rename_folder", names);
        Assert.Contains("delete_folder", names);
    }

    [Fact]
    public async Task RenameFolder_ChangesName()
    {
        var client = _factory.CreateUnauthenticatedClient();
        var folderId = await CreateFolderAsync(client, WorkspaceId.DefaultValue, "Clients", Owner);

        var renamed = await CallToolAsync(client, "rename_folder",
            new { workspaceId = WorkspaceId.DefaultValue, folderId, name = "Key Clients" }, McpTestTokens.Valid(Owner));

        Assert.False(IsToolError(renamed), RawText(renamed));
        var folders = await ListFoldersAsync(client, WorkspaceId.DefaultValue, Owner);
        Assert.Equal("Key Clients", folders.Single(f => f.GetProperty("id").GetString() == folderId).GetProperty("name").GetString());
    }

    [Fact]
    public async Task RenameFolder_BlankName_IsRejected()
    {
        var client = _factory.CreateUnauthenticatedClient();
        var folderId = await CreateFolderAsync(client, WorkspaceId.DefaultValue, "Clients", Owner);

        var result = await CallToolAsync(client, "rename_folder",
            new { workspaceId = WorkspaceId.DefaultValue, folderId, name = "   " }, McpTestTokens.Valid(Owner));

        Assert.True(IsToolError(result));
    }

    [Fact]
    public async Task RenameFolder_ForeignFolder_IsRejected_AndNameUnchanged()
    {
        var client = _factory.CreateUnauthenticatedClient();
        await CreateFolderAsync(client, WorkspaceId.DefaultValue, "Mine", Owner);   // caller owns a folder (exact BUG-41 shape)
        var folderId = await CreateFolderAsync(client, WorkspaceId.DefaultValue, "Owned", OtherUser);

        var result = await CallToolAsync(client, "rename_folder",
            new { workspaceId = WorkspaceId.DefaultValue, folderId, name = "Hijacked" }, McpTestTokens.Valid(Owner));

        Assert.True(IsToolError(result));
        var folders = await ListFoldersAsync(client, WorkspaceId.DefaultValue, OtherUser);
        Assert.Equal("Owned", folders.Single(f => f.GetProperty("id").GetString() == folderId).GetProperty("name").GetString());
    }

    [Fact]
    public async Task DeleteFolder_RemovesFolderAndSubfolders_AndUnfilesNotes()
    {
        var client = _factory.CreateUnauthenticatedClient();
        var parent = await CreateFolderAsync(client, WorkspaceId.DefaultValue, "Clients", Owner);
        var child = ParsePayload(await CallToolAsync(client, "create_folder",
            new { workspaceId = WorkspaceId.DefaultValue, name = "Acme", parentId = parent }, McpTestTokens.Valid(Owner)))
            .GetProperty("folderId").GetString()!;
        var noteId = await CreateNoteAsync(client, Owner);
        await CallToolAsync(client, "move_note_to_folder",
            new { workspaceId = WorkspaceId.DefaultValue, noteId, folderId = parent }, McpTestTokens.Valid(Owner));

        var deleted = await CallToolAsync(client, "delete_folder",
            new { workspaceId = WorkspaceId.DefaultValue, folderId = parent }, McpTestTokens.Valid(Owner));

        Assert.False(IsToolError(deleted), RawText(deleted));
        var folders = await ListFoldersAsync(client, WorkspaceId.DefaultValue, Owner);
        Assert.DoesNotContain(folders, f => f.GetProperty("id").GetString() == parent);
        Assert.DoesNotContain(folders, f => f.GetProperty("id").GetString() == child);
        Assert.Null(NoteFolderId(noteId));   // unfiled, not deleted
    }

    [Fact]
    public async Task DeleteFolder_ForeignFolder_IsRejected_AndFolderRemains()
    {
        var client = _factory.CreateUnauthenticatedClient();
        await CreateFolderAsync(client, WorkspaceId.DefaultValue, "Mine", Owner);   // caller owns a folder (exact BUG-41 shape)
        var folderId = await CreateFolderAsync(client, WorkspaceId.DefaultValue, "Owned", OtherUser);

        var result = await CallToolAsync(client, "delete_folder",
            new { workspaceId = WorkspaceId.DefaultValue, folderId }, McpTestTokens.Valid(Owner));

        Assert.True(IsToolError(result));
        var folders = await ListFoldersAsync(client, WorkspaceId.DefaultValue, OtherUser);
        Assert.Contains(folders, f => f.GetProperty("id").GetString() == folderId);
    }

    // ── Helpers ──────────────────────────────────────────────────────────

    private async Task<string> CreateNoteAsync(HttpClient client, string user)
    {
        var created = await CallToolAsync(client, "create_note",
            new { workspaceId = WorkspaceId.DefaultValue, title = "Note", content = "body" }, McpTestTokens.Valid(user));
        Assert.False(IsToolError(created), RawText(created));
        return ParsePayload(created).GetProperty("noteId").GetString()!;
    }

    private async Task<string> CreateFolderAsync(HttpClient client, string workspaceId, string name, string user)
    {
        var created = await CallToolAsync(client, "create_folder",
            new { workspaceId, name }, McpTestTokens.Valid(user));
        Assert.False(IsToolError(created), RawText(created));
        return ParsePayload(created).GetProperty("folderId").GetString()!;
    }

    // The note's folder is card state — read it back through the card projection (no MCP read exposes it).
    private string? NoteFolderId(string noteId)
    {
        var cards = _factory.Services.GetRequiredService<INoteCardListStore>();
        var card = cards.QueryAllAsync().GetAwaiter().GetResult().Single(c => c.NoteId.Value.ToString() == noteId);
        return card.FolderId?.Value.ToString();
    }

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
