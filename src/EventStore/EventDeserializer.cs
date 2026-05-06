using System.Text.Json;
using Domain;
using Domain.Notes;

namespace EventStore;

public static class EventDeserializer
{
    public static IDomainEvent Deserialize(EventEnvelope envelope) => (envelope.EventType, envelope.EventVersion) switch
    {
        (nameof(NoteCreated),    _) => JsonSerializer.Deserialize<NoteCreated>(envelope.Payload)!,
        (nameof(NoteRenamed),    _) => JsonSerializer.Deserialize<NoteRenamed>(envelope.Payload)!,
        (nameof(ContentEdited),  1) => JsonSerializer.Deserialize<ContentEdited>(envelope.Payload)!,
        (nameof(ContentEdited),  2) => JsonSerializer.Deserialize<ContentEditedV2>(envelope.Payload)!,
        _ => throw new InvalidOperationException($"Unknown event type/version: {envelope.EventType} v{envelope.EventVersion}")
    };
}
