using EventStore;

namespace Api.Integration;

// Test double that delegates to an in-memory store but can be told to simulate a
// lost optimistic-concurrency race on the next append (as a concurrent or
// double-submitted write to the same stream would produce in production).
internal sealed class ConflictingEventStore : IEventStore
{
    private readonly InMemoryEventStore _inner = new();

    public bool ConflictOnNextAppend { get; set; }

    // The flag check-and-reset is deliberately non-atomic: these tests drive a single
    // client sequentially, so there is no concurrent append. Do not reuse this double
    // for parallel-append scenarios without adding synchronisation.
    public Task AppendAsync(string streamId, long expectedVersion, IReadOnlyList<EventEnvelope> events, CancellationToken ct = default)
    {
        if (ConflictOnNextAppend)
        {
            ConflictOnNextAppend = false;
            throw new ConcurrencyException(streamId, expectedVersion, expectedVersion + 1);
        }
        return _inner.AppendAsync(streamId, expectedVersion, events, ct);
    }

    public Task<IReadOnlyList<EventEnvelope>> ReadAsync(string streamId, CancellationToken ct = default) =>
        _inner.ReadAsync(streamId, ct);

    public Task<IReadOnlyList<EventEnvelope>> ReadAllStreamsAsync(CancellationToken ct = default) =>
        _inner.ReadAllStreamsAsync(ct);
}
