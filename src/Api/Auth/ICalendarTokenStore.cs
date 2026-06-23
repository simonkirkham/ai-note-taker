namespace Api.Auth;

// One stored calendar credential: the provider refresh token + the connected account's email
// (for the "Connected as …" label). The token is never returned to the browser or logged.
public sealed record CalendarToken(string RefreshToken, string? Email);

// Durable, server-side store for per-user calendar refresh tokens, keyed by (sub, provider).
// Phase 34-A keys by the user's `sub`; 34-B re-keys by workspace. NOT the event store and NOT a
// rebuildable projection — it holds a long-lived credential only the provider can re-issue, so it
// is the authoritative copy. Upsert overwrites in place; Delete is idempotent.
public interface ICalendarTokenStore
{
    Task UpsertAsync(string sub, string provider, string refreshToken, string? email, CancellationToken ct = default);
    Task<CalendarToken?> GetAsync(string sub, string provider, CancellationToken ct = default);
    Task DeleteAsync(string sub, string provider, CancellationToken ct = default);
}
