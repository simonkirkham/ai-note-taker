namespace Api.Mcp.OAuth;

// A minted MCP refresh token bound to the identity + audience it was issued for, so a
// grant_type=refresh_token request re-mints an access token for the SAME (user, workspace, resource)
// without re-running Google sign-in. Rotating: each use deletes the presented token and issues a new one.
public sealed record McpRefreshToken(
    string Token,
    string ClientId,
    string Resource,
    string WorkspaceId,
    string UserId);

public interface IMcpRefreshTokenStore
{
    Task PutAsync(McpRefreshToken token, CancellationToken ct = default);
    // Read-and-delete: a refresh token is single-use (rotated). A replayed token returns null.
    Task<McpRefreshToken?> TakeAsync(string token, CancellationToken ct = default);
}
