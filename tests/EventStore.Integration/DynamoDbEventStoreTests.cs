using Amazon.DynamoDBv2;
using Amazon.DynamoDBv2.Model;
using EventStore;

namespace EventStore.Integration;

public sealed class DynamoDbEventStoreTests(DynamoDbFixture fixture) : IClassFixture<DynamoDbFixture>
{
    private DynamoDbEventStore Store() => new(fixture.DynamoDb, fixture.TableName);
    private static string NewStreamId() => $"note-{Guid.NewGuid():N}";

    private static EventEnvelope Envelope(string eventType) => new(
        StreamId: "",
        SequenceNumber: 0,
        EventType: eventType,
        EventVersion: 1,
        OccurredAt: DateTimeOffset.UtcNow,
        Payload: "{}",
        Metadata: new EventMetadata(Guid.NewGuid(), null, null, null));

    [Fact]
    public async Task AppendAndRead_SingleEvent_RoundTrips()
    {
        var streamId = NewStreamId();
        var envelope = Envelope("NoteCreated");

        await Store().AppendAsync(streamId, 0, [envelope]);
        var events = await Store().ReadAsync(streamId);

        var e = Assert.Single(events);
        Assert.Equal(streamId, e.StreamId);
        Assert.Equal(1L, e.SequenceNumber);
        Assert.Equal("NoteCreated", e.EventType);
        Assert.Equal(1, e.EventVersion);
        Assert.Equal("{}", e.Payload);
    }

    [Fact]
    public async Task AppendAndRead_MultipleEvents_PreservesOrder()
    {
        var streamId = NewStreamId();
        EventEnvelope[] envelopes =
        [
            Envelope("NoteCreated"),
            Envelope("NoteRenamed"),
            Envelope("NoteRenamed")
        ];

        await Store().AppendAsync(streamId, 0, envelopes);
        var events = await Store().ReadAsync(streamId);

        Assert.Equal(3, events.Count);
        Assert.Equal([1L, 2L, 3L], events.Select(e => e.SequenceNumber));
        Assert.Equal(["NoteCreated", "NoteRenamed", "NoteRenamed"], events.Select(e => e.EventType));
    }

    [Fact]
    public async Task ReadAsync_EmptyStream_ReturnsEmpty()
    {
        var events = await Store().ReadAsync(NewStreamId());

        Assert.Empty(events);
    }

    [Fact]
    public async Task AppendAsync_OccConflict_ThrowsConcurrencyException()
    {
        var streamId = NewStreamId();
        await Store().AppendAsync(streamId, 0, [Envelope("NoteCreated")]);

        var ex = await Assert.ThrowsAsync<ConcurrencyException>(
            () => Store().AppendAsync(streamId, 0, [Envelope("NoteRenamed")]));

        Assert.Equal(streamId, ex.StreamId);
        Assert.Equal(0L, ex.ExpectedVersion);
    }

    [Fact]
    public async Task AppendAsync_SequentialVersions_Succeeds()
    {
        var streamId = NewStreamId();

        await Store().AppendAsync(streamId, 0, [Envelope("NoteCreated")]);
        await Store().AppendAsync(streamId, 1, [Envelope("NoteRenamed")]);
        var events = await Store().ReadAsync(streamId);

        Assert.Equal(2, events.Count);
        Assert.Equal("NoteCreated", events[0].EventType);
        Assert.Equal("NoteRenamed", events[1].EventType);
    }

    [Fact]
    public async Task AppendAsync_MetaRowReflectsVersion()
    {
        var streamId = NewStreamId();

        await Store().AppendAsync(streamId, 0, [Envelope("NoteCreated")]);

        var resp = await fixture.DynamoDb.GetItemAsync(new GetItemRequest
        {
            TableName = fixture.TableName,
            Key = new Dictionary<string, AttributeValue>
            {
                ["PK"] = new AttributeValue { S = streamId },
                ["SK"] = new AttributeValue { S = "META#stream" }
            }
        });

        Assert.True(resp.Item.ContainsKey("currentVersion"));
        Assert.Equal("1", resp.Item["currentVersion"].N);
    }
}
