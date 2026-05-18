using EventStore;

namespace Api;

public sealed class DomainEventDispatcher(IEnumerable<IDomainEventHandler> handlers) : IDomainEventDispatcher
{
    public async Task DispatchAsync(IReadOnlyList<EventEnvelope> events, CancellationToken ct = default)
    {
        foreach (var handler in handlers)
            await handler.HandleAsync(events, ct).ConfigureAwait(false);
    }
}
