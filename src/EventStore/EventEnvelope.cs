namespace EventStore;

public record EventEnvelope(
    string StreamId,
    long SequenceNumber,
    string EventType,
    int EventVersion,
    DateTimeOffset OccurredAt,
    string Payload,
    EventMetadata Metadata);
