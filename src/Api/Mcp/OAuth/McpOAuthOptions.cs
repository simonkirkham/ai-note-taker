using Microsoft.Extensions.Configuration;

namespace Api.Mcp.OAuth;

// 35-E: configuration for the MCP OAuth 2.1 broker (Resource Server + thin Authorization Server).
// Every value is sourced from IConfiguration (Lambda env in prod; in-memory override in tests) so a
// test never mutates process-global state, and the issuer/resource host can differ per environment.
public sealed class McpOAuthOptions
{
    // The execute-api host that is BOTH our token issuer and the AS base. Exact-match, no trailing
    // slash (RFC 8414 requires the issuer to equal the metadata host). Defaulted to the prod host;
    // override per environment via MCP_OAUTH_ISSUER.
    public required string Issuer { get; init; }

    // The single pre-registered Claude client id (pasted into Cowork's Advanced settings).
    public required string ClientId { get; init; }

    // The ONLY redirect_uri the AS will honour for the Claude client (RFC: exact match, no wildcard).
    public required string ClaudeRedirectUri { get; init; }

    // The redirect_uri WE present to Google for our own upstream sign-in leg. Must be registered in
    // Google Cloud Console (owner one-time step). Built from the issuer host by default.
    public required string GoogleRedirectUri { get; init; }

    // The Google OAuth client id WE use for the upstream sign-in leg (the same Phase 8 client). On
    // config so the endpoint never reads process-global env directly.
    public required string GoogleClientId { get; init; }

    // The set of Google subs permitted to mint an MCP token (ALLOWED_USER_SUBS). On config so a test
    // can override it without mutating process-global env. EMPTY = the broker denies everyone (fail
    // closed): minting a long-lived connector token is higher-stakes than serving a browser request.
    public required IReadOnlySet<string> AllowedUserSubs { get; init; }

    // The OAuth scope a minted access token must carry to call a tool.
    public const string ToolScope = "mcp:tools";

    // The HS256 signing key (raw secret value, fetched from Secrets Manager by name at boot). Empty
    // when unconfigured — the AS/RS endpoints then refuse to operate (503/closed) rather than mint or
    // accept unsigned tokens. NEVER logged.
    public required string SigningSecret { get; init; }

    // Access-token lifetime. Short by design (RFC 9700) — Claude refreshes via the refresh token.
    public TimeSpan AccessTokenLifetime { get; init; } = TimeSpan.FromHours(1);

    // Our own authorization code lifetime (single-use, ≤60s — MCP/OAuth spec).
    public TimeSpan AuthCodeLifetime { get; init; } = TimeSpan.FromSeconds(60);

    // Max lifetime of a refresh token: after this it can no longer be exchanged (re-checked on use),
    // so a leaked token cannot be replayed indefinitely. The owner re-runs Google sign-in to renew.
    public TimeSpan RefreshTokenLifetime { get; init; } = TimeSpan.FromDays(30);

    // 35-F: the single MCP resource URI (RFC 8707 audience). There is one /mcp endpoint for every
    // workspace, so the token `aud` is bound to this one value; per-workspace access is enforced per
    // tool call against the token `sub`, not by the audience.
    public string ResourceUri => $"{Issuer}/mcp";

    public bool IsConfigured => !string.IsNullOrEmpty(SigningSecret) && !string.IsNullOrEmpty(ClientId);

    public static McpOAuthOptions FromConfiguration(IConfiguration config, string signingSecret)
    {
        // Default the issuer to the prod execute-api host; every environment overrides it.
        var issuer = (config["MCP_OAUTH_ISSUER"] ?? "https://z5a9ffln2j.execute-api.eu-west-2.amazonaws.com")
            .TrimEnd('/');
        return new McpOAuthOptions
        {
            Issuer = issuer,
            ClientId = config["MCP_OAUTH_CLIENT_ID"] ?? "",
            ClaudeRedirectUri = config["MCP_OAUTH_CLAUDE_REDIRECT_URI"] ?? "https://claude.ai/api/mcp/auth_callback",
            GoogleRedirectUri = config["MCP_OAUTH_GOOGLE_REDIRECT_URI"] ?? $"{issuer}/oauth/google/callback",
            GoogleClientId = config["GOOGLE_CLIENT_ID"] ?? "",
            AllowedUserSubs = (config["ALLOWED_USER_SUBS"] ?? "")
                .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .ToHashSet(StringComparer.Ordinal),
            SigningSecret = signingSecret,
        };
    }
}
