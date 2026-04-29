using System.Text.Json;
using Domain.Notes;
using EventStore;
using EventStore.Projections;

namespace Specs.Projections;

public sealed class NoteTitleListSpec
{
    private static EventEnvelope Envelope(string streamId, long seq, string type, string payload) =>
        new(streamId, seq, type, 1, DateTimeOffset.UtcNow, payload, new EventMetadata(Guid.NewGuid(), null, null, null));

    [Fact(Skip = "Pip: implement NoteTitleListProjection")]
    public void NoteCreated_adds_item_with_empty_title()
    {
        var noteId = Guid.NewGuid();
        var projection = new NoteTitleListProjection();

        projection.Handle(Envelope($"note#{noteId}", 1, nameof(NoteCreated),
            JsonSerializer.Serialize(new NoteCreated(new NoteId(noteId)))));

        var view = projection.GetView();
        Assert.Single(view.Items);
        Assert.Equal(new NoteId(noteId), view.Items[0].NoteId);
        Assert.Equal(string.Empty, view.Items[0].Title);
    }

    [Fact(Skip = "Pip: implement NoteTitleListProjection")]
    public void NoteRenamed_updates_title()
    {
        var noteId = Guid.NewGuid();
        var projection = new NoteTitleListProjection();
        projection.Handle(Envelope($"note#{noteId}", 1, nameof(NoteCreated),
            JsonSerializer.Serialize(new NoteCreated(new NoteId(noteId)))));

        projection.Handle(Envelope($"note#{noteId}", 2, nameof(NoteRenamed),
            JsonSerializer.Serialize(new NoteRenamed(new NoteId(noteId), "My Title"))));

        var view = projection.GetView();
        Assert.Single(view.Items);
        Assert.Equal("My Title", view.Items[0].Title);
    }

    [Fact(Skip = "Pip: implement NoteTitleListProjection")]
    public void NoteRenamed_noop_leaves_single_item()
    {
        var noteId = Guid.NewGuid();
        var projection = new NoteTitleListProjection();
        projection.Handle(Envelope($"note#{noteId}", 1, nameof(NoteCreated),
            JsonSerializer.Serialize(new NoteCreated(new NoteId(noteId)))));
        projection.Handle(Envelope($"note#{noteId}", 2, nameof(NoteRenamed),
            JsonSerializer.Serialize(new NoteRenamed(new NoteId(noteId), "Same"))));

        projection.Handle(Envelope($"note#{noteId}", 3, nameof(NoteRenamed),
            JsonSerializer.Serialize(new NoteRenamed(new NoteId(noteId), "Same"))));

        var view = projection.GetView();
        Assert.Single(view.Items);
        Assert.Equal("Same", view.Items[0].Title);
    }
}
