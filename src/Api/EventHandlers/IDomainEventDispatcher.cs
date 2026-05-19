using EventStore;

namespace Api.EventHandlers;

public interface IDomainEventDispatcher
{
    Task DispatchAsync(IReadOnlyList<EventEnvelope> events, CancellationToken ct = default);
}
