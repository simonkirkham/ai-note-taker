using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Domain.Notes;
using Domain.Workspaces;
using EventStore.Projections;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace Api.Integration;

// 35-F: single identity-scoped MCP server at /mcp. Drives the real MCP transport (initialize →
// tools/list → tools/call) with raw JSON-RPC envelopes, asserting the parameterized read tools scope
// by (sub, workspaceId) and that a tool call for an unowned workspace is rejected as an MCP error —
// never data. Every authed call attaches a token minted by McpTestTokens (aud = the single /mcp
// resource); the routing-level cases (GET→405, disabled→404, IP allowlist) need no token.
public sealed class McpConnectListTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private const string ProtocolVersion = "2025-06-18";
    private const string WorkspaceA = "ws-alpha";
    private const string WorkspaceB = "ws-beta";
    private const string Owner = "test-user-123";        // allowlisted sub (FakeCurrentUser.TestUserId)
    private const string OtherUser = "other-user-456";   // also allowlisted, owns nothing here

    private static readonly Guid NoteA1 = new("11111111-1111-1111-1111-111111111111");
    private static readonly Guid NoteB1 = new("22222222-2222-2222-2222-222222222222");
    private static readonly Guid NoteA2 = new("33333333-3333-3333-3333-333333333333");
    private static readonly Guid NoteLegacy = new("55555555-5555-5555-5555-555555555555");

    private readonly ApiFactory _factory = factory;

    [Fact]
    public async Task ToolsList_IncludesAllReadTools()
    {
        var client = _factory.CreateUnauthenticatedClient();
        var result = await CallAsync(client, "tools/list", new { }, McpTestTokens.Valid());

        var names = result.GetProperty("tools").EnumerateArray()
            .Select(t => t.GetProperty("name").GetString())
            .ToList();
        Assert.Contains("list_workspaces", names);
        Assert.Contains("list_notes", names);
        Assert.Contains("get_note", names);
        Assert.Contains("search_notes", names);
        Assert.Contains("get_action_items", names);
    }

    [Fact]
    public async Task ListWorkspaces_ReturnsOnlyCallersWorkspaces_PlusDefault()
    {
        SeedWorkspace(Owner, WorkspaceA, "OGI");
        SeedWorkspace(OtherUser, "ws-other-user", "Not Mine");

        var client = _factory.CreateUnauthenticatedClient();
        var result = await CallToolAsync(client, "list_workspaces", new { }, McpTestTokens.Valid(Owner));

        var workspaces = ParsePayload(result).GetProperty("workspaces").EnumerateArray().ToList();
        var ids = workspaces.Select(w => w.GetProperty("id").GetString()).ToList();
        Assert.Contains(WorkspaceId.DefaultValue, ids);
        Assert.Contains(WorkspaceA, ids);
        Assert.DoesNotContain("ws-other-user", ids);
        // "OGI" can be resolved to its id by name.
        Assert.Equal(WorkspaceA, workspaces.Single(w => w.GetProperty("name").GetString() == "OGI").GetProperty("id").GetString());
    }

    [Fact]
    public async Task ListNotes_ScopedToUserAndWorkspace()
    {
        SeedWorkspace(Owner, WorkspaceA, "Alpha");
        SeedCard(Owner, WorkspaceA, NoteA1, "Acme kickoff", new DateOnly(2026, 4, 1), "Discussed the Acme rollout plan");
        SeedCard(Owner, WorkspaceB, NoteB1, "Beta retro", null, "beta content");

        var client = _factory.CreateUnauthenticatedClient();
        var result = await CallToolAsync(client, "list_notes", new { workspaceId = WorkspaceA }, McpTestTokens.Valid(Owner));

        var notes = ParseNotes(result);
        Assert.Single(notes);
        Assert.Equal(NoteA1.ToString(), notes[0].GetProperty("id").GetString());
        Assert.Equal("Acme kickoff", notes[0].GetProperty("title").GetString());
        Assert.Equal("2026-04-01", notes[0].GetProperty("date").GetString());
        Assert.Contains("Acme rollout", notes[0].GetProperty("preview").GetString());
    }

    [Fact]
    public async Task ListNotes_OnDefaultWorkspace_IncludesLegacyNullWorkspaceNotes()
    {
        SeedCard(Owner, null, NoteLegacy, "Pre-workspace note", null, "written before workspaces existed");

        var client = _factory.CreateUnauthenticatedClient();
        var result = await CallToolAsync(client, "list_notes",
            new { workspaceId = WorkspaceId.DefaultValue }, McpTestTokens.Valid(Owner));

        var ids = ParseNotes(result).Select(n => n.GetProperty("id").GetString()).ToList();
        Assert.Contains(NoteLegacy.ToString(), ids);
    }

    [Fact]
    public async Task Reads_AreUserScoped_TwoUsersShareDefaultWorkspace()
    {
        // Both users have a note in the default workspace; each sees only their own.
        var mine = new Guid("aaaaaaaa-0000-0000-0000-000000000001");
        var theirs = new Guid("bbbbbbbb-0000-0000-0000-000000000002");
        SeedCard(Owner, WorkspaceId.DefaultValue, mine, "My default note", null, "mine");
        SeedCard(OtherUser, WorkspaceId.DefaultValue, theirs, "Their default note", null, "theirs");

        var client = _factory.CreateUnauthenticatedClient();
        var result = await CallToolAsync(client, "list_notes",
            new { workspaceId = WorkspaceId.DefaultValue }, McpTestTokens.Valid(Owner));

        var ids = ParseNotes(result).Select(n => n.GetProperty("id").GetString()).ToList();
        Assert.Contains(mine.ToString(), ids);
        Assert.DoesNotContain(theirs.ToString(), ids);
    }

    [Fact]
    public async Task ToolCall_ForUnownedWorkspace_IsRejected_NoData()
    {
        // A note exists in WorkspaceA owned by Owner; OtherUser does not own WorkspaceA → MCP error.
        SeedWorkspace(Owner, WorkspaceA, "Alpha");
        SeedCard(Owner, WorkspaceA, NoteA2, "Secret note", null, "alpha secret");

        var client = _factory.CreateUnauthenticatedClient();
        var result = await CallToolAsync(client, "list_notes", new { workspaceId = WorkspaceA }, McpTestTokens.Valid(OtherUser));

        Assert.True(IsToolError(result));
        Assert.DoesNotContain(NoteA2.ToString(), RawText(result));
    }

    [Fact]
    public async Task SubThatOwnsNothing_OnlyDefaultWorks()
    {
        SeedWorkspace(Owner, WorkspaceA, "Alpha");
        var client = _factory.CreateUnauthenticatedClient();
        var token = McpTestTokens.Valid(OtherUser);

        // The default workspace is always permitted.
        var defaultResult = await CallToolAsync(client, "list_notes",
            new { workspaceId = WorkspaceId.DefaultValue }, token);
        Assert.False(IsToolError(defaultResult));

        // Any non-default workspace they do not own is rejected.
        var rejected = await CallToolAsync(client, "list_notes", new { workspaceId = WorkspaceA }, token);
        Assert.True(IsToolError(rejected));
    }

    [Fact]
    public async Task GetNote_RejectsNoteOutsideTheNamedWorkspace()
    {
        SeedWorkspace(Owner, WorkspaceA, "Alpha");
        // Note lives in the default workspace, not WorkspaceA.
        var noteId = new Guid("cccccccc-0000-0000-0000-000000000003");
        SeedDetail(Owner, WorkspaceId.DefaultValue, noteId, "Default-workspace note", "body");

        var client = _factory.CreateUnauthenticatedClient();
        var result = await CallToolAsync(client, "get_note",
            new { workspaceId = WorkspaceA, noteId = noteId.ToString() }, McpTestTokens.Valid(Owner));

        Assert.True(IsToolError(result));
        Assert.DoesNotContain("Default-workspace note", RawText(result));
    }

    [Fact]
    public async Task GetNote_HappyPath_ReturnsContentAndActions()
    {
        var noteId = new Guid("dddddddd-0000-0000-0000-000000000004");
        SeedDetail(Owner, WorkspaceId.DefaultValue, noteId, "Roadmap review", "We agreed the Q3 plan");

        var client = _factory.CreateUnauthenticatedClient();
        var result = await CallToolAsync(client, "get_note",
            new { workspaceId = WorkspaceId.DefaultValue, noteId = noteId.ToString() }, McpTestTokens.Valid(Owner));

        Assert.False(IsToolError(result));
        var payload = ParsePayload(result);
        Assert.Equal(noteId.ToString(), payload.GetProperty("id").GetString());
        Assert.Equal("Roadmap review", payload.GetProperty("title").GetString());
        Assert.Contains("Q3 plan", payload.GetProperty("content").GetString());
    }

    [Fact]
    public async Task GetNote_ExposesTranscript()
    {
        var noteId = new Guid("dddddddd-0000-0000-0000-000000000014");
        SeedDetail(Owner, WorkspaceId.DefaultValue, noteId, "Recorded standup", "my own notes",
            transcriptText: "Speaker 1: welcome everyone to the standup", transcriptIsDiarized: true);

        var client = _factory.CreateUnauthenticatedClient();
        var result = await CallToolAsync(client, "get_note",
            new { workspaceId = WorkspaceId.DefaultValue, noteId = noteId.ToString() }, McpTestTokens.Valid(Owner));

        Assert.False(IsToolError(result));
        var payload = ParsePayload(result);
        Assert.Contains("welcome everyone", payload.GetProperty("transcriptText").GetString());
        Assert.True(payload.GetProperty("transcriptIsDiarized").GetBoolean());
    }

    [Fact]
    public async Task GetNote_WithoutTranscript_ReturnsNullTranscript()
    {
        var noteId = new Guid("dddddddd-0000-0000-0000-000000000015");
        SeedDetail(Owner, WorkspaceId.DefaultValue, noteId, "Typed only", "no meeting was recorded");

        var client = _factory.CreateUnauthenticatedClient();
        var result = await CallToolAsync(client, "get_note",
            new { workspaceId = WorkspaceId.DefaultValue, noteId = noteId.ToString() }, McpTestTokens.Valid(Owner));

        Assert.False(IsToolError(result));
        var payload = ParsePayload(result);
        Assert.Equal(JsonValueKind.Null, payload.GetProperty("transcriptText").ValueKind);
        Assert.False(payload.GetProperty("transcriptIsDiarized").GetBoolean());
        Assert.False(payload.GetProperty("hasTranscript").GetBoolean());
    }

    [Fact]
    public async Task GetNote_WithIncludeTranscriptFalse_OmitsTheTranscript()
    {
        var noteId = new Guid("dddddddd-0000-0000-0000-000000000016");
        SeedDetail(Owner, WorkspaceId.DefaultValue, noteId, "Recorded standup", "my own notes",
            transcriptText: "Speaker 1: welcome everyone to the standup", transcriptIsDiarized: true);

        var client = _factory.CreateUnauthenticatedClient();
        var result = await CallToolAsync(client, "get_note",
            new { workspaceId = WorkspaceId.DefaultValue, noteId = noteId.ToString(), includeTranscript = false },
            McpTestTokens.Valid(Owner));

        Assert.False(IsToolError(result));
        var payload = ParsePayload(result);
        Assert.Equal(JsonValueKind.Null, payload.GetProperty("transcriptText").ValueKind);
        Assert.DoesNotContain("welcome everyone", RawText(result));
        Assert.Contains("my own notes", payload.GetProperty("content").GetString());
        // The whole point of opting out is to decide later whether the big call is worth it,
        // so the cheap response must still say a transcript is there to come back for.
        Assert.True(payload.GetProperty("hasTranscript").GetBoolean());
    }

    [Fact]
    public async Task GetNote_ForAnotherUsersNote_InSharedDefaultWorkspace_IsRejected()
    {
        var noteId = new Guid("dddddddd-0000-0000-0000-000000000017");
        SeedDetail(OtherUser, WorkspaceId.DefaultValue, noteId, "Their standup", "their notes",
            transcriptText: "Speaker 1: confidential salary discussion");

        var client = _factory.CreateUnauthenticatedClient();
        var result = await CallToolAsync(client, "get_note",
            new { workspaceId = WorkspaceId.DefaultValue, noteId = noteId.ToString() }, McpTestTokens.Valid(Owner));

        Assert.True(IsToolError(result));
        Assert.DoesNotContain("confidential", RawText(result));
    }

    [Fact]
    public async Task SearchNotes_HappyPath_ReturnsRankedMatch()
    {
        var noteId = new Guid("eeeeeeee-0000-0000-0000-000000000005");
        SeedSearchView(Owner, WorkspaceId.DefaultValue, noteId, "Budget planning", "the annual budget review");

        var client = _factory.CreateUnauthenticatedClient();
        var result = await CallToolAsync(client, "search_notes",
            new { workspaceId = WorkspaceId.DefaultValue, query = "budget" }, McpTestTokens.Valid(Owner));

        Assert.False(IsToolError(result));
        var ids = ParsePayload(result).GetProperty("results").EnumerateArray()
            .Select(r => r.GetProperty("id").GetString()).ToList();
        Assert.Contains(noteId.ToString(), ids);
    }

    [Fact]
    public async Task GetActionItems_ReturnsOpenItemsForUserAndWorkspace()
    {
        var noteId = new Guid("ffffffff-0000-0000-0000-000000000006");
        SeedTodo(Owner, WorkspaceId.DefaultValue, "open-1", noteId, "Send the deck", completed: false);
        SeedTodo(Owner, WorkspaceId.DefaultValue, "done-1", noteId, "Already done", completed: true);

        var client = _factory.CreateUnauthenticatedClient();
        var result = await CallToolAsync(client, "get_action_items",
            new { workspaceId = WorkspaceId.DefaultValue }, McpTestTokens.Valid(Owner));

        Assert.False(IsToolError(result));
        var descriptions = ParsePayload(result).GetProperty("actionItems").EnumerateArray()
            .Select(i => i.GetProperty("description").GetString()).ToList();
        Assert.Contains("Send the deck", descriptions);
        Assert.DoesNotContain("Already done", descriptions);
    }

    // ── Routing-level (no token) ─────────────────────────────────────────

    [Fact]
    public async Task WhenMcpDisabled_Endpoint_Returns404()
    {
        using var factory = _factory.WithWebHostBuilder(b => b.ConfigureAppConfiguration(c =>
            c.AddInMemoryCollection(new Dictionary<string, string?> { ["MCP_ENABLED"] = "false" })));

        var resp = await factory.CreateClient()
            .SendAsync(NewPost("/mcp", Envelope("initialize", InitializeParams())));

        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
    }

    [Fact]
    public async Task Get_OnMcpEndpoint_Returns405()
    {
        var client = _factory.CreateUnauthenticatedClient();
        var req = new HttpRequestMessage(HttpMethod.Get, "/mcp");
        req.Headers.Add("MCP-Protocol-Version", ProtocolVersion);
        req.Headers.Accept.ParseAdd("application/json, text/event-stream");

        var resp = await client.SendAsync(req);

        Assert.Equal(HttpStatusCode.MethodNotAllowed, resp.StatusCode);
    }

    [Fact]
    public async Task UnsupportedProtocolVersion_Returns400()
    {
        // A valid bearer so the request reaches the SDK transport handler (which enforces the
        // protocol-version 400); without it RequireAuthorization would short-circuit to 401 first.
        var client = _factory.CreateUnauthenticatedClient();
        var req = NewPost("/mcp", Envelope("initialize", InitializeParams()), McpTestTokens.Valid());
        req.Headers.Remove("MCP-Protocol-Version");
        req.Headers.Add("MCP-Protocol-Version", "1999-01-01");

        var resp = await client.SendAsync(req);

        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
    }

    [Fact]
    public async Task SourceIpOutsideAllowlist_Returns403()
    {
        using var factory = WithAllowlist("203.0.113.0/24");
        var req = NewPost("/mcp", Envelope("initialize", InitializeParams()));
        req.Headers.Add(TestSourceIpStartupFilter.Header, "198.51.100.7");

        var resp = await factory.CreateClient().SendAsync(req);

        Assert.Equal(HttpStatusCode.Forbidden, resp.StatusCode);
    }

    [Fact]
    public async Task SourceIpInsideAllowlist_IsNotBlocked()
    {
        using var factory = WithAllowlist("203.0.113.0/24");
        var req = NewPost("/mcp", Envelope("initialize", InitializeParams()));
        req.Headers.Add(TestSourceIpStartupFilter.Header, "203.0.113.42");

        var resp = await factory.CreateClient().SendAsync(req);

        Assert.NotEqual(HttpStatusCode.Forbidden, resp.StatusCode);
    }

    // ── Helpers ──────────────────────────────────────────────────────────

    private WebApplicationFactory<Program> WithAllowlist(string cidrs) =>
        _factory.WithWebHostBuilder(b =>
        {
            b.ConfigureAppConfiguration(c =>
                c.AddInMemoryCollection(new Dictionary<string, string?> { ["MCP_ALLOWED_CIDRS"] = cidrs }));
            b.ConfigureServices(s => s.AddSingleton<IStartupFilter, TestSourceIpStartupFilter>());
        });

    private void SeedWorkspace(string userId, string workspaceId, string name)
    {
        var store = _factory.Services.GetRequiredService<IWorkspaceListStore>();
        store.UpsertAsync(new WorkspaceListView(
            new WorkspaceId(workspaceId), name, DateTimeOffset.UtcNow, userId)).GetAwaiter().GetResult();
    }

    private void SeedCard(string userId, string? workspaceId, Guid noteId, string title, DateOnly? date, string content)
    {
        var store = (InMemoryNoteCardListStore)_factory.Services.GetRequiredService<INoteCardListStore>();
        store.UpsertAsync(new NoteCardView(
            new Domain.Notes.NoteId(noteId), title, content, Array.Empty<NoteCardActionItem>(),
            date, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow, Deleted: false,
            Tags: null, FolderId: null, UserId: userId, WorkspaceId: workspaceId)).GetAwaiter().GetResult();
    }

    private void SeedDetail(string userId, string? workspaceId, Guid noteId, string title, string content,
        string? transcriptText = null, bool transcriptIsDiarized = false)
    {
        var store = _factory.Services.GetRequiredService<INoteDetailStore>();
        store.UpsertAsync(new NoteDetailView(
            new Domain.Notes.NoteId(noteId), title, content, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow,
            UserId: userId, WorkspaceId: workspaceId,
            TranscriptText: transcriptText, TranscriptIsDiarized: transcriptIsDiarized)).GetAwaiter().GetResult();
    }

    private void SeedSearchView(string userId, string? workspaceId, Guid noteId, string title, string body)
    {
        var store = _factory.Services.GetRequiredService<INoteSearchViewStore>();
        store.UpsertAsync(new NoteSearchView(
            new Domain.Notes.NoteId(noteId), userId, title, body, FinalNotesText: "",
            Tags: Array.Empty<string>(), ActionItemsText: "", Deleted: false,
            LastModifiedAt: DateTimeOffset.UtcNow, WorkspaceId: workspaceId)).GetAwaiter().GetResult();
    }

    private void SeedTodo(string userId, string? workspaceId, string itemId, Guid noteId, string description, bool completed)
    {
        var store = _factory.Services.GetRequiredService<ITodoListStore>();
        store.PutAsync(new TodoItem(
            itemId, noteId.ToString(), "Note", "action", description, DateTimeOffset.UtcNow,
            completed ? DateTimeOffset.UtcNow : null, userId, workspaceId)).GetAwaiter().GetResult();
    }

    // The inner JSON the tool returns as its single text content block.
    private static JsonElement ParsePayload(JsonElement toolResult)
    {
        using var doc = JsonDocument.Parse(RawText(toolResult));
        return doc.RootElement.Clone();
    }

    private static List<JsonElement> ParseNotes(JsonElement toolResult) =>
        ParsePayload(toolResult).GetProperty("notes").EnumerateArray().Select(e => e.Clone()).ToList();

    private static string RawText(JsonElement toolResult) =>
        toolResult.GetProperty("content").EnumerateArray()
            .First(c => c.GetProperty("type").GetString() == "text")
            .GetProperty("text").GetString()!;

    // A tool that throws (ownership rejection, not-found) comes back as a tool result with isError=true.
    private static bool IsToolError(JsonElement toolResult) =>
        toolResult.TryGetProperty("isError", out var e) && e.ValueKind == JsonValueKind.True;

    private async Task<JsonElement> CallToolAsync(HttpClient client, string toolName, object arguments, string token) =>
        await CallAsync(client, "tools/call", new { name = toolName, arguments }, token);

    // POSTs initialize then the target method (both with the bearer); returns the parsed JSON-RPC
    // `result` of the target.
    private async Task<JsonElement> CallAsync(HttpClient client, string method, object @params, string token)
    {
        await PostAsync(client, Envelope("initialize", InitializeParams()), token);
        var resp = await PostAsync(client, Envelope(method, @params), token);
        resp.EnsureSuccessStatusCode();
        return await ReadResultAsync(resp);
    }

    private static async Task<HttpResponseMessage> PostAsync(HttpClient client, string json, string? bearer = null) =>
        await client.SendAsync(NewPost("/mcp", json, bearer));

    private static HttpRequestMessage NewPost(string path, string json, string? bearer = null)
    {
        var req = new HttpRequestMessage(HttpMethod.Post, path)
        {
            Content = new StringContent(json, Encoding.UTF8, "application/json")
        };
        req.Headers.Add("MCP-Protocol-Version", ProtocolVersion);
        req.Headers.Accept.Clear();
        req.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        req.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("text/event-stream"));
        if (bearer is not null)
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", bearer);
        return req;
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
        {
            if (line.StartsWith("data:"))
                sb.Append(line.AsSpan("data:".Length).Trim());
        }
        return sb.ToString();
    }
}

internal sealed class TestSourceIpStartupFilter : IStartupFilter
{
    public const string Header = "X-Test-Source-Ip";

    public Action<IApplicationBuilder> Configure(Action<IApplicationBuilder> next) => app =>
    {
        app.Use(async (context, nextMiddleware) =>
        {
            var ip = context.Request.Headers[Header].ToString();
            if (!string.IsNullOrEmpty(ip) && IPAddress.TryParse(ip, out var parsed))
                context.Connection.RemoteIpAddress = parsed;
            await nextMiddleware();
        });
        next(app);
    };
}
