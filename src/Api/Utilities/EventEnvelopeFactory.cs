using System.Text.Json;
using Domain;
using EventStore;

namespace Api.Utilities;

internal static class EventEnvelopeFactory
{
    internal static List<EventEnvelope> CreateEnvelopes(string streamId, IReadOnlyList<IDomainEvent> events, string userId) =>
        events.Select(e => new EventEnvelope(
            StreamId: streamId, SequenceNumber: 0,
            EventType: e.GetType().Name, EventVersion: 1,
            OccurredAt: DateTimeOffset.UtcNow,
            Payload: JsonSerializer.Serialize(e, e.GetType()),
            Metadata: new EventMetadata(Guid.NewGuid(), userId, null, null)))
        .ToList();
}
