using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;

namespace Api.Integration;

// 35-E Resource Server: the MCP tool endpoint requires a valid audience-bound HS256 bearer carrying
// the mcp:tools scope. Asserts the 401 challenge (RFC 9728 resource_metadata pointer), the RFC 8707
// confused-deputy guard (wrong-audience rejected), expiry, the scope→403 boundary, the happy path,
// and the protected-resource metadata document.
public sealed class McpResourceServerTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private const string ProtocolVersion = "2025-06-18";
    private const string Workspace = "ws-rs";
    private readonly ApiFactory _factory = factory;

    [Fact]
    public async Task NoToken_Returns401_WithResourceMetadataChallenge()
    {
        var resp = await Post(McpPath(Workspace), bearer: null);

        Assert.Equal(HttpStatusCode.Unauthorized, resp.StatusCode);
        var challenge = resp.Headers.WwwAuthenticate.ToString();
        Assert.Contains("Bearer", challenge, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("resource_metadata", challenge, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task WrongAudienceToken_Returns401()
    {
        // RFC 8707: a token whose aud is not this MCP server is rejected (confused-deputy guard).
        var resp = await Post(McpPath(Workspace), McpTestTokens.WrongAudience());
        Assert.Equal(HttpStatusCode.Unauthorized, resp.StatusCode);
    }

    [Fact]
    public async Task ExpiredToken_Returns401()
    {
        var resp = await Post(McpPath(Workspace), McpTestTokens.Expired(Workspace));
        Assert.Equal(HttpStatusCode.Unauthorized, resp.StatusCode);
    }

    [Fact]
    public async Task TokenWithoutToolScope_Returns403()
    {
        // Authenticated (valid signature/aud/exp) but missing the mcp:tools scope → authorization fails
        // AFTER authentication succeeds → 403, not 401.
        var resp = await Post(McpPath(Workspace), McpTestTokens.MissingScope(Workspace));
        Assert.Equal(HttpStatusCode.Forbidden, resp.StatusCode);
    }

    [Fact]
    public async Task TokenForAnotherWorkspace_DoesNotReturnNotes()
    {
        // A valid token of ours, but minted for a DIFFERENT workspace's resource — the per-workspace
        // half of the aud binding: presenting it on this workspace's path must not yield notes.
        var client = _factory.CreateUnauthenticatedClient();
        var initResp = await PostWith(client, McpPath(Workspace), Envelope("initialize", InitializeParams()), McpTestTokens.Valid("ws-other"));
        // initialize may succeed (no workspace read yet); the tool call must NOT return notes.
        var toolResp = await PostWith(client, McpPath(Workspace),
            Envelope("tools/call", new { name = "list_notes", arguments = new { } }), McpTestTokens.Valid("ws-other"));

        var body = await toolResp.Content.ReadAsStringAsync();
        Assert.DoesNotContain("\"notes\"", body, StringComparison.Ordinal);
    }

    [Fact]
    public async Task ValidToken_ToolCallSucceeds()
    {
        var client = _factory.CreateUnauthenticatedClient();
        var token = McpTestTokens.Valid(Workspace);
        await PostWith(client, McpPath(Workspace), Envelope("initialize", InitializeParams()), token);
        var resp = await PostWith(client, McpPath(Workspace),
            Envelope("tools/call", new { name = "list_notes", arguments = new { } }), token);

        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        var body = await resp.Content.ReadAsStringAsync();
        Assert.Contains("notes", body, StringComparison.Ordinal);
    }

    [Fact]
    public async Task ProtectedResourceMetadata_ReturnsExpectedJson()
    {
        var client = _factory.CreateUnauthenticatedClient();
        // The MCP SDK serves the PRM under the resource path suffix.
        var resp = await client.GetAsync($"/.well-known/oauth-protected-resource{McpPath(Workspace)}");

        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
        var root = doc.RootElement;
        Assert.True(root.TryGetProperty("resource", out _));
        var servers = root.GetProperty("authorization_servers").EnumerateArray().Select(e => e.GetString()).ToList();
        Assert.Contains(McpTestTokens.Issuer, servers);
        var scopes = root.GetProperty("scopes_supported").EnumerateArray().Select(e => e.GetString()).ToList();
        Assert.Contains("mcp:tools", scopes);
    }

    private static string McpPath(string workspaceId) => $"/w/{workspaceId}/mcp";

    private Task<HttpResponseMessage> Post(string path, string? bearer) =>
        PostWith(_factory.CreateUnauthenticatedClient(), path, Envelope("initialize", InitializeParams()), bearer);

    private static async Task<HttpResponseMessage> PostWith(HttpClient client, string path, string json, string? bearer)
    {
        var req = new HttpRequestMessage(HttpMethod.Post, path)
        {
            Content = new StringContent(json, Encoding.UTF8, "application/json")
        };
        req.Headers.Add("MCP-Protocol-Version", ProtocolVersion);
        req.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        req.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("text/event-stream"));
        if (bearer is not null)
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
}
