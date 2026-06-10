using EventStore;

namespace Api.Integration;

// Test double that delegates to an in-memory store but can be told to simulate a
// lost optimistic-concurrency race on the next append (as a concurrent or
// double-submitted write to the same stream would produce in production).
internal sealed class ConflictingEventStore : IEventStore
{
    private readonly InMemoryEventStore _inner = new();

    // Number of upcoming appends to fail with a ConcurrencyException before delegating
    // to the real store. Set to 1 to model a single benign race (the handler should
    // retry and succeed); set to a large value to model a persistent conflict (the
    // bounded retry exhausts and the conflict surfaces as 409).
    public int ConflictsRemaining { get; set; }

    public bool ConflictOnNextAppend
    {
        get => ConflictsRemaining > 0;
        set => ConflictsRemaining = value ? 1 : 0;
    }

    // The counter decrement is deliberately non-atomic: these tests drive a single
    // client sequentially, so there is no concurrent append. Do not reuse this double
    // for parallel-append scenarios without adding synchronisation.
    public Task AppendAsync(string streamId, long expectedVersion, IReadOnlyList<EventEnvelope> events, CancellationToken ct = default)
    {
        if (ConflictsRemaining > 0)
        {
            ConflictsRemaining--;
            throw new ConcurrencyException(streamId, expectedVersion, expectedVersion + 1);
        }
        return _inner.AppendAsync(streamId, expectedVersion, events, ct);
    }

    public Task<IReadOnlyList<EventEnvelope>> ReadAsync(string streamId, CancellationToken ct = default) =>
        _inner.ReadAsync(streamId, ct);

    public Task<IReadOnlyList<EventEnvelope>> ReadAllStreamsAsync(CancellationToken ct = default) =>
        _inner.ReadAllStreamsAsync(ct);
}
