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
        // 35-F: the token `aud` must equal the single resource `{issuer}/mcp` exactly (RFC 8707
        // confused-deputy guard) — a token minted for any other server is rejected. There is no
        // per-workspace audience any more; workspace access is authorized per tool call against `sub`.
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
                Resource = options.ResourceUri,
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

// 35-F RFC 8707 server-level audience validation: the token's `aud` must equal the single resource
// `{issuer}/mcp` EXACTLY (a token for any other server — or any other path — is rejected → 401). There
// is no per-workspace audience: workspace access is authorized per tool call against the token `sub`
// (NoteMcpTools.AuthorizeAsync), so no after-authentication audience→route middleware is needed.
internal static class McpAudienceValidator
{
    public static bool Validate(IEnumerable<string>? audiences, McpOAuthOptions options)
    {
        if (audiences is null) return false;
        var expected = options.ResourceUri;
        return audiences.Any(a => string.Equals(a, expected, StringComparison.Ordinal));
    }
}
