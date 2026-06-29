using System.Collections.Concurrent;
using Api.Mcp.OAuth;

namespace Api.Integration;

// In-memory MCP auth-code store for the in-process host. Mirrors the Dynamo store's single-use,
// expiry-checked semantics without AWS.
public sealed class InMemoryMcpAuthCodeStore(McpOAuthOptions options) : IMcpAuthCodeStore
{
    private readonly ConcurrentDictionary<string, (string Kind, object Payload, DateTimeOffset Expires)> _items = new();

    public Task PutPendingAsync(McpPendingAuth pending, DateTimeOffset now, CancellationToken ct = default)
    {
        _items[pending.GoogleState] = ("pending", pending, now.Add(options.AuthCodeLifetime));
        return Task.CompletedTask;
    }

    public Task<McpPendingAuth?> TakePendingAsync(string googleState, DateTimeOffset now, CancellationToken ct = default) =>
        Task.FromResult(Take<McpPendingAuth>(googleState, "pending", now));

    public Task PutCodeAsync(McpAuthCode code, DateTimeOffset now, CancellationToken ct = default)
    {
        _items[code.Code] = ("code", code, now.Add(options.AuthCodeLifetime));
        return Task.CompletedTask;
    }

    public Task<McpAuthCode?> TakeCodeAsync(string code, DateTimeOffset now, CancellationToken ct = default) =>
        Task.FromResult(Take<McpAuthCode>(code, "code", now));

    private T? Take<T>(string id, string kind, DateTimeOffset now) where T : class
    {
        if (!_items.TryRemove(id, out var entry)) return null;
        if (entry.Kind != kind) return null;
        if (now > entry.Expires) return null;
        return entry.Payload as T;
    }
}

public sealed class InMemoryMcpRefreshTokenStore : IMcpRefreshTokenStore
{
    private readonly ConcurrentDictionary<string, McpRefreshToken> _items = new();

    public Task PutAsync(McpRefreshToken token, CancellationToken ct = default)
    {
        _items[token.Token] = token;
        return Task.CompletedTask;
    }

    public Task<McpRefreshToken?> TakeAsync(string token, DateTimeOffset now, CancellationToken ct = default)
    {
        if (!_items.TryRemove(token, out var t)) return Task.FromResult<McpRefreshToken?>(null);
        return Task.FromResult(now > t.ExpiresAt ? null : t);
    }
}
