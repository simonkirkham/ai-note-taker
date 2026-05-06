using System.Text.Json;
using Domain.Notes;
using EventStore;
using EventStore.Projections;

namespace Specs.Projections;

/// <summary>
/// Proves that NoteDetailProjection handles both v1 and v2 ContentEdited envelopes
/// after the event versioning change.
/// </summary>
public sealed class NoteDetailVersioningSpec
{
    private static EventEnvelope Envelope(string streamId, long seq, string type, int version,
        string payload, DateTimeOffset? occurredAt = null) =>
        new(streamId, seq, type, version, occurredAt ?? DateTimeOffset.UtcNow, payload,
            new EventMetadata(Guid.NewGuid(), null, null, null));

    [Fact]
    public void ContentEdited_v1_envelope_still_updates_content()
    {
        var noteId = Guid.NewGuid();
        var createdAt = DateTimeOffset.UtcNow;
        var editedAt = createdAt.AddMinutes(5);
        var projection = new NoteDetailProjection();

        projection.Handle(Envelope($"note#{noteId}", 1, nameof(NoteCreated), 1,
            JsonSerializer.Serialize(new NoteCreated(new NoteId(noteId))), createdAt));

        projection.Handle(Envelope($"note#{noteId}", 2, nameof(ContentEdited), 1,
            JsonSerializer.Serialize(new ContentEdited(new NoteId(noteId), "v1 content")), editedAt));

        var detail = projection.GetDetail(new NoteId(noteId));
        Assert.Equal("v1 content", detail!.Content);
        Assert.Equal(editedAt, detail.LastModifiedAt);
    }

    [Fact]
    public void ContentEdited_v2_envelope_updates_content()
    {
        // Fails before implementation: EventDeserializer routes ContentEdited v2 envelopes
        // to ContentEdited (v1 type), ignoring version. NoteDetailProjection never receives
        // ContentEditedV2, so the new projection case is never exercised.
        // After implementation: deserializer returns ContentEditedV2, projection handles it.
        var noteId = Guid.NewGuid();
        var createdAt = DateTimeOffset.UtcNow;
        var editedAt = createdAt.AddMinutes(5);
        var projection = new NoteDetailProjection();

        projection.Handle(Envelope($"note#{noteId}", 1, nameof(NoteCreated), 1,
            JsonSerializer.Serialize(new NoteCreated(new NoteId(noteId))), createdAt));

        var v2Payload = JsonSerializer.Serialize(new ContentEditedV2(new NoteId(noteId), "v2 content", 10));
        projection.Handle(Envelope($"note#{noteId}", 2, nameof(ContentEdited), 2, v2Payload, editedAt));

        var detail = projection.GetDetail(new NoteId(noteId));
        // Before implementation this passes (STJ ignores CharacterCount, deserializes as ContentEdited v1)
        // but the CharacterCount field is silently lost. The real test is that the deserializer
        // returns ContentEditedV2 and the projection's ContentEditedV2 case is exercised.
        Assert.Equal("v2 content", detail!.Content);
        Assert.Equal(editedAt, detail.LastModifiedAt);
    }

    [Fact]
    public void ContentEdited_v2_envelope_deserializes_as_ContentEditedV2()
    {
        // Fails before implementation: deserializer returns ContentEdited, not ContentEditedV2.
        var noteId = new NoteId(Guid.NewGuid());
        var v2Payload = JsonSerializer.Serialize(new ContentEditedV2(noteId, "hello", 5));
        var envelope = new EventEnvelope($"note#{noteId.Value}", 1, nameof(ContentEdited), 2,
            DateTimeOffset.UtcNow, v2Payload, new EventMetadata(Guid.NewGuid(), null, null, null));

        var result = EventDeserializer.Deserialize(envelope);

        Assert.IsType<ContentEditedV2>(result);
    }
}
