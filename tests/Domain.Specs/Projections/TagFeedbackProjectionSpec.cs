using System.Text.Json;
using Domain.Notes;
using EventStore;
using EventStore.Projections;

namespace Domain.Specs.Projections;

public sealed class TagFeedbackProjectionSpec
{
    static readonly NoteId NoteId1 = new(Guid.Parse("00000000-0000-0000-0000-000000000001"));
    const string Alice = "alice";

    static EventEnvelope Env(NoteId noteId, long seq, string userId, string type, string payload) =>
        new($"note#{noteId.Value}", seq, type, 1, DateTimeOffset.UtcNow, payload,
            new EventMetadata(Guid.NewGuid(), userId, null, null));

    static EventEnvelope Suggested(NoteId noteId, long seq, string userId, params string[] tags) =>
        Env(noteId, seq, userId, nameof(TagsSuggested),
            JsonSerializer.Serialize(new TagsSuggested(noteId, tags)));

    static EventEnvelope Untagged(NoteId noteId, long seq, string tag) =>
        Env(noteId, seq, userId: "", nameof(NoteUntagged),
            JsonSerializer.Serialize(new NoteUntagged(noteId, tag)));

    static EventEnvelope Tagged(NoteId noteId, long seq, string tag) =>
        Env(noteId, seq, userId: "", nameof(NoteTagged),
            JsonSerializer.Serialize(new NoteTagged(noteId, tag)));

    static EventEnvelope Deleted(NoteId noteId, long seq) =>
        Env(noteId, seq, userId: "", nameof(NoteDeleted),
            JsonSerializer.Serialize(new NoteDeleted(noteId)));

    static TagFeedbackView? Find(TagFeedbackProjection p, string userId, string tag) =>
        p.GetAggregates().FirstOrDefault(v => v.UserId == userId && v.Tag == tag);

    [Fact]
    public void SuggestedTag_IncrementsSuggestedCount()
    {
        var p = new TagFeedbackProjection();
        p.Handle(Suggested(NoteId1, 1, Alice, "auth"));

        var view = Find(p, Alice, "auth");
        Assert.NotNull(view);
        Assert.Equal(1, view!.SuggestedCount);
        Assert.Equal(0, view.RejectedCount);
    }

    [Fact]
    public void RemovingSuggestedTag_IncrementsRejectedCount()
    {
        var p = new TagFeedbackProjection();
        p.Handle(Suggested(NoteId1, 1, Alice, "auth"));
        p.Handle(Untagged(NoteId1, 2, "auth"));

        var view = Find(p, Alice, "auth");
        Assert.NotNull(view);
        Assert.Equal(1, view!.SuggestedCount);
        Assert.Equal(1, view.RejectedCount);
    }

    [Fact]
    public void RemovingManuallyAddedTag_IsNotARejection()
    {
        var p = new TagFeedbackProjection();
        p.Handle(Untagged(NoteId1, 1, "auth"));

        Assert.Empty(p.GetAggregates());
    }

    [Fact]
    public void RejectionCountsOncePerSuggestion()
    {
        var p = new TagFeedbackProjection();
        p.Handle(Suggested(NoteId1, 1, Alice, "auth"));
        p.Handle(Untagged(NoteId1, 2, "auth"));
        p.Handle(Tagged(NoteId1, 3, "auth"));
        p.Handle(Untagged(NoteId1, 4, "auth"));

        var view = Find(p, Alice, "auth");
        Assert.NotNull(view);
        Assert.Equal(1, view!.RejectedCount);
    }

    [Fact]
    public void DeletingNote_ClearsProvenanceButNotCounts()
    {
        var p = new TagFeedbackProjection();
        p.Handle(Suggested(NoteId1, 1, Alice, "auth"));
        p.Handle(Deleted(NoteId1, 2));

        var view = Find(p, Alice, "auth");
        Assert.NotNull(view);
        Assert.Equal(1, view!.SuggestedCount);
        Assert.Equal(0, view.RejectedCount);
        Assert.Empty(p.GetProvenance());
    }

    [Fact]
    public void DeletedNote_UntagDoesNotCountAsRejection()
    {
        var p = new TagFeedbackProjection();
        p.Handle(Suggested(NoteId1, 1, Alice, "auth"));
        p.Handle(Deleted(NoteId1, 2));
        p.Handle(Untagged(NoteId1, 3, "auth"));

        Assert.Equal(0, Find(p, Alice, "auth")!.RejectedCount);
    }

    [Fact]
    public void UntagThenDelete_CountsRejectionThenClearsProvenance()
    {
        var p = new TagFeedbackProjection();
        p.Handle(Suggested(NoteId1, 1, Alice, "auth"));
        p.Handle(Untagged(NoteId1, 2, "auth"));
        p.Handle(Deleted(NoteId1, 3));

        var view = Find(p, Alice, "auth");
        Assert.NotNull(view);
        Assert.Equal(1, view!.SuggestedCount);
        Assert.Equal(1, view.RejectedCount);
        Assert.Empty(p.GetProvenance());
    }

    [Fact]
    public void MultipleTagsInOneSuggestion_EachCounted()
    {
        var p = new TagFeedbackProjection();
        p.Handle(Suggested(NoteId1, 1, Alice, "auth", "login"));

        Assert.Equal(1, Find(p, Alice, "auth")!.SuggestedCount);
        Assert.Equal(1, Find(p, Alice, "login")!.SuggestedCount);
    }
}
