using System.Text.Json;
using Domain;
using Domain.Notes;

namespace EventStore;

public static class EventDeserializer
{
    public static IDomainEvent Deserialize(EventEnvelope envelope) => envelope.EventType switch
    {
        nameof(NoteCreated) => JsonSerializer.Deserialize<NoteCreated>(envelope.Payload)!,
        nameof(NoteRenamed) => JsonSerializer.Deserialize<NoteRenamed>(envelope.Payload)!,
        _ => throw new InvalidOperationException($"Unknown event type: {envelope.EventType}")
    };
}
