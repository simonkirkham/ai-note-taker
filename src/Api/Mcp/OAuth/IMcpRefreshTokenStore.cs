namespace Api.Mcp.OAuth;

// A minted MCP refresh token bound to the identity + audience it was issued for, so a
// grant_type=refresh_token request re-mints an access token for the SAME (user, resource) without
// re-running Google sign-in. 35-F: no workspace — the single /mcp resource serves every workspace, and
// per-workspace access is authorized per tool call against `sub`. Rotating: each use deletes the
// presented token and issues a new one. ExpiresAt caps its absolute lifetime — re-checked on use AND
// TTL-reaped — so a leaked token cannot be replayed indefinitely.
public sealed record McpRefreshToken(
    string Token,
    string ClientId,
    string Resource,
    string UserId,
    DateTimeOffset ExpiresAt);

public interface IMcpRefreshTokenStore
{
    Task PutAsync(McpRefreshToken token, CancellationToken ct = default);
    // Read-and-delete: a refresh token is single-use (rotated). A replayed OR expired token returns null.
    Task<McpRefreshToken?> TakeAsync(string token, DateTimeOffset now, CancellationToken ct = default);
}
