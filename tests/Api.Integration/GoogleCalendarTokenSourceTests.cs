using Api.Auth;
using Api.Services;
using Microsoft.Extensions.Logging.Abstractions;

namespace Api.Integration;

// 34-D1: the Google token source resolves the in-app connection only (CalendarTokenStore, keyed by
// user+workspace) — the legacy SSM fallback is gone. A workspace with no stored token → null →
// calendar_unavailable.
public sealed class GoogleCalendarTokenSourceTests
{
    private const string Ws = "ws-1";

    private sealed class StubCalendarScope(string userId, string workspaceId) : ICalendarScope
    {
        public string UserId { get; } = userId;
        public string WorkspaceId { get; } = workspaceId;
    }

    private static GoogleCalendarTokenSource Build(string userId, string workspaceId, InMemoryCalendarTokenStore store) =>
        new(new StubCalendarScope(userId, workspaceId), store, NullLogger<GoogleCalendarTokenSource>.Instance);

    [Fact]
    public async Task LoadAsync_ReturnsStoredToken()
    {
        var store = new InMemoryCalendarTokenStore();
        store.Seed("user-1", Ws, "google", "rt-stored", "owner@example.com");

        Assert.Equal("rt-stored", await Build("user-1", Ws, store).LoadAsync(forceReload: false));
    }

    [Fact]
    public async Task LoadAsync_NoStoredToken_ReturnsNull()
    {
        // No SSM fallback since 34-D1 — an unconnected workspace reports calendar_unavailable.
        Assert.Null(await Build("user-1", Ws, new InMemoryCalendarTokenStore()).LoadAsync(forceReload: true));
    }

    [Fact]
    public async Task LoadAsync_StoreThrows_ReturnsNull()
    {
        // A transient store failure must degrade to calendar_unavailable (null), not a 500.
        var source = new GoogleCalendarTokenSource(
            new StubCalendarScope("user-1", Ws), new ThrowingCalendarTokenStore(),
            NullLogger<GoogleCalendarTokenSource>.Instance);

        Assert.Null(await source.LoadAsync(forceReload: false));
    }

    private sealed class ThrowingCalendarTokenStore : ICalendarTokenStore
    {
        public Task UpsertAsync(string userId, string workspaceId, string provider, string refreshToken, string? email, CancellationToken ct = default)
            => throw new InvalidOperationException("store down");
        public Task<CalendarToken?> GetAsync(string userId, string workspaceId, string provider, CancellationToken ct = default)
            => throw new InvalidOperationException("store down");
        public Task DeleteAsync(string userId, string workspaceId, string provider, CancellationToken ct = default)
            => throw new InvalidOperationException("store down");
    }

    [Fact]
    public async Task LoadAsync_StoredTokenIsPerUser()
    {
        var store = new InMemoryCalendarTokenStore();
        store.Seed("user-1", Ws, "google", "rt-1");

        // A different user has no stored token → null (no cross-user bleed).
        Assert.Null(await Build("user-2", Ws, store).LoadAsync(forceReload: false));
    }

    [Fact]
    public async Task LoadAsync_StoredTokenIsPerWorkspace()
    {
        var store = new InMemoryCalendarTokenStore();
        store.Seed("user-1", "ws-a", "google", "rt-a");

        // Same user, different workspace with no token → null (no cross-workspace bleed).
        Assert.Null(await Build("user-1", "ws-b", store).LoadAsync(forceReload: false));
        // The connected workspace still resolves its own token.
        Assert.Equal("rt-a", await Build("user-1", "ws-a", store).LoadAsync(forceReload: false));
    }
}
