using EventStore;

namespace Specs.EventStore;

/// <summary>
/// Test double for IEventStore. Pip implements this to make specs pass.
/// </summary>
internal sealed class InMemoryEventStore : IEventStore
{
    public Task AppendAsync(string streamId, long expectedVersion, IReadOnlyList<EventEnvelope> events, CancellationToken ct = default) =>
        throw new NotImplementedException();

    public Task<IReadOnlyList<EventEnvelope>> ReadAsync(string streamId, CancellationToken ct = default) =>
        throw new NotImplementedException();
}
