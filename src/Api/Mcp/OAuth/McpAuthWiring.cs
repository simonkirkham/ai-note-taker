using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.IdentityModel.Tokens;
using ModelContextProtocol.AspNetCore.Authentication;
using ModelContextProtocol.Authentication;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;

namespace Api.Mcp.OAuth;

// 35-E: wires the MCP OAuth 2.1 Resource Server (validate audience-bound HS256 bearer; serve the
// protected-resource metadata + the 401 challenge) and registers the AS broker's services. Kept out
// of Builder.cs so the auth surface is reviewable in one place.
public static class McpAuthWiring
{
    // A dedicated JWT scheme for OUR HS256 tokens, separate from the app's Google bearer
    // (JwtBearerDefaults). The MCP endpoint requires THIS scheme so a Google token is never accepted
    // at the Resource Server, and the McpAuth challenge scheme forwards authenticate here.
    public const string BearerScheme = "McpBearer";

    // Authorization policy the MCP tool endpoint requires: a token authenticated via the McpAuth
    // challenge scheme (→ McpBearer) carrying the mcp:tools scope. Missing/invalid → 401 (with the
    // resource_metadata challenge); valid-but-no-scope → 403.
    public const string ToolPolicy = "McpToolPolicy";

    public static void AddMcpOAuth(this IServiceCollection services, McpOAuthOptions options)
    {
        services.AddSingleton(options);
        services.AddSingleton<McpTokenService>();
        services.TryAddSingleton(TimeProvider.System);

        var authBuilder = services.AddAuthentication();

        // Resource Server token validation. Symmetric HS256 key = the Secrets-Manager-backed secret.
        // The validator only confirms the token is one OF OURS (signed by the secret, issued by us, and
        // bearing a well-formed `…/w/{ws}/mcp` aud on the issuer host). It CANNOT see the request route,
        // so the EXACT per-workspace aud→path binding (the RFC 8707 confused-deputy guard) is enforced
        // separately by RequireMcpAudienceFilter on the endpoint, after authentication.
        //
        // When the secret is ABSENT, key off a fresh per-process random 32 bytes that is never known to
        // any caller — so NO token validates (fail closed), rather than keying off a predictable value.
        var signingKey = new SymmetricSecurityKey(string.IsNullOrEmpty(options.SigningSecret)
            ? RandomNumberGenerator.GetBytes(32)
            : Encoding.UTF8.GetBytes(options.SigningSecret));

        authBuilder.AddJwtBearer(BearerScheme, jwt =>
        {
            jwt.TokenValidationParameters = new TokenValidationParameters
            {
                ValidateIssuer = true,
                ValidIssuer = options.Issuer,
                ValidateAudience = true,
                AudienceValidator = (audiences, _, _) => McpAudienceValidator.Validate(audiences, options),
                ValidateLifetime = true,
                ClockSkew = TimeSpan.FromSeconds(60),
                ValidateIssuerSigningKey = true,
                IssuerSigningKey = signingKey,
                ValidAlgorithms = [SecurityAlgorithms.HmacSha256],
                // Refuse to validate anything when the secret is unconfigured (closed, not open).
                RequireSignedTokens = true,
            };
        });

        // The MCP challenge scheme: serves /.well-known/oauth-protected-resource and emits the
        // 401 WWW-Authenticate: Bearer resource_metadata=... challenge. Authenticate is forwarded
        // to the HS256 bearer scheme above.
        authBuilder.AddMcp(mcp =>
        {
            mcp.ForwardAuthenticate = BearerScheme;
            mcp.ResourceMetadata = new ProtectedResourceMetadata
            {
                BearerMethodsSupported = { "header" },
                ScopesSupported = { McpOAuthOptions.ToolScope },
                AuthorizationServers = { options.Issuer },
            };
        });

        services.AddAuthorizationBuilder().AddPolicy(ToolPolicy, policy =>
        {
            policy.AuthenticationSchemes = [McpAuthenticationDefaults.AuthenticationScheme];
            policy.RequireAuthenticatedUser();
            policy.RequireAssertion(ctx => ctx.User.Claims
                .Where(c => c.Type == "scope")
                .SelectMany(c => c.Value.Split(' ', StringSplitOptions.RemoveEmptyEntries))
                .Contains(McpOAuthOptions.ToolScope));
        });
    }
}

// RFC 8707 server-level audience validation: the token's `aud` must be a well-formed MCP resource URI
// ON THE ISSUER HOST (a token for some OTHER server is rejected → 401). This runs in the JWT pipeline
// and CANNOT see the request route, so it does NOT bind the token to a single workspace — that EXACT
// route↔aud match is RequireMcpAudienceFilter's job, after authentication (→ 403 on mismatch).
internal static class McpAudienceValidator
{
    public static bool Validate(IEnumerable<string>? audiences, McpOAuthOptions options)
    {
        if (audiences is null) return false;
        var authority = options.IssuerAuthority;
        return audiences.Any(a =>
            !string.IsNullOrEmpty(a)
            && a.StartsWith(authority + "/w/", StringComparison.Ordinal)
            && a.EndsWith("/mcp", StringComparison.Ordinal));
    }
}

// Per-request audience→workspace binding (HIGH-2). Runs AFTER authentication+authorization, scoped to
// the /w/{workspaceId}/mcp path — so initialize / tools/list / tools/call are ALL covered, not just
// list_notes. For an AUTHENTICATED MCP request it requires the validated token's `aud` to equal
// options.ResourceUri(routeWorkspaceId); a token minted for a DIFFERENT workspace is a valid token of
// ours but is rejected here with 403. Unauthenticated requests are left to the endpoint's
// RequireAuthorization (401 challenge); the no-auth proving config has no authenticated principal, so
// this is a pass-through there. The workspace id comes from the path (not yet a route value at
// middleware time) by parsing /w/{ws}/mcp.
public sealed class McpAudienceMiddleware(RequestDelegate next, McpOAuthOptions options)
{
    public async Task InvokeAsync(HttpContext context)
    {
        if (TryGetMcpWorkspace(context.Request.Path, out var workspaceId)
            && context.User.Identity?.IsAuthenticated == true)
        {
            var expected = options.ResourceUri(workspaceId!);
            var audMatches = context.User.FindAll("aud").Select(c => c.Value).Contains(expected, StringComparer.Ordinal);
            if (!audMatches)
            {
                context.Response.StatusCode = StatusCodes.Status403Forbidden;
                return;
            }
        }

        await next(context).ConfigureAwait(false);
    }

    // Matches exactly "/w/{workspaceId}/mcp" (the tool path), not the PRM well-known path.
    private static bool TryGetMcpWorkspace(PathString path, out string? workspaceId)
    {
        workspaceId = null;
        var value = path.Value;
        if (string.IsNullOrEmpty(value)) return false;
        var segments = value.Trim('/').Split('/');
        if (segments.Length == 3 && segments[0] == "w" && segments[2] == "mcp" && !string.IsNullOrEmpty(segments[1]))
        {
            workspaceId = segments[1];
            return true;
        }
        return false;
    }
}
