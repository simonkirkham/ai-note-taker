using Api.Auth;
using Api.Services;
using Microsoft.Extensions.Logging.Abstractions;

namespace Api.Integration;

// The Google token source resolves store-first (the in-app connection, keyed by user+workspace
// since 34-B) then the SSM fallback. The SSM-success path hits real AWS (the legacy Phase 9 path)
// and isn't unit tested here; these cover store-first behaviour and the no-token boundary.
public sealed class GoogleCalendarTokenSourceTests
{
    private const string Ws = "ws-1";

    private sealed class StubCurrentUser(string userId) : ICurrentUser
    {
        public string UserId { get; } = userId;
        public string Name => "Test";
    }

    private sealed class StubCurrentWorkspace(string workspaceId) : ICurrentWorkspace
    {
        public string WorkspaceId { get; } = workspaceId;
    }

    private static GoogleCalendarTokenSource Build(string userId, string workspaceId, InMemoryCalendarTokenStore store) =>
        new(new StubCurrentUser(userId), new StubCurrentWorkspace(workspaceId), store, NullLogger<GoogleCalendarTokenSource>.Instance);

    [Fact]
    public async Task LoadAsync_ReturnsStoredToken_StoreFirst()
    {
        var store = new InMemoryCalendarTokenStore();
        store.Seed("user-1", Ws, "google", "rt-stored", "owner@example.com");
        var source = Build("user-1", Ws, store);

        var token = await source.LoadAsync(forceReload: false);

        Assert.Equal("rt-stored", token);
    }

    [Fact]
    public async Task LoadAsync_NoStoredTokenAndNoSsmPath_ReturnsNull()
    {
        var prev = Environment.GetEnvironmentVariable("GOOGLE_REFRESH_TOKEN_SSM_PATH");
        try
        {
            Environment.SetEnvironmentVariable("GOOGLE_REFRESH_TOKEN_SSM_PATH", null);
            var source = Build("user-1", Ws, new InMemoryCalendarTokenStore());

            var token = await source.LoadAsync(forceReload: true);

            Assert.Null(token); // no in-app token, no SSM fallback configured → calendar_unavailable
        }
        finally
        {
            Environment.SetEnvironmentVariable("GOOGLE_REFRESH_TOKEN_SSM_PATH", prev);
        }
    }

    [Fact]
    public async Task LoadAsync_StoredTokenIsPerUser()
    {
        var store = new InMemoryCalendarTokenStore();
        store.Seed("user-1", Ws, "google", "rt-1");
        var prev = Environment.GetEnvironmentVariable("GOOGLE_REFRESH_TOKEN_SSM_PATH");
        try
        {
            Environment.SetEnvironmentVariable("GOOGLE_REFRESH_TOKEN_SSM_PATH", null);
            // A different user with no stored token + no SSM falls through to null.
            var token = await Build("user-2", Ws, store).LoadAsync(forceReload: true);
            Assert.Null(token);
        }
        finally
        {
            Environment.SetEnvironmentVariable("GOOGLE_REFRESH_TOKEN_SSM_PATH", prev);
        }
    }

    [Fact]
    public async Task LoadAsync_StoredTokenIsPerWorkspace()
    {
        var store = new InMemoryCalendarTokenStore();
        store.Seed("user-1", "ws-a", "google", "rt-a");
        var prev = Environment.GetEnvironmentVariable("GOOGLE_REFRESH_TOKEN_SSM_PATH");
        try
        {
            Environment.SetEnvironmentVariable("GOOGLE_REFRESH_TOKEN_SSM_PATH", null);
            // Same user, different workspace with no token + no SSM → null (no cross-workspace bleed).
            Assert.Null(await Build("user-1", "ws-b", store).LoadAsync(forceReload: true));
            // The connected workspace still resolves its own token.
            Assert.Equal("rt-a", await Build("user-1", "ws-a", store).LoadAsync(forceReload: false));
        }
        finally
        {
            Environment.SetEnvironmentVariable("GOOGLE_REFRESH_TOKEN_SSM_PATH", prev);
        }
    }
}
