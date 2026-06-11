using System.Collections.Concurrent;
using EventStore.Projections;

namespace Api.Projections;

// In-process position guard for local Kestrel, where the sync decorator drives the projector
// per append. A ConcurrentDictionary with the same monotonic semantics as the deployed
// DynamoDbProcessedPositionStore: an unseen stream reads -1, and SetLastSeqAsync never
// regresses. Not used in the API Lambda (no decorator there) nor the Projector Lambda (which
// uses the DynamoDB-backed store).
public sealed class InMemoryProcessedPositionStore : IProcessedPositionStore
{
    private readonly ConcurrentDictionary<string, long> _positions = new();

    public Task<long> GetLastSeqAsync(string streamId, CancellationToken ct = default) =>
        Task.FromResult(_positions.TryGetValue(streamId, out var seq) ? seq : -1);

    public Task SetLastSeqAsync(string streamId, long seq, CancellationToken ct = default)
    {
        _positions.AddOrUpdate(streamId, seq, (_, current) => Math.Max(current, seq));
        return Task.CompletedTask;
    }
}
