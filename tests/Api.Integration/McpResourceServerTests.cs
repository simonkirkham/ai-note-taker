using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

namespace Api.Integration;

// 35-E/35-F Resource Server: the single /mcp endpoint requires a valid audience-bound HS256 bearer
// (aud = {issuer}/mcp) carrying the mcp:tools scope. Asserts the 401 challenge (RFC 9728
// resource_metadata pointer), the RFC 8707 confused-deputy guard (wrong-audience rejected), expiry,
// the scope→403 boundary, the happy path, and the protected-resource metadata document.
public sealed class McpResourceServerTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private const string ProtocolVersion = "2025-06-18";
    private const string McpPath = "/mcp";
    private readonly ApiFactory _factory = factory;

    [Fact]
    public async Task NoToken_Returns401_WithResourceMetadataChallenge()
    {
        var resp = await Post(bearer: null);

        Assert.Equal(HttpStatusCode.Unauthorized, resp.StatusCode);
        var challenge = resp.Headers.WwwAuthenticate.ToString();
        Assert.Contains("Bearer", challenge, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("resource_metadata", challenge, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task WrongAudienceToken_Returns401()
    {
        // RFC 8707: a token whose aud is not this MCP server is rejected (confused-deputy guard).
        var resp = await Post(McpTestTokens.WrongAudience());
        Assert.Equal(HttpStatusCode.Unauthorized, resp.StatusCode);
    }

    [Fact]
    public async Task ExpiredToken_Returns401()
    {
        var resp = await Post(McpTestTokens.Expired());
        Assert.Equal(HttpStatusCode.Unauthorized, resp.StatusCode);
    }

    [Fact]
    public async Task TokenWithoutToolScope_Returns403()
    {
        // Authenticated (valid signature/aud/exp) but missing the mcp:tools scope → authorization fails
        // AFTER authentication succeeds → 403, not 401.
        var resp = await Post(McpTestTokens.MissingScope());
        Assert.Equal(HttpStatusCode.Forbidden, resp.StatusCode);
    }

    [Fact]
    public async Task ValidToken_ToolCallSucceeds()
    {
        var client = _factory.CreateUnauthenticatedClient();
        var token = McpTestTokens.Valid();
        await PostWith(client, Envelope("initialize", InitializeParams()), token);
        var resp = await PostWith(client,
            Envelope("tools/call", new { name = "list_notes", arguments = new { workspaceId = Domain.Workspaces.WorkspaceId.DefaultValue } }), token);

        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        var body = await resp.Content.ReadAsStringAsync();
        Assert.Contains("notes", body, StringComparison.Ordinal);
    }

    [Fact]
    public async Task ProtectedResourceMetadata_ReturnsExpectedJson()
    {
        var client = _factory.CreateUnauthenticatedClient();
        // The MCP SDK serves the PRM under the resource path suffix (the single /mcp resource).
        var resp = await client.GetAsync($"/.well-known/oauth-protected-resource{McpPath}");

        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
        var root = doc.RootElement;
        Assert.Equal(McpTestTokens.Resource, root.GetProperty("resource").GetString());
        var servers = root.GetProperty("authorization_servers").EnumerateArray().Select(e => e.GetString()).ToList();
        Assert.Contains(McpTestTokens.Issuer, servers);
        var scopes = root.GetProperty("scopes_supported").EnumerateArray().Select(e => e.GetString()).ToList();
        Assert.Contains("mcp:tools", scopes);
    }

    private Task<HttpResponseMessage> Post(string? bearer) =>
        PostWith(_factory.CreateUnauthenticatedClient(), Envelope("initialize", InitializeParams()), bearer);

    private static async Task<HttpResponseMessage> PostWith(HttpClient client, string json, string? bearer)
    {
        var req = new HttpRequestMessage(HttpMethod.Post, McpPath)
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
