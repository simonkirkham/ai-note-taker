namespace Api.Mcp.OAuth;

// Short-lived OAuth state for the MCP broker: the pending-Google record (keyed by our google_state)
// and OUR issued authorization code (keyed by the code). Both are single-use and TTL-expired (≤60s).
// "Take" reads-and-deletes atomically-by-intent: a code/state may be consumed at most once, so a
// replayed code returns null.
public interface IMcpAuthCodeStore
{
    Task PutPendingAsync(McpPendingAuth pending, DateTimeOffset now, CancellationToken ct = default);
    Task<McpPendingAuth?> TakePendingAsync(string googleState, DateTimeOffset now, CancellationToken ct = default);

    Task PutCodeAsync(McpAuthCode code, DateTimeOffset now, CancellationToken ct = default);
    Task<McpAuthCode?> TakeCodeAsync(string code, DateTimeOffset now, CancellationToken ct = default);
}
