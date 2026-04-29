using EventStore;

namespace Specs.EventStore;

public sealed class EventStoreSpec
{
    static EventEnvelope Event(string type) => new(
        StreamId: "",
        SequenceNumber: 0,
        EventType: type,
        EventVersion: 1,
        OccurredAt: DateTimeOffset.UtcNow,
        Payload: "{}",
        Metadata: new EventMetadata(Guid.NewGuid(), null, null, null));

    [Fact]
    public async Task AppendsToNewStreamWithSequenceNumbersStartingAt1()
    {
        var store = new InMemoryEventStore();
        var streamId = "note#" + Guid.NewGuid();

        await store.AppendAsync(streamId, expectedVersion: 0, [Event("NoteCreated")]);

        var events = await store.ReadAsync(streamId);
        Assert.Single(events);
        Assert.Equal(1, events[0].SequenceNumber);
        Assert.Equal(streamId, events[0].StreamId);
    }

    [Fact]
    public async Task AppendsSubsequentEventsWithIncrementingSequenceNumbers()
    {
        var store = new InMemoryEventStore();
        var streamId = "note#" + Guid.NewGuid();

        await store.AppendAsync(streamId, expectedVersion: 0, [Event("NoteCreated")]);
        await store.AppendAsync(streamId, expectedVersion: 1, [Event("NoteRenamed")]);

        var events = await store.ReadAsync(streamId);
        Assert.Equal(2, events.Count);
        Assert.Equal(1, events[0].SequenceNumber);
        Assert.Equal(2, events[1].SequenceNumber);
    }

    [Fact]
    public async Task ThrowsConcurrencyExceptionWhenExpectedVersionIsStale()
    {
        var store = new InMemoryEventStore();
        var streamId = "note#" + Guid.NewGuid();

        await store.AppendAsync(streamId, expectedVersion: 0, [Event("NoteCreated")]);

        await Assert.ThrowsAsync<ConcurrencyException>(() =>
            store.AppendAsync(streamId, expectedVersion: 0, [Event("NoteRenamed")]));
    }

    [Fact]
    public async Task ReadsEventsInSequenceOrder()
    {
        var store = new InMemoryEventStore();
        var streamId = "note#" + Guid.NewGuid();

        await store.AppendAsync(streamId, expectedVersion: 0, [Event("NoteCreated")]);
        await store.AppendAsync(streamId, expectedVersion: 1, [Event("NoteRenamed")]);
        await store.AppendAsync(streamId, expectedVersion: 2, [Event("NoteRenamed")]);

        var events = await store.ReadAsync(streamId);
        Assert.Equal(new[] { 1L, 2L, 3L }, events.Select(e => e.SequenceNumber));
        Assert.Equal(new[] { "NoteCreated", "NoteRenamed", "NoteRenamed" }, events.Select(e => e.EventType));
    }
}
