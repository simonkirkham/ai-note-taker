namespace Api.Auth;

// Durable, server-side store for Google refresh tokens, keyed by the user's Google `sub`.
// NOT the event store and NOT a rebuildable projection — it holds a long-lived credential
// that only Google can re-issue, so it is the authoritative copy once the browser cookie is
// lost. Upsert overwrites in place; Delete is idempotent. The token value is never returned
// to the browser and never logged.
public interface IRefreshTokenStore
{
    Task UpsertAsync(string sub, string refreshToken, CancellationToken ct = default);
    Task<string?> GetAsync(string sub, CancellationToken ct = default);
    Task DeleteAsync(string sub, CancellationToken ct = default);
}
