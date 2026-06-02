using System.Text.Json;
using Domain.ActionItems;
using Domain.Notes;
using EventStore;
using EventStore.Projections;

namespace Domain.Specs.Projections;

public sealed class ActionItemFeedbackProjectionSpec
{
    static readonly NoteId NoteId1 = new(Guid.Parse("00000000-0000-0000-0000-000000000001"));
    static readonly ActionId Action1 = new(Guid.Parse("11111111-1111-1111-1111-111111111111"));
    static readonly ActionId Action2 = new(Guid.Parse("22222222-2222-2222-2222-222222222222"));
    const string Alice = "alice";

    static EventEnvelope Suggested(string userId, params ActionId[] ids) =>
        new($"note#{NoteId1.Value}", 1, nameof(ActionItemsSuggested), 1, DateTimeOffset.UtcNow,
            JsonSerializer.Serialize(new ActionItemsSuggested(NoteId1, ids.Select(a => a.Value).ToList())),
            new EventMetadata(Guid.NewGuid(), userId, null, null));

    static EventEnvelope Deleted(ActionId id) =>
        new($"action#{id.Value}", 2, nameof(ActionItemDeleted), 1, DateTimeOffset.UtcNow,
            JsonSerializer.Serialize(new ActionItemDeleted(id, DateTimeOffset.UtcNow)),
            new EventMetadata(Guid.NewGuid(), "", null, null));

    static EventEnvelope Completed(ActionId id) =>
        new($"action#{id.Value}", 2, nameof(ActionItemCompleted), 1, DateTimeOffset.UtcNow,
            JsonSerializer.Serialize(new ActionItemCompleted(id, DateTimeOffset.UtcNow)),
            new EventMetadata(Guid.NewGuid(), "", null, null));

    static ActionItemFeedbackView? Find(ActionItemFeedbackProjection p, string userId) =>
        p.GetAggregates().FirstOrDefault(v => v.UserId == userId);

    [Fact]
    public void SuggestedAction_IncrementsSuggestedCount()
    {
        var p = new ActionItemFeedbackProjection();
        p.Handle(Suggested(Alice, Action1));

        var view = Find(p, Alice);
        Assert.NotNull(view);
        Assert.Equal(1, view!.SuggestedCount);
        Assert.Equal(0, view.DeletedCount);
        Assert.Equal(0, view.CompletedCount);
    }

    [Fact]
    public void DeletingSuggestedAction_IncrementsDeletedCount()
    {
        var p = new ActionItemFeedbackProjection();
        p.Handle(Suggested(Alice, Action1));
        p.Handle(Deleted(Action1));

        Assert.Equal(1, Find(p, Alice)!.DeletedCount);
    }

    [Fact]
    public void CompletingSuggestedAction_IncrementsCompletedCount()
    {
        var p = new ActionItemFeedbackProjection();
        p.Handle(Suggested(Alice, Action1));
        p.Handle(Completed(Action1));

        Assert.Equal(1, Find(p, Alice)!.CompletedCount);
    }

    [Fact]
    public void DeletingManuallyAddedAction_IsNotCounted()
    {
        var p = new ActionItemFeedbackProjection();
        p.Handle(Deleted(Action2));

        Assert.Empty(p.GetAggregates());
    }

    // The suggestion lives on the note stream while the deletion lives on the action stream;
    // ReadAllStreamsAsync orders by StreamId (action# before note#), so the projection must
    // count correctly even when a deletion is replayed before its suggestion.
    [Fact]
    public void OrderIndependent_DeletionBeforeSuggestion_StillCounts()
    {
        var p = new ActionItemFeedbackProjection();
        p.Handle(Deleted(Action1));
        p.Handle(Suggested(Alice, Action1));

        var view = Find(p, Alice);
        Assert.NotNull(view);
        Assert.Equal(1, view!.SuggestedCount);
        Assert.Equal(1, view.DeletedCount);
    }

    [Fact]
    public void MultipleSuggestedActions_EachCountedForUser()
    {
        var p = new ActionItemFeedbackProjection();
        p.Handle(Suggested(Alice, Action1, Action2));
        p.Handle(Completed(Action1));
        p.Handle(Deleted(Action2));

        var view = Find(p, Alice);
        Assert.Equal(2, view!.SuggestedCount);
        Assert.Equal(1, view.CompletedCount);
        Assert.Equal(1, view.DeletedCount);
    }
}
