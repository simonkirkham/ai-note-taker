using Amazon.DynamoDBv2;
using Amazon.DynamoDBv2.Model;
using EventStore.Projections;

namespace EventStore.Integration;

// 39-A/39-B: editing an action item / to-do folds the new text into the TodoList view via a
// field-level UpdateDescriptionAsync (SET Description). The in-memory Api.Integration double keeps
// the whole record by reference, so a missing DynamoDB mapping would round-trip for free there;
// only DynamoDB Local proves the real UpdateExpression is well-formed and the attribute survives.
public sealed class DynamoDbTodoListStoreTests(DynamoDbFixture fixture) : IClassFixture<DynamoDbFixture>
{
    private readonly IAmazonDynamoDB _dynamo = fixture.DynamoDb;

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

    private async Task<DynamoDbTodoListStore> NewStoreAsync()
    {
        var tableName = $"test-todos-{Guid.NewGuid():N}";
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
