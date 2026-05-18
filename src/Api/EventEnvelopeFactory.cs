using System.Text.Json;
using Domain;
using EventStore;

namespace Api;

internal static class EventEnvelopeFactory
{
    internal static List<EventEnvelope> CreateEnvelopes(string streamId, IReadOnlyList<IDomainEvent> events) =>
        events.Select(e => new EventEnvelope(
            StreamId: streamId, SequenceNumber: 0,
            EventType: e.GetType().Name, EventVersion: 1,
            OccurredAt: DateTimeOffset.UtcNow,
            Payload: JsonSerializer.Serialize(e, e.GetType()),
            Metadata: new EventMetadata(Guid.NewGuid(), null, null, null)))
        .ToList();
}
