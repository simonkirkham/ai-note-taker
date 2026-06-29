using System.Text.Json;
using Domain.Notes;
using EventStore;
using EventStore.Projections;

namespace Domain.Specs.Projections;

public sealed class DeleteNoteProjectionSpec
{
    private static EventEnvelope Envelope(string streamId, long seq, string type,
        string payload, DateTimeOffset? occurredAt = null) =>
        new(streamId, seq, type, 1, occurredAt ?? DateTimeOffset.UtcNow, payload,
            new EventMetadata(Guid.NewGuid(), null, null, null));

    [Fact]
    public void NoteTitleList_removes_note_when_NoteDeleted_handled()
    {
        var noteId = new NoteId(Guid.NewGuid());
        var projection = new NoteTitleListProjection();

        projection.Handle(Envelope(noteId.ToStreamId(), 1, nameof(NoteCreated),
            JsonSerializer.Serialize(new NoteCreated(noteId))));
        projection.Handle(Envelope(noteId.ToStreamId(), 2, nameof(NoteDeleted),
            JsonSerializer.Serialize(new NoteDeleted(noteId))));

        Assert.DoesNotContain(projection.GetView().Items, i => i.NoteId == noteId);
    }

    [Fact]
    public void NoteDetail_removes_note_when_NoteDeleted_handled()
    {
        var noteId = new NoteId(Guid.NewGuid());
        var projection = new NoteDetailProjection();

        projection.Handle(Envelope(noteId.ToStreamId(), 1, nameof(NoteCreated),
            JsonSerializer.Serialize(new NoteCreated(noteId))));
        projection.Handle(Envelope(noteId.ToStreamId(), 2, nameof(NoteDeleted),
            JsonSerializer.Serialize(new NoteDeleted(noteId))));

        Assert.Null(projection.GetDetail(noteId));
    }
}
