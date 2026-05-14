using System.Text.Json;
using Domain.Notes;
using EventStore;
using EventStore.Projections;

namespace Specs.Projections;

public sealed class TagIndexProjectionSpec
{
    static readonly NoteId NoteId1 = new(Guid.Parse("00000000-0000-0000-0000-000000000001"));
    static readonly NoteId NoteId2 = new(Guid.Parse("00000000-0000-0000-0000-000000000002"));

    static EventEnvelope NoteEnv(long seq, string type, string payload) =>
        new($"note#{NoteId1.Value}", seq, type, 1, DateTimeOffset.UtcNow, payload,
            new EventMetadata(Guid.NewGuid(), null, null, null));

    static EventEnvelope NoteEnvFor(NoteId noteId, long seq, string type, string payload) =>
        new($"note#{noteId.Value}", seq, type, 1, DateTimeOffset.UtcNow, payload,
            new EventMetadata(Guid.NewGuid(), null, null, null));

    [Fact]
    public void NoteTagged_AddsEntry()
    {
        var projection = new TagIndexProjection();

        projection.Handle(NoteEnv(1, nameof(NoteTagged),
            JsonSerializer.Serialize(new NoteTagged(NoteId1, "1:1s"))));

        var all = projection.GetAll();
        Assert.Single(all);
        Assert.Equal("1:1s", all[0].Tag);
        Assert.Equal(NoteId1.Value.ToString("N"), all[0].NoteId);
    }

    [Fact]
    public void NoteUntagged_RemovesEntry()
    {
        var projection = new TagIndexProjection();
        projection.Handle(NoteEnv(1, nameof(NoteTagged),
            JsonSerializer.Serialize(new NoteTagged(NoteId1, "1:1s"))));

        projection.Handle(NoteEnv(2, nameof(NoteUntagged),
            JsonSerializer.Serialize(new NoteUntagged(NoteId1, "1:1s"))));

        Assert.Empty(projection.GetAll());
    }

    [Fact]
    public void NoteDeleted_RemovesAllEntries()
    {
        var projection = new TagIndexProjection();
        projection.Handle(NoteEnv(1, nameof(NoteTagged),
            JsonSerializer.Serialize(new NoteTagged(NoteId1, "1:1s"))));
        projection.Handle(NoteEnv(2, nameof(NoteTagged),
            JsonSerializer.Serialize(new NoteTagged(NoteId1, "standup"))));
        projection.Handle(NoteEnvFor(NoteId2, 1, nameof(NoteTagged),
            JsonSerializer.Serialize(new NoteTagged(NoteId2, "1:1s"))));

        projection.Handle(NoteEnv(3, nameof(NoteDeleted),
            JsonSerializer.Serialize(new NoteDeleted(NoteId1))));

        var all = projection.GetAll();
        Assert.Single(all);
        Assert.Equal("1:1s", all[0].Tag);
        Assert.Equal(NoteId2.Value.ToString("N"), all[0].NoteId);
    }
}
