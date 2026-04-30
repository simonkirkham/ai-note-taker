using EventStore;

namespace ApiIntegration;

internal sealed class InMemoryEventStore : IEventStore
{
    private readonly Dictionary<string, List<EventEnvelope>> _streams = new();

    public Task AppendAsync(string streamId, long expectedVersion, IReadOnlyList<EventEnvelope> events, CancellationToken ct = default)
    {
        if (!_streams.TryGetValue(streamId, out var stream))
            stream = _streams[streamId] = [];

        if (stream.Count != expectedVersion)
            throw new ConcurrencyException(streamId, expectedVersion, stream.Count);

        var nextSeq = stream.Count + 1;
        foreach (var e in events)
            stream.Add(e with { StreamId = streamId, SequenceNumber = nextSeq++ });

        return Task.CompletedTask;
    }

    public Task<IReadOnlyList<EventEnvelope>> ReadAsync(string streamId, CancellationToken ct = default)
    {
        IReadOnlyList<EventEnvelope> result = _streams.TryGetValue(streamId, out var stream)
            ? stream.ToList().AsReadOnly()
            : Array.Empty<EventEnvelope>();
        return Task.FromResult(result);
    }
}
