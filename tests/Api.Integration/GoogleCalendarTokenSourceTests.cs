using Api.Auth;
using Api.Services;
using Microsoft.Extensions.Logging.Abstractions;

namespace Api.Integration;

// Phase 34-A: the Google token source resolves store-first (the per-user in-app connection) then
// the SSM fallback. The SSM-success path hits real AWS (the legacy Phase 9 path) and isn't unit
// tested here; these cover the new store-first behaviour and the no-token boundary.
public sealed class GoogleCalendarTokenSourceTests
{
    private sealed class StubCurrentUser(string userId) : ICurrentUser
    {
        public string UserId { get; } = userId;
        public string Name => "Test";
    }

    private static GoogleCalendarTokenSource Build(string userId, InMemoryCalendarTokenStore store) =>
        new(new StubCurrentUser(userId), store, NullLogger<GoogleCalendarTokenSource>.Instance);

    [Fact]
    public async Task LoadAsync_ReturnsStoredToken_StoreFirst()
    {
        var store = new InMemoryCalendarTokenStore();
        store.Seed("user-1", "google", "rt-stored", "owner@example.com");
        var source = Build("user-1", store);

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
            var source = Build("user-1", new InMemoryCalendarTokenStore());

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
        store.Seed("user-1", "google", "rt-1");
        var prev = Environment.GetEnvironmentVariable("GOOGLE_REFRESH_TOKEN_SSM_PATH");
        try
        {
            Environment.SetEnvironmentVariable("GOOGLE_REFRESH_TOKEN_SSM_PATH", null);
            // A different user with no stored token + no SSM falls through to null.
            var token = await Build("user-2", store).LoadAsync(forceReload: true);
            Assert.Null(token);
        }
        finally
        {
            Environment.SetEnvironmentVariable("GOOGLE_REFRESH_TOKEN_SSM_PATH", prev);
        }
    }
}
