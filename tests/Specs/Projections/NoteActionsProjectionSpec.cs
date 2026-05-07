using System.Text.Json;
using Domain.ActionItems;
using Domain.Notes;
using EventStore;
using EventStore.Projections;

namespace Specs.Projections;

public sealed class NoteActionsProjectionSpec
{
    static readonly ActionId ActionId = new(Guid.Parse("00000000-0000-0000-0000-000000000001"));
    static readonly NoteId NoteId = new(Guid.Parse("00000000-0000-0000-0000-000000000002"));

    static EventEnvelope Envelope(string streamId, long seq, string type, string payload) =>
        new(streamId, seq, type, 1, DateTimeOffset.UtcNow, payload, new EventMetadata(Guid.NewGuid(), null, null, null));

    [Fact]
    public void ActionItemAdded_adds_item_to_view()
    {
        var projection = new NoteActionsProjection();

        projection.Handle(Envelope(ActionId.ToStreamId(), 1, nameof(ActionItemAdded),
            JsonSerializer.Serialize(new ActionItemAdded(ActionId, NoteId, "Book meeting room"))));

        var view = projection.GetView(NoteId);
        Assert.Single(view.Actions);
        Assert.Equal(ActionId, view.Actions[0].ActionId);
        Assert.Equal("Book meeting room", view.Actions[0].Description);
        Assert.False(view.Actions[0].Completed);
    }

    [Fact(Skip = "Pip: implement ActionItemDeleted handling")]
    public void ActionItemDeleted_RemovesItemFromView()
    {
        var projection = new NoteActionsProjection();

        projection.Handle(Envelope(ActionId.ToStreamId(), 1, nameof(ActionItemAdded),
            JsonSerializer.Serialize(new ActionItemAdded(ActionId, NoteId, "Old task"))));
        projection.Handle(Envelope(ActionId.ToStreamId(), 2, nameof(ActionItemDeleted),
            JsonSerializer.Serialize(new ActionItemDeleted(ActionId, DateTimeOffset.UtcNow))));

        var view = projection.GetView(NoteId);
        Assert.Empty(view.Actions);
    }

    [Fact]
    public void EmptyProjectionReturnsNoActionsForNote()
    {
        var projection = new NoteActionsProjection();

        var view = projection.GetView(NoteId);
        Assert.Empty(view.Actions);
    }
}
