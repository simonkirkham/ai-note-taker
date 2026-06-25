using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Api.Auth;
using Microsoft.IdentityModel.Tokens;

namespace Api.Mcp.OAuth;

// 35-E thin Authorization Server (Command Lambda). Brokers Google sign-in upstream and mints OUR OWN
// audience-bound (RFC 8707) access tokens — Claude never sees a Google token, and the RS never accepts
// one. Endpoints:
//   GET  /.well-known/oauth-authorization-server  → AS metadata (RFC 8414)
//   GET  /oauth/authorize                          → validate client+redirect+PKCE, redirect to Google
//   GET  /oauth/google/callback                    → exchange Google code, authenticate user, issue OUR code
//   POST /oauth/token                              → verify code + PKCE, mint HS256 token (+ refresh)
public static class McpOAuthEndpoints
{
    private const string GoogleAuthUrl = "https://accounts.google.com/o/oauth2/v2/auth";

    public static void MapMcpOAuthEndpoints(this WebApplication app)
    {
        app.MapGet("/.well-known/oauth-authorization-server", (McpOAuthOptions options) =>
            Results.Json(new Dictionary<string, object?>
            {
                ["issuer"] = options.Issuer,
                ["authorization_endpoint"] = $"{options.Issuer}/oauth/authorize",
                ["token_endpoint"] = $"{options.Issuer}/oauth/token",
                ["response_types_supported"] = new[] { "code" },
                ["grant_types_supported"] = new[] { "authorization_code", "refresh_token" },
                ["token_endpoint_auth_methods_supported"] = new[] { "none" },
                ["code_challenge_methods_supported"] = new[] { "S256" },
                ["scopes_supported"] = new[] { McpOAuthOptions.ToolScope },
            })).AllowAnonymous();

        app.MapGet("/oauth/authorize", async (
            HttpContext ctx, McpOAuthOptions options, IMcpAuthCodeStore store, TimeProvider time,
            ILoggerFactory loggerFactory, CancellationToken ct) =>
        {
            var log = loggerFactory.CreateLogger("Api.Mcp.OAuth.Authorize");
            var q = ctx.Request.Query;
            var clientId = q["client_id"].ToString();
            var redirectUri = q["redirect_uri"].ToString();
            var responseType = q["response_type"].ToString();
            var codeChallenge = q["code_challenge"].ToString();
            var codeChallengeMethod = q["code_challenge_method"].ToString();
            var state = q["state"].ToString();
            var resource = q["resource"].ToString();

            if (!options.IsConfigured)
            {
                log.LogError("MCP OAuth not configured (missing signing secret/client id)");
                return Results.StatusCode(503);
            }
            // Validate the client. An empty or unknown client_id, or a redirect_uri that is not an EXACT
            // match for the one pre-registered value, is rejected WITHOUT redirecting (open-redirect
            // guard). The empty check is explicit so an empty configured ClientId can never match an
            // empty request (IsConfigured already 503s on empty config, but defence-in-depth).
            if (string.IsNullOrEmpty(clientId) || clientId != options.ClientId)
            {
                log.LogWarning("MCP authorize rejected: unknown client_id");
                return Results.BadRequest(new { error = "unauthorized_client" });
            }
            if (!string.Equals(redirectUri, options.ClaudeRedirectUri, StringComparison.Ordinal))
            {
                log.LogWarning("MCP authorize rejected: redirect_uri mismatch");
                return Results.BadRequest(new { error = "invalid_request", error_description = "redirect_uri mismatch" });
            }
            if (!string.Equals(responseType, "code", StringComparison.Ordinal))
                return Redirect(redirectUri, state, "unsupported_response_type");
            // PKCE S256 is REQUIRED. Missing challenge or a "plain" method is rejected — no downgrade.
            if (string.IsNullOrEmpty(codeChallenge) || !string.Equals(codeChallengeMethod, "S256", StringComparison.Ordinal))
                return Redirect(redirectUri, state, "invalid_request");

            // 35-F: the requested resource must equal the single MCP resource `{issuer}/mcp` EXACTLY —
            // never stamp an attacker-chosen `aud` into the issued code/token. There is no per-workspace
            // resource any more; workspace access is authorized per tool call against `sub`.
            if (!string.Equals(resource, options.ResourceUri, StringComparison.Ordinal))
                return Redirect(redirectUri, state, "invalid_target");

            // Start OUR upstream Google leg with our OWN PKCE + state (never reuse Claude's).
            var googleVerifier = McpTokenService.NewOpaqueToken();
            var googleChallenge = Base64UrlEncoder.Encode(SHA256.HashData(Encoding.ASCII.GetBytes(googleVerifier)));
            var googleState = McpTokenService.NewOpaqueToken();

            await store.PutPendingAsync(new McpPendingAuth(
                googleState, googleVerifier, clientId, redirectUri, codeChallenge, state, resource),
                time.GetUtcNow(), ct).ConfigureAwait(false);

            var googleUrl = $"{GoogleAuthUrl}?{ToQuery(new Dictionary<string, string>
            {
                ["client_id"] = options.GoogleClientId,
                ["redirect_uri"] = options.GoogleRedirectUri,
                ["response_type"] = "code",
                ["scope"] = "openid email",
                ["code_challenge"] = googleChallenge,
                ["code_challenge_method"] = "S256",
                ["state"] = googleState,
                ["access_type"] = "online",
                ["prompt"] = "select_account",
            })}";
            return Results.Redirect(googleUrl);
        }).AllowAnonymous();

        app.MapGet("/oauth/google/callback", async (
            HttpContext ctx, McpOAuthOptions options, IMcpAuthCodeStore store, IGoogleOAuthClient google,
            TimeProvider time, ILoggerFactory loggerFactory, CancellationToken ct) =>
        {
            var log = loggerFactory.CreateLogger("Api.Mcp.OAuth.GoogleCallback");
            var code = ctx.Request.Query["code"].ToString();
            var googleState = ctx.Request.Query["state"].ToString();

            if (string.IsNullOrEmpty(code) || string.IsNullOrEmpty(googleState))
                return Results.BadRequest(new { error = "invalid_request" });

            var pending = await store.TakePendingAsync(googleState, time.GetUtcNow(), ct).ConfigureAwait(false);
            if (pending is null)
            {
                log.LogWarning("MCP google callback: unknown/expired state");
                return Results.BadRequest(new { error = "invalid_request" });
            }

            GoogleTokenResult result;
            try
            {
                result = await google.ExchangeAuthCodeAsync(code, pending.GoogleCodeVerifier, options.GoogleRedirectUri, ct)
                    .ConfigureAwait(false);
            }
            catch (Exception ex)
            {
                log.LogError(ex, "MCP google callback: code exchange threw");
                return Redirect(pending.RedirectUri, pending.State, "server_error");
            }
            if (!result.Success || result.Tokens?.IdToken is null)
            {
                log.LogWarning("MCP google callback: code exchange failed ({Status})", result.StatusCode);
                return Redirect(pending.RedirectUri, pending.State, "access_denied");
            }

            // Resolve identity from the Google id_token. `sub` is the durable user id; the allowlist
            // (ALLOWED_USER_SUBS) is enforced so only the permitted owner can complete the broker flow.
            var sub = JwtClaims.TryGetClaim(result.Tokens.IdToken, "sub");
            if (string.IsNullOrEmpty(sub))
                return Redirect(pending.RedirectUri, pending.State, "access_denied");
            if (!IsAllowedUser(sub, options))
            {
                log.LogWarning("MCP google callback: user not on allowlist");
                return Redirect(pending.RedirectUri, pending.State, "access_denied");
            }
            // 35-F: the token is no longer bound to a workspace at mint time — the single /mcp resource
            // serves every workspace, and per-workspace access is authorized per tool call against
            // `sub`. The allowlist above is the mint-time gate; ownership is enforced at read time.

            // Issue OUR single-use authorization code, bound to the client, redirect, PKCE challenge,
            // resource and resolved user. Redirect back to Claude with the code + Claude's original state.
            var ourCode = McpTokenService.NewOpaqueToken();
            await store.PutCodeAsync(new McpAuthCode(
                ourCode, pending.ClientId, pending.RedirectUri, pending.CodeChallenge, pending.Resource, sub),
                time.GetUtcNow(), ct).ConfigureAwait(false);

            return Redirect(pending.RedirectUri, pending.State, error: null, code: ourCode);
        }).AllowAnonymous();

        app.MapPost("/oauth/token", async (
            HttpContext ctx, McpOAuthOptions options, IMcpAuthCodeStore codeStore,
            IMcpRefreshTokenStore refreshStore, McpTokenService tokens, TimeProvider time,
            ILoggerFactory loggerFactory, CancellationToken ct) =>
        {
            var log = loggerFactory.CreateLogger("Api.Mcp.OAuth.Token");
            if (!options.IsConfigured)
                return Results.StatusCode(503);

            var form = await ctx.Request.ReadFormAsync(ct).ConfigureAwait(false);
            var grantType = form["grant_type"].ToString();

            if (grantType == "authorization_code")
                return await ExchangeCodeAsync(form, options, codeStore, refreshStore, tokens, time, log, ct).ConfigureAwait(false);
            if (grantType == "refresh_token")
                return await RefreshAsync(form, options, refreshStore, tokens, time, log, ct).ConfigureAwait(false);

            return TokenError("unsupported_grant_type");
        }).AllowAnonymous();
    }

    private static async Task<IResult> ExchangeCodeAsync(
        IFormCollection form, McpOAuthOptions options, IMcpAuthCodeStore codeStore,
        IMcpRefreshTokenStore refreshStore, McpTokenService tokens, TimeProvider time, ILogger log, CancellationToken ct)
    {
        var code = form["code"].ToString();
        var redirectUri = form["redirect_uri"].ToString();
        var clientId = form["client_id"].ToString();
        var codeVerifier = form["code_verifier"].ToString();

        // client_id, redirect_uri, code and code_verifier are all REQUIRED — no optional skips.
        if (string.IsNullOrEmpty(code) || string.IsNullOrEmpty(codeVerifier)
            || string.IsNullOrEmpty(clientId) || string.IsNullOrEmpty(redirectUri))
            return TokenError("invalid_request");

        // Single-use: TakeCodeAsync reads-and-deletes. A reused or expired code returns null.
        var stored = await codeStore.TakeCodeAsync(code, time.GetUtcNow(), ct).ConfigureAwait(false);
        if (stored is null)
        {
            log.LogWarning("MCP token: invalid/reused/expired authorization code");
            return TokenError("invalid_grant");
        }
        // Re-bind every parameter the code was issued against — exact equality, unconditionally.
        if (!string.Equals(stored.ClientId, clientId, StringComparison.Ordinal))
            return TokenError("invalid_grant");
        if (!string.Equals(stored.RedirectUri, redirectUri, StringComparison.Ordinal))
            return TokenError("invalid_grant");
        if (!McpTokenService.VerifyPkceS256(codeVerifier, stored.CodeChallenge))
        {
            log.LogWarning("MCP token: PKCE verification failed");
            return TokenError("invalid_grant");
        }

        return await IssueTokensAsync(
            options, refreshStore, tokens, time, stored.UserId, stored.Resource, stored.ClientId, ct)
            .ConfigureAwait(false);
    }

    private static async Task<IResult> RefreshAsync(
        IFormCollection form, McpOAuthOptions options, IMcpRefreshTokenStore refreshStore,
        McpTokenService tokens, TimeProvider time, ILogger log, CancellationToken ct)
    {
        var presented = form["refresh_token"].ToString();
        if (string.IsNullOrEmpty(presented))
            return TokenError("invalid_request");

        // Rotating: TakeAsync reads-and-deletes the presented token; an expired one also returns null.
        var stored = await refreshStore.TakeAsync(presented, time.GetUtcNow(), ct).ConfigureAwait(false);
        if (stored is null)
        {
            log.LogWarning("MCP token: invalid/expired/rotated refresh token");
            return TokenError("invalid_grant");
        }

        // Preserve the ORIGINAL absolute expiry across rotation — a refresh cannot extend the cap.
        return await IssueTokensAsync(
            options, refreshStore, tokens, time, stored.UserId, stored.Resource, stored.ClientId, ct,
            existingExpiry: stored.ExpiresAt).ConfigureAwait(false);
    }

    private static async Task<IResult> IssueTokensAsync(
        McpOAuthOptions options, IMcpRefreshTokenStore refreshStore, McpTokenService tokens, TimeProvider time,
        string userId, string resource, string clientId, CancellationToken ct,
        DateTimeOffset? existingExpiry = null)
    {
        var accessToken = tokens.CreateAccessToken(userId, resource);
        var refreshToken = McpTokenService.NewOpaqueToken();
        var expiresAt = existingExpiry ?? time.GetUtcNow().Add(options.RefreshTokenLifetime);
        await refreshStore.PutAsync(new McpRefreshToken(refreshToken, clientId, resource, userId, expiresAt), ct)
            .ConfigureAwait(false);

        return Results.Json(new Dictionary<string, object?>
        {
            ["access_token"] = accessToken,
            ["token_type"] = "Bearer",
            ["expires_in"] = (int)options.AccessTokenLifetime.TotalSeconds,
            ["scope"] = McpOAuthOptions.ToolScope,
            ["refresh_token"] = refreshToken,
        });
    }

    // Build the redirect back to Claude: append code OR error plus the original state, preserving any
    // existing query on the redirect uri.
    private static IResult Redirect(string redirectUri, string? state, string? error, string? code = null)
    {
        var sep = redirectUri.Contains('?') ? "&" : "?";
        var parts = new List<string>();
        if (!string.IsNullOrEmpty(code)) parts.Add($"code={Uri.EscapeDataString(code)}");
        if (!string.IsNullOrEmpty(error)) parts.Add($"error={Uri.EscapeDataString(error)}");
        if (!string.IsNullOrEmpty(state)) parts.Add($"state={Uri.EscapeDataString(state)}");
        return Results.Redirect($"{redirectUri}{sep}{string.Join("&", parts)}");
    }

    private static IResult TokenError(string error) =>
        Results.Json(new { error }, statusCode: 400);

    // Fail CLOSED: an unset/empty allowlist denies the mint path entirely. Minting a long-lived token
    // for the MCP connector is a far higher-stakes action than serving a browser request, so — unlike
    // AllowlistMiddleware — the broker never falls open. The owner's sub MUST be allow-listed.
    private static bool IsAllowedUser(string sub, McpOAuthOptions options) =>
        options.AllowedUserSubs.Count > 0 && options.AllowedUserSubs.Contains(sub);

    private static string ToQuery(IDictionary<string, string> values) =>
        string.Join("&", values.Select(kv => $"{Uri.EscapeDataString(kv.Key)}={Uri.EscapeDataString(kv.Value)}"));
}
