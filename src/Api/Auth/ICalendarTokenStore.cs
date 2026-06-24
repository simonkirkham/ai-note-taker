namespace Api.Auth;

// One stored calendar credential: the provider refresh token + the connected account's email
// (for the "Connected as …" label). The token is never returned to the browser or logged.
public sealed record CalendarToken(string RefreshToken, string? Email);

// Durable, server-side store for calendar refresh tokens, keyed by (userId, workspaceId, provider).
// 34-A keyed by the user's `sub`; 34-B widens the key to the workspace so each workspace carries its
// own connection. userId is kept in the key (not just workspaceId) because the reserved default
// workspace id (`__default__`) is shared across all users — keying purely by workspace would leak the
// default workspace's calendar between users. NOT the event store and NOT a rebuildable projection:
// it holds a long-lived credential only the provider can re-issue, so it is the authoritative copy.
// Upsert overwrites in place; Delete is idempotent.
public interface ICalendarTokenStore
{
    Task UpsertAsync(string userId, string workspaceId, string provider, string refreshToken, string? email, CancellationToken ct = default);
    Task<CalendarToken?> GetAsync(string userId, string workspaceId, string provider, CancellationToken ct = default);
    Task DeleteAsync(string userId, string workspaceId, string provider, CancellationToken ct = default);
}
