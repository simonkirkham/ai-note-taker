using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Web;
using Api.Auth;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace Api.Integration;

// 35-E Authorization Server broker: the AS metadata document, the /oauth/authorize validations
// (client_id, exact redirect_uri, PKCE S256 required), and /oauth/token (happy path mints an
// aud-bound token that validates at the RS; reused/expired code rejected; wrong verifier rejected;
// single-use). The Google leg is mocked via FakeGoogleOAuthClient returning an id_token with an
// allowlisted sub.
public sealed class McpAuthorizationServerTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private const string AllowedSub = "test-user-123";
    private readonly ApiFactory _factory = factory;

    private static string Resource => McpTestTokens.Resource;
    private const string ClaudeRedirect = "https://claude.ai/api/mcp/auth_callback";

    [Fact]
    public async Task AsMetadata_HasExactIssuerAndS256()
    {
        var client = NoRedirectClient();
        var resp = await client.GetAsync("/.well-known/oauth-authorization-server");

        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
        var root = doc.RootElement;
        Assert.Equal(McpTestTokens.Issuer, root.GetProperty("issuer").GetString());
        Assert.Equal($"{McpTestTokens.Issuer}/oauth/authorize", root.GetProperty("authorization_endpoint").GetString());
        Assert.Equal($"{McpTestTokens.Issuer}/oauth/token", root.GetProperty("token_endpoint").GetString());
        Assert.Contains("S256", root.GetProperty("code_challenge_methods_supported").EnumerateArray().Select(e => e.GetString()));
        Assert.Contains("authorization_code", root.GetProperty("grant_types_supported").EnumerateArray().Select(e => e.GetString()));
    }

    [Theory]
    [InlineData("not-the-client")]
    [InlineData("")]
    public async Task Authorize_WrongOrEmptyClientId_IsRejected(string clientId)
    {
        // CRITICAL-1c: an empty client_id must never match an empty configured ClientId.
        var resp = await Authorize(NoRedirectClient(), clientId, redirectUri: ClaudeRedirect,
            challenge: Challenge(out _), method: "S256");
        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
    }

    [Fact]
    public async Task Authorize_RedirectUriMismatch_IsRejected()
    {
        var resp = await Authorize(NoRedirectClient(), clientId: McpTestTokens.ClientId,
            redirectUri: "https://evil.example.com/callback", challenge: Challenge(out _), method: "S256");
        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
    }

    [Fact]
    public async Task Authorize_PlainPkce_IsRejectedViaErrorRedirect()
    {
        // A "plain" challenge method must be refused (no downgrade). Rejected via an error redirect
        // back to the registered Claude redirect (not a 400, since client+redirect validated).
        var resp = await Authorize(NoRedirectClient(), clientId: McpTestTokens.ClientId, redirectUri: ClaudeRedirect,
            challenge: "abc", method: "plain");
        Assert.Equal(HttpStatusCode.Redirect, resp.StatusCode);
        Assert.Contains("error=invalid_request", resp.Headers.Location!.Query);
        Assert.StartsWith(ClaudeRedirect, resp.Headers.Location!.GetLeftPart(UriPartial.Path));
    }

    [Fact]
    public async Task Authorize_MissingPkce_IsRejected()
    {
        var resp = await Authorize(NoRedirectClient(), clientId: McpTestTokens.ClientId, redirectUri: ClaudeRedirect,
            challenge: "", method: "");
        Assert.Equal(HttpStatusCode.Redirect, resp.StatusCode);
        Assert.Contains("error=invalid_request", resp.Headers.Location!.Query);
    }

    [Fact]
    public async Task Authorize_ResourceOnForeignHost_IsRejected()
    {
        // LOW-9: the requested resource must live on the issuer host. A foreign-host resource (an
        // attacker-chosen aud) is rejected via invalid_target — never stamped into the issued token.
        var client = NoRedirectClient();
        var qs = HttpUtility.ParseQueryString(string.Empty);
        qs["client_id"] = McpTestTokens.ClientId;
        qs["redirect_uri"] = ClaudeRedirect;
        qs["response_type"] = "code";
        qs["code_challenge"] = ToS256(NewVerifier());
        qs["code_challenge_method"] = "S256";
        qs["state"] = "s";
        qs["resource"] = "https://evil.example.com/w/ws-as/mcp";
        var resp = await client.GetAsync($"/oauth/authorize?{qs}");

        Assert.Equal(HttpStatusCode.Redirect, resp.StatusCode);
        Assert.Contains("error=invalid_target", resp.Headers.Location!.Query);
    }

    [Fact]
    public async Task Authorize_ValidRequest_RedirectsToGoogleWithOwnPkce()
    {
        var resp = await Authorize(NoRedirectClient(), clientId: McpTestTokens.ClientId, redirectUri: ClaudeRedirect,
            challenge: Challenge(out _), method: "S256");
        Assert.Equal(HttpStatusCode.Redirect, resp.StatusCode);
        var loc = resp.Headers.Location!;
        Assert.StartsWith("https://accounts.google.com/", loc.ToString());
        var q = HttpUtility.ParseQueryString(loc.Query);
        Assert.Equal("S256", q["code_challenge_method"]);
        Assert.False(string.IsNullOrEmpty(q["state"]));        // our google_state
        Assert.False(string.IsNullOrEmpty(q["code_challenge"])); // our google challenge, not Claude's
    }

    [Fact]
    public async Task FullFlow_TokenMintsAudBoundTokenThatValidatesAtRs()
    {
        SetGoogleSub(AllowedSub);
        var verifier = NewVerifier();
        var (code, _) = await RunAuthorizeAndCallback(verifier);
        Assert.NotNull(code);

        var token = await ExchangeCode(code!, verifier);
        Assert.NotNull(token);

        // The minted token validates at the Resource Server and the tool call succeeds.
        var client = _factory.CreateUnauthenticatedClient();
        var resp = await McpPost(client, token!);
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
    }

    [Fact]
    public async Task Token_ReusedCode_IsRejected()
    {
        SetGoogleSub(AllowedSub);
        var verifier = NewVerifier();
        var (code, _) = await RunAuthorizeAndCallback(verifier);

        var first = await ExchangeCode(code!, verifier);
        Assert.NotNull(first);
        // Second exchange of the same single-use code must fail.
        var secondResp = await RawExchangeCode(code!, verifier);
        Assert.Equal(HttpStatusCode.BadRequest, secondResp.StatusCode);
    }

    [Fact]
    public async Task Token_WrongVerifier_IsRejected()
    {
        SetGoogleSub(AllowedSub);
        var verifier = NewVerifier();
        var (code, _) = await RunAuthorizeAndCallback(verifier);

        var resp = await RawExchangeCode(code!, NewVerifier()); // different verifier
        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public async Task Token_MissingClientIdOrRedirectUri_IsRejected(string blank)
    {
        // HIGH-7: client_id AND redirect_uri are REQUIRED with exact equality — no optional skip.
        SetGoogleSub(AllowedSub);
        var verifier = NewVerifier();
        var (code, _) = await RunAuthorizeAndCallback(verifier);

        var client = NoRedirectClient();
        var missingClient = await client.PostAsync("/oauth/token", new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["grant_type"] = "authorization_code",
            ["code"] = code!,
            ["redirect_uri"] = ClaudeRedirect,
            ["client_id"] = blank,
            ["code_verifier"] = verifier,
        }));
        Assert.Equal(HttpStatusCode.BadRequest, missingClient.StatusCode);
    }

    [Fact]
    public async Task GoogleCallback_NonAllowlistedUser_DeniesViaErrorRedirect()
    {
        SetGoogleSub("intruder-sub-not-allowed");
        var verifier = NewVerifier();
        var (code, callbackResp) = await RunAuthorizeAndCallback(verifier);

        Assert.Null(code);
        Assert.Equal(HttpStatusCode.Redirect, callbackResp.StatusCode);
        Assert.Contains("error=access_denied", callbackResp.Headers.Location!.Query);
    }

    [Fact]
    public async Task Refresh_ExpiredRefreshToken_IsRejected()
    {
        // IMPORTANT-6: a refresh token past its absolute max lifetime can no longer be exchanged.
        // Seed an already-expired refresh token directly, then attempt grant_type=refresh_token.
        var store = _factory.Services.GetRequiredService<Api.Mcp.OAuth.IMcpRefreshTokenStore>();
        var expired = new Api.Mcp.OAuth.McpRefreshToken(
            "expired-rt", McpTestTokens.ClientId, Resource, AllowedSub,
            DateTimeOffset.UtcNow.AddMinutes(-1));
        await store.PutAsync(expired);

        var client = NoRedirectClient();
        var resp = await client.PostAsync("/oauth/token", new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["grant_type"] = "refresh_token",
            ["refresh_token"] = "expired-rt",
        }));
        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
    }

    [Fact]
    public async Task Refresh_ValidRefreshToken_MintsNewAccessToken()
    {
        // A live refresh token (within max lifetime) re-mints an access token that validates at the RS.
        var store = _factory.Services.GetRequiredService<Api.Mcp.OAuth.IMcpRefreshTokenStore>();
        var live = new Api.Mcp.OAuth.McpRefreshToken(
            "live-rt", McpTestTokens.ClientId, Resource, AllowedSub,
            DateTimeOffset.UtcNow.AddDays(10));
        await store.PutAsync(live);

        var client = NoRedirectClient();
        var resp = await client.PostAsync("/oauth/token", new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["grant_type"] = "refresh_token",
            ["refresh_token"] = "live-rt",
        }));
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
        Assert.False(string.IsNullOrEmpty(doc.RootElement.GetProperty("access_token").GetString()));
    }

    [Fact]
    public async Task GoogleCallback_EmptyAllowlist_DeniesEveryone()
    {
        // HIGH-3 fail-closed: an empty ALLOWED_USER_SUBS denies the mint path entirely. The options
        // singleton is built from IConfiguration at host-build time (before ConfigureAppConfiguration
        // layers apply), so replace the registered McpOAuthOptions with an empty-allowlist copy via
        // ConfigureTestServices (which runs after BuildApp) — no process-global env mutation.
        using var factory = _factory.WithWebHostBuilder(b => b.ConfigureTestServices(s =>
        {
            s.RemoveAll<Api.Mcp.OAuth.McpOAuthOptions>();
            s.AddSingleton(new Api.Mcp.OAuth.McpOAuthOptions
            {
                Issuer = McpTestTokens.Issuer,
                ClientId = McpTestTokens.ClientId,
                ClaudeRedirectUri = ClaudeRedirect,
                GoogleRedirectUri = $"{McpTestTokens.Issuer}/oauth/google/callback",
                GoogleClientId = "test-client-id",
                AllowedUserSubs = new HashSet<string>(),
                SigningSecret = McpTestTokens.SigningSecret,
            });
        }));
        factory.Services.GetRequiredService<FakeGoogleOAuthClient>().ExchangeResult =
            FakeGoogleOAuthClient.Success(UnsignedJwtWithSub(AllowedSub), refreshToken: null);

        var client = factory.CreateClient(new Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
        var verifier = NewVerifier();
        var authorizeResp = await Authorize(client, McpTestTokens.ClientId, ClaudeRedirect, ToS256(verifier), "S256", state: "s");
        var googleState = HttpUtility.ParseQueryString(authorizeResp.Headers.Location!.Query)["state"]!;
        var callbackResp = await client.GetAsync($"/oauth/google/callback?code=g&state={Uri.EscapeDataString(googleState)}");

        Assert.Equal(HttpStatusCode.Redirect, callbackResp.StatusCode);
        Assert.Contains("error=access_denied", callbackResp.Headers.Location!.Query);
    }

    // ── Flow helpers ─────────────────────────────────────────────────────

    // Runs /authorize, follows the Google redirect's state, then drives /oauth/google/callback.
    // Returns OUR issued code (null when the callback denied) + the callback response.
    private async Task<(string? Code, HttpResponseMessage CallbackResp)> RunAuthorizeAndCallback(string verifier)
    {
        var client = NoRedirectClient();
        var challenge = ToS256(verifier);
        var authorizeResp = await Authorize(client, McpTestTokens.ClientId, ClaudeRedirect, challenge, "S256", state: "claude-state-1");
        Assert.Equal(HttpStatusCode.Redirect, authorizeResp.StatusCode);
        var googleState = HttpUtility.ParseQueryString(authorizeResp.Headers.Location!.Query)["state"]!;

        var callbackResp = await client.GetAsync($"/oauth/google/callback?code=google-code&state={Uri.EscapeDataString(googleState)}");
        if (callbackResp.StatusCode != HttpStatusCode.Redirect)
            return (null, callbackResp);
        var loc = callbackResp.Headers.Location!;
        var code = HttpUtility.ParseQueryString(loc.Query)["code"];
        return (code, callbackResp);
    }

    private Task<HttpResponseMessage> Authorize(HttpClient client, string clientId, string redirectUri, string challenge, string method, string state = "s")
    {
        var qs = HttpUtility.ParseQueryString(string.Empty);
        qs["client_id"] = clientId;
        qs["redirect_uri"] = redirectUri;
        qs["response_type"] = "code";
        qs["code_challenge"] = challenge;
        qs["code_challenge_method"] = method;
        qs["state"] = state;
        qs["resource"] = Resource;
        return client.GetAsync($"/oauth/authorize?{qs}");
    }

    private async Task<string?> ExchangeCode(string code, string verifier)
    {
        var resp = await RawExchangeCode(code, verifier);
        if (resp.StatusCode != HttpStatusCode.OK) return null;
        using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
        return doc.RootElement.GetProperty("access_token").GetString();
    }

    private Task<HttpResponseMessage> RawExchangeCode(string code, string verifier)
    {
        var client = NoRedirectClient();
        var form = new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["grant_type"] = "authorization_code",
            ["code"] = code,
            ["redirect_uri"] = ClaudeRedirect,
            ["client_id"] = McpTestTokens.ClientId,
            ["code_verifier"] = verifier,
        });
        return client.PostAsync("/oauth/token", form);
    }

    private static async Task<HttpResponseMessage> McpPost(HttpClient client, string bearer)
    {
        async Task<HttpResponseMessage> Send(string json)
        {
            var req = new HttpRequestMessage(HttpMethod.Post, "/mcp")
            {
                Content = new StringContent(json, Encoding.UTF8, "application/json")
            };
            req.Headers.Add("MCP-Protocol-Version", "2025-06-18");
            req.Headers.Accept.ParseAdd("application/json, text/event-stream");
            req.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", bearer);
            return await client.SendAsync(req);
        }
        await Send(JsonSerializer.Serialize(new { jsonrpc = "2.0", id = 1, method = "initialize", @params = new { protocolVersion = "2025-06-18", capabilities = new { }, clientInfo = new { name = "t", version = "1" } } }));
        return await Send(JsonSerializer.Serialize(new { jsonrpc = "2.0", id = 2, method = "tools/call", @params = new { name = "list_notes", arguments = new { workspaceId = Domain.Workspaces.WorkspaceId.DefaultValue } } }));
    }

    // Set the FakeGoogleOAuthClient's exchange to return an (unsigned) id_token carrying the given sub.
    private void SetGoogleSub(string sub)
    {
        var fake = _factory.Services.GetRequiredService<FakeGoogleOAuthClient>();
        fake.ExchangeResult = FakeGoogleOAuthClient.Success(UnsignedJwtWithSub(sub), refreshToken: null);
    }

    // The SAME underlying server (shared singleton stores) with auto-redirect off, so the whole
    // authorize → callback → token flow hits one in-memory auth-code store.
    private HttpClient NoRedirectClient() =>
        _factory.CreateClient(new Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false
        });

    private static string Challenge(out string verifier)
    {
        verifier = NewVerifier();
        return ToS256(verifier);
    }

    private static string NewVerifier()
    {
        Span<byte> bytes = stackalloc byte[32];
        RandomNumberGenerator.Fill(bytes);
        return Base64UrlEncoder.Encode(bytes.ToArray());
    }

    private static string ToS256(string verifier) =>
        Base64UrlEncoder.Encode(SHA256.HashData(Encoding.ASCII.GetBytes(verifier)));

    // An UNSIGNED JWT (header.payload.) — JwtClaims decodes the payload without verifying the
    // signature, which is exactly how the production code reads sub from Google's TLS-fetched id_token.
    private static string UnsignedJwtWithSub(string sub)
    {
        string Part(object o) => Base64UrlEncoder.Encode(JsonSerializer.SerializeToUtf8Bytes(o));
        return $"{Part(new { alg = "none", typ = "JWT" })}.{Part(new { sub, email = "owner@example.com" })}.";
    }
}
