using System.Text.Json;
using Domain.Notes;
using EventStore;
using EventStore.Projections;

namespace Domain.Specs.Projections;

public sealed class NoteSearchViewTagSpec
{
    static readonly NoteId NoteId1 = new(Guid.Parse("00000000-0000-0000-0000-000000000001"));

    static EventEnvelope NoteEnv(long seq, string type, string payload) =>
        new($"note#{NoteId1.Value}", seq, type, 1, DateTimeOffset.UtcNow, payload,
            new EventMetadata(Guid.NewGuid(), null, null, null));

    [Fact]
    public void NoteTagged_lowercases_and_dedupes_search_tags()
    {
        // Legacy data: "Foo" then "foo" collapse to one lowercase "foo" on rebuild so a
        // lowercase search token matches (CHANGE-17).
        var projection = new NoteSearchViewProjection();
        projection.Handle(NoteEnv(1, nameof(NoteCreated),
            JsonSerializer.Serialize(new NoteCreated(NoteId1))));
        projection.Handle(NoteEnv(2, nameof(NoteTagged),
            JsonSerializer.Serialize(new NoteTagged(NoteId1, "Foo"))));
        projection.Handle(NoteEnv(3, nameof(NoteTagged),
            JsonSerializer.Serialize(new NoteTagged(NoteId1, "foo"))));

        Assert.Equal(new[] { "foo" }, projection.GetAll().Single().Tags);
    }

    [Fact]
    public void NoteUntagged_removes_search_tag_case_insensitively()
    {
        var projection = new NoteSearchViewProjection();
        projection.Handle(NoteEnv(1, nameof(NoteCreated),
            JsonSerializer.Serialize(new NoteCreated(NoteId1))));
        projection.Handle(NoteEnv(2, nameof(NoteTagged),
            JsonSerializer.Serialize(new NoteTagged(NoteId1, "Foo"))));
        projection.Handle(NoteEnv(3, nameof(NoteUntagged),
            JsonSerializer.Serialize(new NoteUntagged(NoteId1, "FOO"))));

        Assert.Empty(projection.GetAll().Single().Tags);
    }
}
