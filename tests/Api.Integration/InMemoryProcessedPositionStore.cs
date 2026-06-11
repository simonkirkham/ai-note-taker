using EventStore.Projections;

namespace Api.Integration;

internal sealed class InMemoryProcessedPositionStore : IProcessedPositionStore
{
    private readonly Dictionary<string, long> _positions = new();

    public Task<long> GetLastSeqAsync(string streamId, CancellationToken ct = default) =>
        Task.FromResult(_positions.TryGetValue(streamId, out var seq) ? seq : -1);

    public Task SetLastSeqAsync(string streamId, long seq, CancellationToken ct = default)
    {
        if (!_positions.TryGetValue(streamId, out var current) || current < seq)
            _positions[streamId] = seq;
        return Task.CompletedTask;
    }
}
