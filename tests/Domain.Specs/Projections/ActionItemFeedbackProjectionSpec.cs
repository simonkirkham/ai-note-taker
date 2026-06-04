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
    const string Model = "amazon.nova-lite-v1:0";
    const string PromptV1 = "analysis@v1";

    // The aggregate emits ActionItemsSuggestedV2 from 10-M onward, so the default fixture is a v2 event.
    static EventEnvelope Suggested(string userId, params ActionId[] ids) =>
        SuggestedWithPrompt(userId, PromptV1, ids);

    static EventEnvelope SuggestedWithPrompt(string userId, string promptVersion, params ActionId[] ids) =>
        new($"note#{NoteId1.Value}", 1, nameof(ActionItemsSuggested), 2, DateTimeOffset.UtcNow,
            JsonSerializer.Serialize(new ActionItemsSuggestedV2(NoteId1, ids.Select(a => a.Value).ToList(), Model, promptVersion)),
            new EventMetadata(Guid.NewGuid(), userId, null, null));

    // A pre-10-M event: stored under version 1 with the original (unstamped) shape.
    static EventEnvelope SuggestedV1(string userId, params ActionId[] ids) =>
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

    static ActionItemFeedbackProvenance? Provenance(ActionItemFeedbackProjection p, ActionId id) =>
        p.GetProvenance().FirstOrDefault(x => x.ActionItemId == id.Value.ToString());

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

    // 10-M: the v2 event stamps its prompt version onto the provenance row.
    [Fact]
    public void SuggestedV2_StampsPromptVersionOnProvenance()
    {
        var p = new ActionItemFeedbackProjection();
        p.Handle(SuggestedWithPrompt(Alice, "analysis@v2", Action1));

        Assert.Equal("analysis@v2", Provenance(p, Action1)!.PromptVersion);
    }

    // 10-M: a pre-10-M v1 event rebuilds unchanged; its provenance carries "unknown".
    [Fact]
    public void SuggestedV1_CountsUnchanged_ProvenanceMarkedUnknown()
    {
        var p = new ActionItemFeedbackProjection();
        p.Handle(SuggestedV1(Alice, Action1));

        Assert.Equal(1, Find(p, Alice)!.SuggestedCount);
        Assert.Equal(ActionItemFeedbackProjection.UnknownPromptVersion, Provenance(p, Action1)!.PromptVersion);
    }
}
