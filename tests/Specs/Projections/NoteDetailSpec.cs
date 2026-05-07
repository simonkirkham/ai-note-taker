using System.Text.Json;
using Domain.Notes;
using EventStore;
using EventStore.Projections;

namespace Specs.Projections;

public sealed class NoteDetailSpec
{
    private static EventEnvelope Envelope(string streamId, long seq, string type, string payload,
        DateTimeOffset? occurredAt = null) =>
        new(streamId, seq, type, 1, occurredAt ?? DateTimeOffset.UtcNow, payload,
            new EventMetadata(Guid.NewGuid(), null, null, null));

    [Fact]
    public void NoteCreated_adds_detail_with_empty_title_and_content()
    {
        var noteId = Guid.NewGuid();
        var projection = new NoteDetailProjection();

        projection.Handle(Envelope($"note#{noteId}", 1, nameof(NoteCreated),
            JsonSerializer.Serialize(new NoteCreated(new NoteId(noteId)))));

        var detail = projection.GetDetail(new NoteId(noteId));
        Assert.NotNull(detail);
        Assert.Equal(new NoteId(noteId), detail.NoteId);
        Assert.Equal(string.Empty, detail.Title);
        Assert.Equal(string.Empty, detail.Content);
    }

    [Fact]
    public void NoteCreated_sets_createdAt_and_lastModifiedAt_from_envelope()
    {
        var noteId = Guid.NewGuid();
        var createdAt = new DateTimeOffset(2026, 5, 1, 10, 0, 0, TimeSpan.Zero);
        var projection = new NoteDetailProjection();

        projection.Handle(Envelope($"note#{noteId}", 1, nameof(NoteCreated),
            JsonSerializer.Serialize(new NoteCreated(new NoteId(noteId))), createdAt));

        var detail = projection.GetDetail(new NoteId(noteId));
        Assert.Equal(createdAt, detail!.CreatedAt);
        Assert.Equal(createdAt, detail.LastModifiedAt);
    }

    [Fact]
    public void NoteRenamed_updates_title_and_lastModifiedAt()
    {
        var noteId = Guid.NewGuid();
        var createdAt = new DateTimeOffset(2026, 5, 1, 10, 0, 0, TimeSpan.Zero);
        var renamedAt = createdAt.AddSeconds(30);
        var projection = new NoteDetailProjection();
        projection.Handle(Envelope($"note#{noteId}", 1, nameof(NoteCreated),
            JsonSerializer.Serialize(new NoteCreated(new NoteId(noteId))), createdAt));

        projection.Handle(Envelope($"note#{noteId}", 2, nameof(NoteRenamed),
            JsonSerializer.Serialize(new NoteRenamed(new NoteId(noteId), "Bill 1:1")), renamedAt));

        var detail = projection.GetDetail(new NoteId(noteId));
        Assert.Equal("Bill 1:1", detail!.Title);
        Assert.Equal(createdAt, detail.CreatedAt);
        Assert.Equal(renamedAt, detail.LastModifiedAt);
    }

    [Fact(Skip = "Pip: implement NoteDetailProjection.Handle(NoteDateSet)")]
    public void NoteDateSet_updates_date_in_detail()
    {
        var noteId = Guid.NewGuid();
        var date = new DateOnly(2026, 4, 21);
        var projection = new NoteDetailProjection();
        projection.Handle(Envelope($"note#{noteId}", 1, nameof(NoteCreated),
            JsonSerializer.Serialize(new NoteCreated(new NoteId(noteId)))));

        projection.Handle(Envelope($"note#{noteId}", 2, nameof(NoteDateSet),
            JsonSerializer.Serialize(new NoteDateSet(new NoteId(noteId), date))));

        var detail = projection.GetDetail(new NoteId(noteId));
        Assert.Equal(date, detail!.Date);
    }

    [Fact(Skip = "Pip: implement NoteDetailProjection.Handle(NoteDateSet)")]
    public void NoteDateSet_null_clears_date_in_detail()
    {
        var noteId = Guid.NewGuid();
        var date = new DateOnly(2026, 4, 21);
        var projection = new NoteDetailProjection();
        projection.Handle(Envelope($"note#{noteId}", 1, nameof(NoteCreated),
            JsonSerializer.Serialize(new NoteCreated(new NoteId(noteId)))));
        projection.Handle(Envelope($"note#{noteId}", 2, nameof(NoteDateSet),
            JsonSerializer.Serialize(new NoteDateSet(new NoteId(noteId), date))));

        projection.Handle(Envelope($"note#{noteId}", 3, nameof(NoteDateSet),
            JsonSerializer.Serialize(new NoteDateSet(new NoteId(noteId), null))));

        var detail = projection.GetDetail(new NoteId(noteId));
        Assert.Null(detail!.Date);
    }

    [Fact]
    public void GetDetail_unknown_note_returns_null()
    {
        var projection = new NoteDetailProjection();

        var detail = projection.GetDetail(new NoteId(Guid.NewGuid()));

        Assert.Null(detail);
    }

    [Fact]
    public void ContentEdited_updates_content_and_lastModifiedAt()
    {
        var noteId = Guid.NewGuid();
        var createdAt = new DateTimeOffset(2026, 5, 1, 10, 0, 0, TimeSpan.Zero);
        var editedAt = createdAt.AddMinutes(5);
        var projection = new NoteDetailProjection();
        projection.Handle(Envelope($"note#{noteId}", 1, nameof(NoteCreated),
            JsonSerializer.Serialize(new NoteCreated(new NoteId(noteId))), createdAt));

        projection.Handle(Envelope($"note#{noteId}", 2, nameof(ContentEdited),
            JsonSerializer.Serialize(new ContentEdited(new NoteId(noteId), "Meeting notes content")), editedAt));

        var detail = projection.GetDetail(new NoteId(noteId));
        Assert.Equal("Meeting notes content", detail!.Content);
        Assert.Equal(createdAt, detail.CreatedAt);
        Assert.Equal(editedAt, detail.LastModifiedAt);
    }
}
