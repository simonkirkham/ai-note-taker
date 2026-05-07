using System.Text.Json;
using Domain.ActionItems;
using Domain.Notes;
using EventStore;
using EventStore.Projections;

namespace Specs.Projections;

public sealed class NoteActionsCompletionSpec
{
    static readonly ActionId ActionId = new(Guid.Parse("00000000-0000-0000-0000-000000000001"));
    static readonly NoteId NoteId = new(Guid.Parse("00000000-0000-0000-0000-000000000002"));
    static readonly DateTimeOffset At = new(2024, 1, 1, 12, 0, 0, TimeSpan.Zero);

    static EventEnvelope Envelope(string streamId, long seq, string type, string payload) =>
        new(streamId, seq, type, 1, DateTimeOffset.UtcNow, payload, new EventMetadata(Guid.NewGuid(), null, null, null));

    [Fact(Skip = "Pip 3-B")]
    public void ActionItemCompleted_marks_item_complete()
    {
        var projection = new NoteActionsProjection();
        projection.Handle(Envelope(ActionId.ToStreamId(), 1, nameof(ActionItemAdded),
            JsonSerializer.Serialize(new ActionItemAdded(ActionId, NoteId, "Chase invoice"))));
        projection.Handle(Envelope(ActionId.ToStreamId(), 2, nameof(ActionItemCompleted),
            JsonSerializer.Serialize(new ActionItemCompleted(ActionId, At))));

        var view = projection.GetView(NoteId);
        Assert.True(view.Actions[0].Completed);
        Assert.Equal(At, view.Actions[0].CompletedAt);
    }

    [Fact(Skip = "Pip 3-B")]
    public void ActionItemReopened_marks_item_open()
    {
        var projection = new NoteActionsProjection();
        projection.Handle(Envelope(ActionId.ToStreamId(), 1, nameof(ActionItemAdded),
            JsonSerializer.Serialize(new ActionItemAdded(ActionId, NoteId, "Chase invoice"))));
        projection.Handle(Envelope(ActionId.ToStreamId(), 2, nameof(ActionItemCompleted),
            JsonSerializer.Serialize(new ActionItemCompleted(ActionId, At))));
        projection.Handle(Envelope(ActionId.ToStreamId(), 3, nameof(ActionItemReopened),
            JsonSerializer.Serialize(new ActionItemReopened(ActionId, At))));

        var view = projection.GetView(NoteId);
        Assert.False(view.Actions[0].Completed);
        Assert.Null(view.Actions[0].CompletedAt);
    }
}
