using Amazon.DynamoDBv2;
using Amazon.DynamoDBv2.Model;
using Domain.Workspaces;
using EventStore.Projections;

namespace EventStore.Integration;

// 36-A: the Theme field on WorkspaceListView is mapped explicitly in DynamoDbWorkspaceListStore
// (UpsertAsync writes it, ToView reads it). The in-memory Api.Integration double keeps the view by
// reference, so a missing mapping would round-trip for free there — only DynamoDB Local proves the
// field survives the attribute boundary.
public sealed class WorkspaceListThemeRoundTripTests(DynamoDbFixture fixture) : IClassFixture<DynamoDbFixture>
{
    private readonly IAmazonDynamoDB _dynamo = fixture.DynamoDb;

    [Fact]
    public async Task Theme_SurvivesUpsertAndReadBack()
    {
        var store = await NewStoreAsync();
        var workspace = new WorkspaceListView(new WorkspaceId("ws-aaaa"), "Work", DateTimeOffset.UtcNow, "user-1", Theme: "midnight");

        await store.UpsertAsync(workspace);

        var all = await store.GetAllAsync();
        var read = Assert.Single(all);
        Assert.Equal("midnight", read.Theme);
    }

    private async Task<DynamoDbWorkspaceListStore> NewStoreAsync()
    {
        var tableName = $"test-workspaces-{Guid.NewGuid():N}";
        await _dynamo.CreateTableAsync(new CreateTableRequest
        {
            TableName = tableName,
            AttributeDefinitions = [new AttributeDefinition { AttributeName = "PK", AttributeType = ScalarAttributeType.S }],
            KeySchema = [new KeySchemaElement { AttributeName = "PK", KeyType = KeyType.HASH }],
            BillingMode = BillingMode.PAY_PER_REQUEST
        });
        return new DynamoDbWorkspaceListStore(_dynamo, tableName);
    }
}
