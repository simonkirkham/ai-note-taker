using Amazon.DynamoDBv2;
using Amazon.DynamoDBv2.Model;
using Domain.Notes;
using EventStore.Projections;

namespace EventStore.Integration;

// 33-B2: NoteDetail.OwnerName must survive the real DynamoDB round-trip — the in-memory
// Api.Integration store keeps the whole view by reference and so cannot catch a missing
// UpsertAsync/MapItemToNoteDetailView mapping. The headless re-analysis reads OwnerName from this
// store in prod, so the persisted-then-read value is load-bearing.
public sealed class DynamoDbNoteDetailStoreTests(DynamoDbFixture fixture) : IClassFixture<DynamoDbFixture>
{
    private readonly IAmazonDynamoDB _dynamo = fixture.DynamoDb;

    [Fact]
    public async Task OwnerName_RoundTripsThroughDynamo()
    {
        var store = await NewStoreAsync();
        var noteId = new NoteId(Guid.NewGuid());
        await store.UpsertAsync(new NoteDetailView(noteId, "Title", "content",
            DateTimeOffset.UtcNow, DateTimeOffset.UtcNow, UserId: "user-1", OwnerName: "Alice Smith"));

        var read = await store.GetAsync(noteId);

        Assert.Equal("Alice Smith", read!.OwnerName);
    }

    [Fact]
    public async Task OwnerName_DefaultsToEmpty_WhenAbsent()
    {
        var store = await NewStoreAsync();
        var noteId = new NoteId(Guid.NewGuid());
        await store.UpsertAsync(new NoteDetailView(noteId, "Title", "content",
            DateTimeOffset.UtcNow, DateTimeOffset.UtcNow, UserId: "user-1")); // no OwnerName (e.g. pre-33-B2 note)

        var read = await store.GetAsync(noteId);

        Assert.Equal("", read!.OwnerName);
    }

    private async Task<DynamoDbNoteDetailStore> NewStoreAsync()
    {
        var tableName = $"test-notedetail-{Guid.NewGuid():N}";
        await _dynamo.CreateTableAsync(new CreateTableRequest
        {
            TableName = tableName,
            AttributeDefinitions = [new AttributeDefinition { AttributeName = "PK", AttributeType = ScalarAttributeType.S }],
            KeySchema = [new KeySchemaElement { AttributeName = "PK", KeyType = KeyType.HASH }],
            BillingMode = BillingMode.PAY_PER_REQUEST
        });
        return new DynamoDbNoteDetailStore(_dynamo, tableName);
    }
}
