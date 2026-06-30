using Amazon.DynamoDBv2;
using Amazon.DynamoDBv2.Model;
using EventStore.Projections;

namespace EventStore.Integration;

// Phase 44 re-link: the unlink projection deletes the freed meeting's row, but must NOT clobber a
// link another note has since made to that meeting under an at-least-once redelivery. DeleteForNoteAsync
// guards the delete with a DynamoDB ConditionExpression — behaviour the in-memory Api.Integration double
// cannot prove, so it is verified here against DynamoDB Local.
public sealed class DynamoDbCalendarLinkIndexStoreTests(DynamoDbFixture fixture) : IClassFixture<DynamoDbFixture>
{
    private readonly IAmazonDynamoDB _dynamo = fixture.DynamoDb;

    private static CalendarLinkView Link(string eventId, string noteId) =>
        new(eventId, noteId, null, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow.AddMinutes(30), "Meeting", "user-1");

    [Fact]
    public async Task DeleteForNote_RemovesRow_WhenOwnedByThatNote()
    {
        var store = await NewStoreAsync();
        await store.UpsertAsync(Link("evt_a", "note-x"));

        await store.DeleteForNoteAsync("evt_a", "note-x");

        Assert.Null(await store.GetByCalendarEventIdAsync("evt_a"));
    }

    [Fact]
    public async Task DeleteForNote_LeavesRowIntact_WhenOwnedByAnotherNote()
    {
        var store = await NewStoreAsync();
        // note-x vacated evt_a, note-y has since claimed it; a stale/replayed unlink for note-x arrives.
        await store.UpsertAsync(Link("evt_a", "note-y"));

        await store.DeleteForNoteAsync("evt_a", "note-x");

        var survivor = await store.GetByCalendarEventIdAsync("evt_a");
        Assert.NotNull(survivor);
        Assert.Equal("note-y", survivor!.NoteId);
    }

    [Fact]
    public async Task DeleteForNote_IsNoOp_WhenRowAbsent()
    {
        var store = await NewStoreAsync();

        await store.DeleteForNoteAsync("evt_missing", "note-x");

        Assert.Null(await store.GetByCalendarEventIdAsync("evt_missing"));
    }

    private async Task<DynamoDbCalendarLinkIndexStore> NewStoreAsync()
    {
        var tableName = $"test-calendarlink-{Guid.NewGuid():N}";
        await _dynamo.CreateTableAsync(new CreateTableRequest
        {
            TableName = tableName,
            AttributeDefinitions = [new AttributeDefinition { AttributeName = "CalendarEventId", AttributeType = ScalarAttributeType.S }],
            KeySchema = [new KeySchemaElement { AttributeName = "CalendarEventId", KeyType = KeyType.HASH }],
            BillingMode = BillingMode.PAY_PER_REQUEST
        });
        return new DynamoDbCalendarLinkIndexStore(_dynamo, tableName);
    }
}
