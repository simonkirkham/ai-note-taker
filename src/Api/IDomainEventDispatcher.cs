using EventStore;

namespace Api;

public interface IDomainEventDispatcher
{
    Task DispatchAsync(IReadOnlyList<EventEnvelope> events, CancellationToken ct = default);
}
