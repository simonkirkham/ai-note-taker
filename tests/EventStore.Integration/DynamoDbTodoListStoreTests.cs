using Amazon.DynamoDBv2;
using Amazon.DynamoDBv2.Model;
using EventStore.Projections;

namespace EventStore.Integration;

// The in-memory Api.Integration double keeps the whole TodoItem by reference, so a new field like
// Position round-trips for free there. Only DynamoDB Local proves the explicit attribute mapping
// (PutAsync write + ToTodoItem read) and the conditional UpdateItem in UpdatePositionsAsync.
public sealed class DynamoDbTodoListStoreTests(DynamoDbFixture fixture) : IClassFixture<DynamoDbFixture>
{
    private readonly IAmazonDynamoDB _dynamo = fixture.DynamoDb;

    [Fact]
    public async Task Position_SurvivesTheRoundTrip()
    {
        var store = await NewStoreAsync();
        await store.PutAsync(Todo("id-1", "Buy milk", DateTimeOffset.UtcNow, position: 5));

        var got = await store.GetByIdAsync("id-1");

        Assert.Equal(5, got!.Position);
    }

    [Fact]
    public async Task UpdatePositions_SetsAndSortsByExplicitOrder()
    {
        var store = await NewStoreAsync();
        await store.PutAsync(Todo("a", "A", T(1)));
        await store.PutAsync(Todo("b", "B", T(2)));
        await store.PutAsync(Todo("c", "C", T(3)));

        await store.UpdatePositionsAsync(["c", "a", "b"]);

        var items = (await store.QueryAllAsync()).Items;
        Assert.Equal(["c", "a", "b"], items.Select(i => i.ItemId));
    }

    [Fact]
    public async Task UpdatePositions_IgnoresStaleId_WithoutCreatingPhantomRow()
    {
        var store = await NewStoreAsync();
        await store.PutAsync(Todo("real", "Real", T(1)));

        await store.UpdatePositionsAsync(["ghost", "real"]);

        var items = (await store.QueryAllAsync()).Items;
        Assert.Single(items);
        Assert.Equal("real", items[0].ItemId);
        Assert.Equal(1, items[0].Position);
    }

    private static DateTimeOffset T(int min) => new(2026, 6, 25, 9, min, 0, TimeSpan.Zero);

    private static TodoItem Todo(string id, string description, DateTimeOffset addedAt, int? position = null) =>
        new(id, NoteId: null, NoteTitle: null, Type: "todo", Description: description,
            AddedAt: addedAt, CompletedAt: null, UserId: "user-1", WorkspaceId: "ws-1", Position: position);

    private async Task<DynamoDbTodoListStore> NewStoreAsync()
    {
        var tableName = $"test-todolist-{Guid.NewGuid():N}";
        await _dynamo.CreateTableAsync(new CreateTableRequest
        {
            TableName = tableName,
            AttributeDefinitions = [new AttributeDefinition { AttributeName = "PK", AttributeType = ScalarAttributeType.S }],
            KeySchema = [new KeySchemaElement { AttributeName = "PK", KeyType = KeyType.HASH }],
            BillingMode = BillingMode.PAY_PER_REQUEST
        });
        return new DynamoDbTodoListStore(_dynamo, tableName);
    }
}
