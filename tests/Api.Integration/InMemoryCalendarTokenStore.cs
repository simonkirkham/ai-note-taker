using Api.Auth;

namespace Api.Integration;

public sealed class InMemoryCalendarTokenStore : ICalendarTokenStore
{
    private readonly Dictionary<string, CalendarToken> _tokens = new();

    private static string Key(string userId, string workspaceId, string provider) => $"{userId}::{workspaceId}::{provider}";

    public void Seed(string userId, string workspaceId, string provider, string refreshToken, string? email = null) =>
        _tokens[Key(userId, workspaceId, provider)] = new CalendarToken(refreshToken, email);

    public bool Has(string userId, string workspaceId, string provider) => _tokens.ContainsKey(Key(userId, workspaceId, provider));

    public CalendarToken? Peek(string userId, string workspaceId, string provider) =>
        _tokens.TryGetValue(Key(userId, workspaceId, provider), out var v) ? v : null;

    public void Clear() => _tokens.Clear();

    public Task UpsertAsync(string userId, string workspaceId, string provider, string refreshToken, string? email, CancellationToken ct = default)
    {
        _tokens[Key(userId, workspaceId, provider)] = new CalendarToken(refreshToken, email);
        return Task.CompletedTask;
    }

    public Task<CalendarToken?> GetAsync(string userId, string workspaceId, string provider, CancellationToken ct = default) =>
        Task.FromResult(_tokens.TryGetValue(Key(userId, workspaceId, provider), out var v) ? v : null);

    public Task DeleteAsync(string userId, string workspaceId, string provider, CancellationToken ct = default)
    {
        _tokens.Remove(Key(userId, workspaceId, provider));
        return Task.CompletedTask;
    }
}
