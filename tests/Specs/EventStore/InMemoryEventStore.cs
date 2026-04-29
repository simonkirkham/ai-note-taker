using EventStore;

namespace Specs.EventStore;

internal sealed class InMemoryEventStore : IEventStore
{
    private readonly Dictionary<string, List<EventEnvelope>> _streams = new();

    public Task AppendAsync(string streamId, long expectedVersion, IReadOnlyList<EventEnvelope> events, CancellationToken ct = default)
    {
        if (!_streams.TryGetValue(streamId, out var stream))
            stream = _streams[streamId] = new List<EventEnvelope>();

        var actualVersion = stream.Count;
        if (actualVersion != expectedVersion)
            throw new ConcurrencyException(streamId, expectedVersion, actualVersion);

        var nextSeq = actualVersion + 1;
        foreach (var e in events)
            stream.Add(e with { StreamId = streamId, SequenceNumber = nextSeq++ });

        return Task.CompletedTask;
    }

    public Task<IReadOnlyList<EventEnvelope>> ReadAsync(string streamId, CancellationToken ct = default)
    {
        var result = _streams.TryGetValue(streamId, out var stream)
            ? (IReadOnlyList<EventEnvelope>)stream.AsReadOnly()
            : Array.Empty<EventEnvelope>();
        return Task.FromResult(result);
    }
}
