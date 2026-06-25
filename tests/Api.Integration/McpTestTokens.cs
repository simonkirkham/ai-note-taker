using System.Security.Claims;
using System.Text;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace Api.Integration;

// Mints HS256 access tokens for the MCP Resource Server tests, signed with the SAME secret the
// in-process host validates against (MCP_JWT_SECRET). The defaults produce a valid token; the
// overloads let a test forge a wrong audience, an expired token, or drop the scope to assert the
// 401/403 paths.
public static class McpTestTokens
{
    public const string SigningSecret = "test-mcp-hs256-signing-secret-at-least-32-bytes-long";
    public const string Issuer = "https://test-mcp.example.com";
    public const string ClientId = "test-claude-client";
    public const string ToolScope = "mcp:tools";

    public static string Resource(string workspaceId) => $"{Issuer}/w/{workspaceId}/mcp";

    public static string Valid(string workspaceId, string userId = "test-user-123") =>
        Mint(userId, Resource(workspaceId), ToolScope, TimeSpan.FromHours(1));

    public static string WrongAudience(string userId = "test-user-123") =>
        Mint(userId, "https://attacker.example.com/w/ws/mcp", ToolScope, TimeSpan.FromHours(1));

    public static string Expired(string workspaceId, string userId = "test-user-123") =>
        Mint(userId, Resource(workspaceId), ToolScope, TimeSpan.FromHours(-1));

    public static string MissingScope(string workspaceId, string userId = "test-user-123") =>
        Mint(userId, Resource(workspaceId), scope: null, TimeSpan.FromHours(1));

    private static string Mint(string userId, string audience, string? scope, TimeSpan lifetime)
    {
        var now = DateTimeOffset.UtcNow;
        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(SigningSecret));
        var claims = new List<Claim> { new(JwtRegisteredClaimNames.Sub, userId) };
        if (scope is not null) claims.Add(new Claim("scope", scope));
        var descriptor = new SecurityTokenDescriptor
        {
            Issuer = Issuer,
            Audience = audience,
            IssuedAt = now.UtcDateTime,
            NotBefore = now.AddMinutes(-2).UtcDateTime,
            Expires = now.Add(lifetime).UtcDateTime,
            Subject = new ClaimsIdentity(claims),
            SigningCredentials = new SigningCredentials(key, SecurityAlgorithms.HmacSha256),
        };
        return new JsonWebTokenHandler().CreateToken(descriptor);
    }
}
