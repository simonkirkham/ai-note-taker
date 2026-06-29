using Api.Auth;

namespace Api.Integration;

public sealed class InMemoryRefreshTokenStore : IRefreshTokenStore
{
    private readonly Dictionary<string, string> _tokens = new();

    public void Seed(string sub, string refreshToken) => _tokens[sub] = refreshToken;

    public bool Has(string sub) => _tokens.ContainsKey(sub);

    public string? Get(string sub) => _tokens.TryGetValue(sub, out var t) ? t : null;

    public void Clear() => _tokens.Clear();

    public Task UpsertAsync(string sub, string refreshToken, CancellationToken ct = default)
    {
        _tokens[sub] = refreshToken;
        return Task.CompletedTask;
    }

    public Task<string?> GetAsync(string sub, CancellationToken ct = default) =>
        Task.FromResult(_tokens.TryGetValue(sub, out var t) ? t : null);

    public Task DeleteAsync(string sub, CancellationToken ct = default)
    {
        _tokens.Remove(sub);
        return Task.CompletedTask;
    }
}
