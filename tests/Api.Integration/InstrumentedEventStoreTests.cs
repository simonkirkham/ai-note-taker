using Api.Observability;
using EventStore;
using Microsoft.Extensions.Logging.Abstractions;

namespace Api.Integration;

public sealed class InstrumentedEventStoreTests
{
    private static readonly DateTimeOffset FixedTime = new(2026, 1, 1, 0, 0, 0, TimeSpan.Zero);

    private static InstrumentedEventStore NewStore(RecordingDomainMetrics metrics) =>
        new(new InMemoryEventStore(), metrics, NullLogger<InstrumentedEventStore>.Instance);

    private static EventEnvelope Envelope(string streamId) =>
        new(streamId, 0, "TestEvent", 1, FixedTime, "{}", new EventMetadata(Guid.Empty, "user", null, null));

    [Fact]
    public async Task Append_RecordsEventsAppended_WithAggregateDerivedFromStreamId()
    {
        var metrics = new RecordingDomainMetrics();
        var store = NewStore(metrics);

        await store.AppendAsync("note#abc", 0, [Envelope("note#abc"), Envelope("note#abc")]);

        Assert.Contains(metrics.Appended, a => a.Aggregate == "Note" && a.Count == 2);
        Assert.Empty(metrics.Conflicts);
    }

    [Fact]
    public async Task Append_OnConcurrencyConflict_RecordsConflict_AndRethrows()
    {
        var metrics = new RecordingDomainMetrics();
        var store = NewStore(metrics);

        // Fresh stream is at version 0; expecting version 5 forces a conflict.
        await Assert.ThrowsAsync<ConcurrencyException>(
            () => store.AppendAsync("folder-abc", 5, [Envelope("folder-abc")]));

        Assert.Contains("Folder", metrics.Conflicts);
        Assert.Empty(metrics.Appended);
    }
}
