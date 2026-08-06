using Amazon.DynamoDBv2;
using Amazon.DynamoDBv2.Model;
using EventStore.Projections;

namespace EventStore.Integration;

// The in-memory Api.Integration double keeps the whole TodoItem by reference, so a new field
// (Position — 37-A) or a field-level update (UpdateDescriptionAsync — 39-A) round-trips for free
// there. Only DynamoDB Local proves the explicit attribute mapping (PutAsync write + ToTodoItem
// read), the conditional UpdateItem in UpdatePositionsAsync, and that the SET Description
// UpdateExpression is well-formed and survives.
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

    [Fact]
    public async Task UpdateDescription_OverwritesText_AndSurvivesRoundTrip()
    {
        var store = await NewStoreAsync();
        var itemId = Guid.NewGuid().ToString();
        await store.PutAsync(new TodoItem(itemId, null, null, "todo", "Original text", DateTimeOffset.UtcNow, null, "user-1"));

        await store.UpdateDescriptionAsync(itemId, "Edited text");

        var item = await store.GetByIdAsync(itemId);
        Assert.NotNull(item);
        Assert.Equal("Edited text", item!.Description);
    }

    [Fact]
    public async Task UpdateDescription_LeavesOtherFieldsIntact()
    {
        var store = await NewStoreAsync();
        var itemId = Guid.NewGuid().ToString();
        var completedAt = new DateTimeOffset(2024, 1, 1, 12, 0, 0, TimeSpan.Zero);
        await store.PutAsync(new TodoItem(itemId, "note-1", "Planning", "action", "Original", DateTimeOffset.UtcNow, completedAt, "user-1", "ws-1"));

        await store.UpdateDescriptionAsync(itemId, "Edited");

        var item = await store.GetByIdAsync(itemId);
        Assert.NotNull(item);
        Assert.Equal("Edited", item!.Description);
        Assert.Equal("action", item.Type);
        Assert.Equal("Planning", item.NoteTitle);
        Assert.Equal(completedAt, item.CompletedAt);
        Assert.Equal("ws-1", item.WorkspaceId);
    }

    [Fact]
    public async Task TodayLine_SurvivesTheRoundTrip()
    {
        var store = await NewStoreAsync();

        await store.SetTodayLineAsync("user-1", "ws-1", "item-b");

        Assert.Equal("item-b", await store.GetTodayLineAnchorAsync("user-1", "ws-1"));
    }

    [Fact]
    public async Task TodayLine_IsUnsetWhenNeverWritten()
    {
        var store = await NewStoreAsync();

        Assert.Null(await store.GetTodayLineAnchorAsync("user-1", "ws-1"));
    }

    [Fact]
    public async Task TodayLine_IsScopedPerWorkspace()
    {
        var store = await NewStoreAsync();

        await store.SetTodayLineAsync("user-1", "ws-1", "item-a");
        await store.SetTodayLineAsync("user-1", "ws-2", "item-b");

        Assert.Equal("item-a", await store.GetTodayLineAnchorAsync("user-1", "ws-1"));
        Assert.Equal("item-b", await store.GetTodayLineAnchorAsync("user-1", "ws-2"));
    }

    // The rootless workspace resolves to a shared `__default__` id, so a workspace-only key would
    // let two users silently overwrite each other's line.
    [Fact]
    public async Task TodayLine_IsScopedPerUserNotJustPerWorkspace()
    {
        var store = await NewStoreAsync();

        await store.SetTodayLineAsync("user-1", "__default__", "item-a");
        await store.SetTodayLineAsync("user-2", "__default__", "item-b");

        Assert.Equal("item-a", await store.GetTodayLineAnchorAsync("user-1", "__default__"));
        Assert.Equal("item-b", await store.GetTodayLineAnchorAsync("user-2", "__default__"));
    }

    [Fact]
    public async Task TodayLine_ANullAnchorClearsTheStoredValue()
    {
        var store = await NewStoreAsync();
        await store.SetTodayLineAsync("user-1", "ws-1", "item-a");

        await store.SetTodayLineAsync("user-1", "ws-1", null);

        Assert.Null(await store.GetTodayLineAnchorAsync("user-1", "ws-1"));
    }

    // The line rides the same single-PK table as the item rows, so the marker must never leak
    // into the item list (it has no Description and would blow up the row→TodoItem map).
    [Fact]
    public async Task TodayLine_MarkerRowIsNotReturnedAsAnItem()
    {
        var store = await NewStoreAsync();
        await store.PutAsync(Todo("a", "A", T(1)));
        await store.SetTodayLineAsync("user-1", "ws-1", "a");

        var items = (await store.QueryAllAsync()).Items;

        Assert.Equal(["a"], items.Select(i => i.ItemId));
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
