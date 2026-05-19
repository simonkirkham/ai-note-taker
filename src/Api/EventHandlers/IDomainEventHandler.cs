using EventStore;

namespace Api.EventHandlers;

public interface IDomainEventHandler
{
    Task HandleAsync(IReadOnlyList<EventEnvelope> events, CancellationToken ct = default);
}
