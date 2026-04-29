namespace EventStore;

public interface IEventStore
{
    Task AppendAsync(string streamId, long expectedVersion, IReadOnlyList<EventEnvelope> events, CancellationToken ct = default);
    Task<IReadOnlyList<EventEnvelope>> ReadAsync(string streamId, CancellationToken ct = default);
}
