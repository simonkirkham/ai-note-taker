using Amazon.SecretsManager;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.Tokens;
using ModelContextProtocol.AspNetCore.Authentication;
using ModelContextProtocol.Authentication;
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
        services.TryAddSingletonTimeProvider();

        var authBuilder = services.AddAuthentication();

        // Resource Server token validation. Symmetric HS256 key = the Secrets-Manager-backed secret.
        // Audience is validated PER REQUEST against the resolved resource URI (the McpAudienceValidator
        // matches the token's aud to the actual /w/{ws}/mcp path being hit), so a token minted for one
        // workspace is rejected at another — the RFC 8707 confused-deputy guard.
        var signingKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(
            string.IsNullOrEmpty(options.SigningSecret) ? new string('0', 32) : options.SigningSecret));

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

    private static void TryAddSingletonTimeProvider(this IServiceCollection services)
    {
        if (services.All(d => d.ServiceType != typeof(TimeProvider)))
            services.AddSingleton(TimeProvider.System);
    }
}

// RFC 8707 audience validation. A token's `aud` must equal one of the MCP resource URIs the issuer
// can serve. Accepting any well-formed `…/w/{ws}/mcp` aud whose host matches the issuer means the
// per-workspace path check (route vs token) is what binds the token to a single workspace — combined
// with the per-request resource the SDK derives, a cross-workspace or cross-resource token is rejected.
internal static class McpAudienceValidator
{
    public static bool Validate(IEnumerable<string>? audiences, McpOAuthOptions options)
    {
        if (audiences is null) return false;
        var issuer = options.Issuer.TrimEnd('/');
        return audiences.Any(a =>
            !string.IsNullOrEmpty(a)
            && a.StartsWith(issuer + "/w/", StringComparison.Ordinal)
            && a.EndsWith("/mcp", StringComparison.Ordinal));
    }
}
