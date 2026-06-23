using Api.Auth;

namespace Api.Integration;

public sealed class InMemoryCalendarTokenStore : ICalendarTokenStore
{
    private readonly Dictionary<string, CalendarToken> _tokens = new();

    private static string Key(string sub, string provider) => $"{sub}::{provider}";

    public void Seed(string sub, string provider, string refreshToken, string? email = null) =>
        _tokens[Key(sub, provider)] = new CalendarToken(refreshToken, email);

    public bool Has(string sub, string provider) => _tokens.ContainsKey(Key(sub, provider));

    public CalendarToken? Peek(string sub, string provider) =>
        _tokens.TryGetValue(Key(sub, provider), out var v) ? v : null;

    public void Clear() => _tokens.Clear();

    public Task UpsertAsync(string sub, string provider, string refreshToken, string? email, CancellationToken ct = default)
    {
        _tokens[Key(sub, provider)] = new CalendarToken(refreshToken, email);
        return Task.CompletedTask;
    }

    public Task<CalendarToken?> GetAsync(string sub, string provider, CancellationToken ct = default) =>
        Task.FromResult(_tokens.TryGetValue(Key(sub, provider), out var v) ? v : null);

    public Task DeleteAsync(string sub, string provider, CancellationToken ct = default)
    {
        _tokens.Remove(Key(sub, provider));
        return Task.CompletedTask;
    }
}
