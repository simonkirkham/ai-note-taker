using Amazon.DynamoDBv2;
using Amazon.DynamoDBv2.Model;
using Domain.Notes;
using EventStore.Projections;

namespace EventStore.Integration;

// 23-B: WorkspaceId is an additive attribute on NoteSearchView. Its UserId-index GSI is
// ProjectionType.ALL, so the attribute must round-trip through a real GSI query (the workspace
// filter runs in-Lambda on the GSI result). This proves it against DynamoDB Local — the
// in-memory Api.Integration tests cannot exercise the real index.
public sealed class NoteSearchViewWorkspaceTests(DynamoDbFixture fixture) : IClassFixture<DynamoDbFixture>
{
    private readonly IAmazonDynamoDB _dynamo = fixture.DynamoDb;

    [Fact]
    public async Task WorkspaceId_RoundTripsThroughUserIdGsi()
    {
        var tableName = $"test-searchview-{Guid.NewGuid():N}";
        await CreateSearchTableAsync(tableName);
        var store = new DynamoDbNoteSearchViewStore(_dynamo, tableName);

        var noteId = new NoteId(Guid.NewGuid());
        await store.UpsertAsync(new NoteSearchView(noteId, "user-1", "Planning", "body",
            string.Empty, ["tag"], string.Empty, false, DateTimeOffset.UtcNow, WorkspaceId: "ws-work"));

        var byUser = await store.QueryByUserIdAsync("user-1");
        var doc = Assert.Single(byUser);
        Assert.Equal("ws-work", doc.WorkspaceId);

        var byNote = await store.GetByNoteIdAsync(noteId);
        Assert.NotNull(byNote);
        Assert.Equal("ws-work", byNote!.WorkspaceId);
    }

    [Fact]
    public async Task MissingWorkspaceId_ReadsBackAsNull()
    {
        var tableName = $"test-searchview-{Guid.NewGuid():N}";
        await CreateSearchTableAsync(tableName);
        var store = new DynamoDbNoteSearchViewStore(_dynamo, tableName);

        var noteId = new NoteId(Guid.NewGuid());
        await store.UpsertAsync(new NoteSearchView(noteId, "user-1", "Legacy", "body",
            string.Empty, [], string.Empty, false, DateTimeOffset.UtcNow));

        var doc = Assert.Single(await store.QueryByUserIdAsync("user-1"));
        Assert.Null(doc.WorkspaceId);
    }

    private async Task CreateSearchTableAsync(string tableName)
    {
        await _dynamo.CreateTableAsync(new CreateTableRequest
        {
            TableName = tableName,
            AttributeDefinitions =
            [
                new AttributeDefinition { AttributeName = "PK", AttributeType = ScalarAttributeType.S },
                new AttributeDefinition { AttributeName = "UserId", AttributeType = ScalarAttributeType.S }
            ],
            KeySchema = [new KeySchemaElement { AttributeName = "PK", KeyType = KeyType.HASH }],
            GlobalSecondaryIndexes =
            [
                new GlobalSecondaryIndex
                {
                    IndexName = "UserId-index",
                    KeySchema = [new KeySchemaElement { AttributeName = "UserId", KeyType = KeyType.HASH }],
                    Projection = new Projection { ProjectionType = ProjectionType.ALL }
                }
            ],
            BillingMode = BillingMode.PAY_PER_REQUEST
        });
    }
}
