using EventStore;

namespace Api;

public interface IDomainEventHandler
{
    Task HandleAsync(IReadOnlyList<EventEnvelope> events, CancellationToken ct = default);
}
