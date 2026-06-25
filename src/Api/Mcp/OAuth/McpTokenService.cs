using System.Security.Cryptography;
using System.Text;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace Api.Mcp.OAuth;

// Crypto for the MCP AS: mint HS256 access tokens (aud-bound per RFC 8707), generate opaque
// codes/state/refresh tokens, and verify PKCE S256. The signing key is the Secrets-Manager-backed
// HMAC secret; the SAME key validates tokens at the Resource Server (Command signs, Query verifies).
public sealed class McpTokenService(McpOAuthOptions options, TimeProvider time)
{
    private readonly JsonWebTokenHandler _handler = new();

    // Mint an aud-bound HS256 access token. `aud` is the exact per-workspace resource URI the token is
    // for (RFC 8707) so a token for one resource is rejected at any other; `iss` is our AS; `scope`
    // gates the tool policy; `sub` carries the resolved user identity. Lifetime is short (≤1h).
    public string CreateAccessToken(string userId, string resource)
    {
        var now = time.GetUtcNow();
        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(options.SigningSecret));
        var descriptor = new SecurityTokenDescriptor
        {
            Issuer = options.Issuer,
            Audience = resource,
            IssuedAt = now.UtcDateTime,
            NotBefore = now.UtcDateTime,
            Expires = now.Add(options.AccessTokenLifetime).UtcDateTime,
            Subject = new System.Security.Claims.ClaimsIdentity(
            [
                new System.Security.Claims.Claim(JwtRegisteredClaimNames.Sub, userId),
                new System.Security.Claims.Claim("scope", McpOAuthOptions.ToolScope),
            ]),
            SigningCredentials = new SigningCredentials(key, SecurityAlgorithms.HmacSha256),
        };
        return _handler.CreateToken(descriptor);
    }

    // 256-bit URL-safe opaque token for codes / state / refresh tokens. Cryptographically random,
    // unguessable, no structure (it is a lookup key, never parsed).
    public static string NewOpaqueToken()
    {
        Span<byte> bytes = stackalloc byte[32];
        RandomNumberGenerator.Fill(bytes);
        return Base64UrlEncoder.Encode(bytes.ToArray());
    }

    // RFC 7636 S256: BASE64URL(SHA256(ASCII(code_verifier))) must equal the stored challenge.
    // Constant-time compare. Returns false on any malformed input rather than throwing.
    public static bool VerifyPkceS256(string codeVerifier, string codeChallenge)
    {
        if (string.IsNullOrEmpty(codeVerifier) || string.IsNullOrEmpty(codeChallenge))
            return false;
        var hash = SHA256.HashData(Encoding.ASCII.GetBytes(codeVerifier));
        var computed = Base64UrlEncoder.Encode(hash);
        return CryptographicOperations.FixedTimeEquals(
            Encoding.ASCII.GetBytes(computed), Encoding.ASCII.GetBytes(codeChallenge));
    }
}
