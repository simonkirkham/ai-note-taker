using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Domain.Folders;
using Domain.Notes;
using Domain.Workspaces;
using EventStore.Projections;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace Api.Integration;

// 35-A: read-only remote MCP server at /w/{workspaceId}/mcp (no auth this slice). Drives the real
// MCP transport (initialize → tools/list → tools/call) with raw JSON-RPC envelopes, asserting the
// list_notes tool returns the route workspace's note cards and never another workspace's.
public sealed class McpConnectListTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private const string ProtocolVersion = "2025-06-18";
    private const string WorkspaceA = "ws-alpha";
    private const string WorkspaceB = "ws-beta";

    private static readonly Guid NoteA1 = new("11111111-1111-1111-1111-111111111111");
    private static readonly Guid NoteB1 = new("22222222-2222-2222-2222-222222222222");
    private static readonly Guid NoteA2 = new("33333333-3333-3333-3333-333333333333");
    private static readonly Guid NoteB2 = new("44444444-4444-4444-4444-444444444444");
    private static readonly Guid NoteLegacy = new("55555555-5555-5555-5555-555555555555");

    private readonly ApiFactory _factory = factory;

    [Fact]
    public async Task ToolsList_IncludesListNotes()
    {
        var client = NewClient();

        var result = await CallAsync(client, McpPath(WorkspaceA), "tools/list", new { });

        var names = result.GetProperty("tools").EnumerateArray()
            .Select(t => t.GetProperty("name").GetString())
            .ToList();
        Assert.Contains("list_notes", names);
    }

    [Fact]
    public async Task ListNotes_ReturnsOnlyRouteWorkspaceNotes()
    {
        SeedCard(WorkspaceA, NoteA1, "Acme kickoff", new DateOnly(2026, 4, 1), "Discussed the Acme rollout plan");
        SeedCard(WorkspaceB, NoteB1, "Beta retro", new DateOnly(2026, 4, 2), "Beta team retrospective notes");

        var client = NewClient();
        var result = await CallToolAsync(client, McpPath(WorkspaceA), "list_notes");

        var notes = ParseListNotes(result);
        Assert.Single(notes);
        var note = notes[0];
        Assert.Equal(NoteA1.ToString(), note.GetProperty("id").GetString());
        Assert.Equal("Acme kickoff", note.GetProperty("title").GetString());
        Assert.Equal("2026-04-01", note.GetProperty("date").GetString());
        Assert.Contains("Acme rollout", note.GetProperty("preview").GetString());
    }

    [Fact]
    public async Task ListNotes_NeverReturnsOtherWorkspaceNotes()
    {
        SeedCard(WorkspaceA, NoteA2, "Workspace A note", null, "alpha content");
        SeedCard(WorkspaceB, NoteB2, "Workspace B note", null, "beta content");

        var client = NewClient();
        var result = await CallToolAsync(client, McpPath(WorkspaceB), "list_notes");

        var ids = ParseListNotes(result).Select(n => n.GetProperty("id").GetString()).ToList();
        Assert.Contains(NoteB2.ToString(), ids);
        Assert.DoesNotContain(NoteA2.ToString(), ids);
    }

    [Fact]
    public async Task ListNotes_OnDefaultWorkspace_IncludesLegacyNullWorkspaceNotes()
    {
        SeedCard(null, NoteLegacy, "Pre-workspace note", null, "written before workspaces existed");

        var client = NewClient();
        var result = await CallToolAsync(client, McpPath(WorkspaceId.DefaultValue), "list_notes");

        var ids = ParseListNotes(result).Select(n => n.GetProperty("id").GetString()).ToList();
        Assert.Contains(NoteLegacy.ToString(), ids);
    }

    [Fact]
    public async Task Get_OnMcpEndpoint_Returns405()
    {
        var client = _factory.CreateUnauthenticatedClient();
        var req = new HttpRequestMessage(HttpMethod.Get, McpPath(WorkspaceA));
        req.Headers.Add("MCP-Protocol-Version", ProtocolVersion);
        req.Headers.Accept.ParseAdd("application/json, text/event-stream");

        var resp = await client.SendAsync(req);

        Assert.Equal(HttpStatusCode.MethodNotAllowed, resp.StatusCode);
    }

    [Fact]
    public async Task UnsupportedProtocolVersion_Returns400()
    {
        var client = _factory.CreateUnauthenticatedClient();
        var req = NewPost(McpPath(WorkspaceA), Envelope("initialize", InitializeParams()));
        req.Headers.Remove("MCP-Protocol-Version");
        req.Headers.Add("MCP-Protocol-Version", "1999-01-01");

        var resp = await client.SendAsync(req);

        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
    }

    [Fact]
    public async Task SourceIpOutsideAllowlist_Returns403()
    {
        using var factory = WithAllowlist("203.0.113.0/24");
        var req = NewPost(McpPath(WorkspaceA), Envelope("initialize", InitializeParams()));
        req.Headers.Add(TestSourceIpStartupFilter.Header, "198.51.100.7");

        var resp = await factory.CreateClient().SendAsync(req);

        Assert.Equal(HttpStatusCode.Forbidden, resp.StatusCode);
    }

    [Fact]
    public async Task SourceIpInsideAllowlist_IsNotBlocked()
    {
        using var factory = WithAllowlist("203.0.113.0/24");
        var req = NewPost(McpPath(WorkspaceA), Envelope("initialize", InitializeParams()));
        req.Headers.Add(TestSourceIpStartupFilter.Header, "203.0.113.42");

        var resp = await factory.CreateClient().SendAsync(req);

        Assert.NotEqual(HttpStatusCode.Forbidden, resp.StatusCode);
    }

    // ── Helpers ──────────────────────────────────────────────────────────

    private static string McpPath(string workspaceId) => $"/w/{workspaceId}/mcp";

    // Sets MCP_ALLOWED_CIDRS via config (no process-global env mutation) and installs a startup
    // filter that maps a test header onto Connection.RemoteIpAddress — standing in for the
    // AWS-computed sourceIp the Lambda host sets in prod, which the allowlist reads.
    private WebApplicationFactory<Program> WithAllowlist(string cidrs) =>
        _factory.WithWebHostBuilder(b =>
        {
            b.ConfigureAppConfiguration(c =>
                c.AddInMemoryCollection(new Dictionary<string, string?> { ["MCP_ALLOWED_CIDRS"] = cidrs }));
            b.ConfigureServices(s => s.AddSingleton<IStartupFilter, TestSourceIpStartupFilter>());
        });

    private HttpClient NewClient()
    {
        var client = _factory.CreateUnauthenticatedClient();
        client.DefaultRequestHeaders.Add("X-Test-No-Prefix", "1");
        return client;
    }

    private void SeedCard(string? workspaceId, Guid noteId, string title, DateOnly? date, string content)
    {
        var store = (InMemoryNoteCardListStore)_factory.Services.GetRequiredService<INoteCardListStore>();
        store.UpsertAsync(new NoteCardView(
            new NoteId(noteId),
            title,
            content,
            Array.Empty<NoteCardActionItem>(),
            date,
            DateTimeOffset.UtcNow,
            DateTimeOffset.UtcNow,
            Deleted: false,
            Tags: null,
            FolderId: null,
            UserId: "any-user",
            WorkspaceId: workspaceId)).GetAwaiter().GetResult();
    }

    private static List<JsonElement> ParseListNotes(JsonElement toolResult)
    {
        var text = toolResult.GetProperty("content").EnumerateArray()
            .First(c => c.GetProperty("type").GetString() == "text")
            .GetProperty("text").GetString()!;
        using var doc = JsonDocument.Parse(text);
        return doc.RootElement.GetProperty("notes").EnumerateArray()
            .Select(e => e.Clone()).ToList();
    }

    private async Task<JsonElement> CallToolAsync(HttpClient client, string path, string toolName)
    {
        return await CallAsync(client, path, "tools/call", new { name = toolName, arguments = new { } });
    }

    // POSTs initialize then the target method; returns the parsed JSON-RPC `result` of the target.
    private async Task<JsonElement> CallAsync(HttpClient client, string path, string method, object @params)
    {
        await PostAsync(client, path, Envelope("initialize", InitializeParams()));
        var resp = await PostAsync(client, path, Envelope(method, @params));
        resp.EnsureSuccessStatusCode();
        return await ReadResultAsync(resp);
    }

    private static async Task<HttpResponseMessage> PostAsync(HttpClient client, string path, string json) =>
        await client.SendAsync(NewPost(path, json));

    private static HttpRequestMessage NewPost(string path, string json)
    {
        var req = new HttpRequestMessage(HttpMethod.Post, path)
        {
            Content = new StringContent(json, Encoding.UTF8, "application/json")
        };
        req.Headers.Add("MCP-Protocol-Version", ProtocolVersion);
        req.Headers.Accept.Clear();
        req.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        req.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("text/event-stream"));
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

    // Streamable HTTP may return the JSON-RPC body either as application/json or as an
    // SSE `data:` frame depending on negotiation; parse both.
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
