using System.Text.Json;
using Domain.Notes;
using EventStore;
using EventStore.Projections;

namespace Domain.Specs.Projections;

public sealed class TagFeedbackProjectionSpec
{
    static readonly NoteId NoteId1 = new(Guid.Parse("00000000-0000-0000-0000-000000000001"));
    static readonly NoteId NoteId2 = new(Guid.Parse("00000000-0000-0000-0000-000000000002"));
    const string Alice = "alice";
    const string Model = "amazon.nova-lite-v1:0";
    const string PromptV1 = "analysis@v1";

    static EventEnvelope Env(NoteId noteId, long seq, string userId, string type, int version, string payload) =>
        new($"note#{noteId.Value}", seq, type, version, DateTimeOffset.UtcNow, payload,
            new EventMetadata(Guid.NewGuid(), userId, null, null));

    // The aggregate emits TagsSuggestedV2 from 10-M onward, so the projection's default fixture is a v2 event.
    static EventEnvelope Suggested(NoteId noteId, long seq, string userId, params string[] tags) =>
        SuggestedWithPrompt(noteId, seq, userId, PromptV1, tags);

    static EventEnvelope SuggestedWithPrompt(NoteId noteId, long seq, string userId, string promptVersion, params string[] tags) =>
        Env(noteId, seq, userId, nameof(TagsSuggested), 2,
            JsonSerializer.Serialize(new TagsSuggestedV2(noteId, tags, Model, promptVersion)));

    // A pre-10-M event: stored under version 1 with the original (unstamped) shape.
    static EventEnvelope SuggestedV1(NoteId noteId, long seq, string userId, params string[] tags) =>
        Env(noteId, seq, userId, nameof(TagsSuggested), 1,
            JsonSerializer.Serialize(new TagsSuggested(noteId, tags)));

    static EventEnvelope Untagged(NoteId noteId, long seq, string tag) =>
        Env(noteId, seq, userId: "", nameof(NoteUntagged), 1,
            JsonSerializer.Serialize(new NoteUntagged(noteId, tag)));

    static EventEnvelope Tagged(NoteId noteId, long seq, string tag) =>
        Env(noteId, seq, userId: "", nameof(NoteTagged), 1,
            JsonSerializer.Serialize(new NoteTagged(noteId, tag)));

    static EventEnvelope Deleted(NoteId noteId, long seq) =>
        Env(noteId, seq, userId: "", nameof(NoteDeleted), 1,
            JsonSerializer.Serialize(new NoteDeleted(noteId)));

    static TagFeedbackView? Find(TagFeedbackProjection p, string userId, string tag) =>
        p.GetAggregates().FirstOrDefault(v => v.UserId == userId && v.Tag == tag);

    static TagFeedbackProvenance? Provenance(TagFeedbackProjection p, NoteId noteId, string tag) =>
        p.GetProvenance().FirstOrDefault(x => x.NoteId == noteId.Value.ToString("N") && x.Tag == tag);

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

    // 10-M: the v2 event stamps its prompt version onto the provenance row.
    [Fact]
    public void SuggestedV2_StampsPromptVersionOnProvenance()
    {
        var p = new TagFeedbackProjection();
        p.Handle(SuggestedWithPrompt(NoteId1, 1, Alice, "analysis@v2", "auth"));

        Assert.Equal("analysis@v2", Provenance(p, NoteId1, "auth")!.PromptVersion);
    }

    // 10-M: a pre-10-M v1 event rebuilds unchanged; its provenance carries "unknown".
    [Fact]
    public void SuggestedV1_CountsUnchanged_ProvenanceMarkedUnknown()
    {
        var p = new TagFeedbackProjection();
        p.Handle(SuggestedV1(NoteId1, 1, Alice, "auth"));

        Assert.Equal(1, Find(p, Alice, "auth")!.SuggestedCount);
        Assert.Equal(TagFeedbackProjection.UnknownPromptVersion, Provenance(p, NoteId1, "auth")!.PromptVersion);
    }

    // 10-M scenario 3 (provenance-level): suggestions recorded under different prompt versions keep
    // their version in provenance, so feedback can be sliced per prompt version.
    [Fact]
    public void ProvenanceRetainsPromptVersionPerNote()
    {
        var p = new TagFeedbackProjection();
        p.Handle(SuggestedWithPrompt(NoteId1, 1, Alice, "analysis@v1", "auth"));
        p.Handle(SuggestedWithPrompt(NoteId2, 1, Alice, "analysis@v2", "auth"));

        Assert.Equal("analysis@v1", Provenance(p, NoteId1, "auth")!.PromptVersion);
        Assert.Equal("analysis@v2", Provenance(p, NoteId2, "auth")!.PromptVersion);
        Assert.Equal(2, Find(p, Alice, "auth")!.SuggestedCount);
    }
}
