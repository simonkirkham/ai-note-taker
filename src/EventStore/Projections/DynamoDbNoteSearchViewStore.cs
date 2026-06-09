using Amazon.DynamoDBv2;
using Amazon.DynamoDBv2.Model;
using Domain.Notes;

namespace EventStore.Projections;

public sealed class DynamoDbNoteSearchViewStore(IAmazonDynamoDB dynamo, string tableName) : INoteSearchViewStore
{
    public async Task UpsertAsync(NoteSearchView view, CancellationToken ct = default)
    {
        if (string.IsNullOrEmpty(view.UserId)) return;

        var item = new Dictionary<string, AttributeValue>
        {
            ["PK"] = new() { S = view.NoteId.Value.ToString() },
            ["UserId"] = new() { S = view.UserId },
            ["Title"] = new() { S = view.Title },
            ["Body"] = new() { S = view.Body },
            ["FinalNotesText"] = new() { S = view.FinalNotesText },
            ["ActionItemsText"] = new() { S = view.ActionItemsText },
            ["Deleted"] = new() { BOOL = view.Deleted },
            ["LastModifiedAt"] = new() { S = view.LastModifiedAt.ToString("O") }
        };
        if (view.Tags is { Count: > 0 })
            item["Tags"] = new() { SS = view.Tags.ToList() };

        await dynamo.PutItemAsync(new PutItemRequest { TableName = tableName, Item = item }, ct)
            .ConfigureAwait(false);
    }

    public async Task<NoteSearchView?> GetByNoteIdAsync(NoteId noteId, CancellationToken ct = default)
    {
        var response = await dynamo.GetItemAsync(new GetItemRequest
        {
            TableName = tableName,
            Key = new Dictionary<string, AttributeValue> { ["PK"] = new() { S = noteId.Value.ToString() } },
            ConsistentRead = true
        }, ct).ConfigureAwait(false);
        return response.Item is { Count: > 0 } ? MapItem(response.Item) : null;
    }

    public async Task DeleteAsync(NoteId noteId, CancellationToken ct = default) =>
        await dynamo.DeleteItemAsync(new DeleteItemRequest
        {
            TableName = tableName,
            Key = new Dictionary<string, AttributeValue> { ["PK"] = new() { S = noteId.Value.ToString() } }
        }, ct).ConfigureAwait(false);

    public async Task DeleteAllAsync(CancellationToken ct = default)
    {
        Dictionary<string, AttributeValue>? lastKey = null;
        do
        {
            var scan = await dynamo.ScanAsync(new ScanRequest
            {
                TableName = tableName,
                ProjectionExpression = "PK",
                ExclusiveStartKey = lastKey
            }, ct).ConfigureAwait(false);

            foreach (var item in scan.Items)
                await dynamo.DeleteItemAsync(new DeleteItemRequest
                {
                    TableName = tableName,
                    Key = new Dictionary<string, AttributeValue> { ["PK"] = item["PK"] }
                }, ct).ConfigureAwait(false);

            lastKey = scan.LastEvaluatedKey?.Count > 0 ? scan.LastEvaluatedKey : null;
        }
        while (lastKey is not null);
    }

    public async Task<IReadOnlyList<NoteSearchView>> QueryAllAsync(CancellationToken ct = default)
    {
        var results = new List<NoteSearchView>();
        Dictionary<string, AttributeValue>? lastKey = null;
        do
        {
            var scan = await dynamo.ScanAsync(
                new ScanRequest { TableName = tableName, ConsistentRead = true, ExclusiveStartKey = lastKey }, ct)
                .ConfigureAwait(false);
            results.AddRange(scan.Items.Select(MapItem));
            lastKey = scan.LastEvaluatedKey?.Count > 0 ? scan.LastEvaluatedKey : null;
        }
        while (lastKey is not null);
        return results.AsReadOnly();
    }

    public async Task<IReadOnlyList<NoteSearchView>> QueryByUserIdAsync(string userId, CancellationToken ct = default)
    {
        var results = new List<NoteSearchView>();
        Dictionary<string, AttributeValue>? lastKey = null;
        do
        {
            var response = await dynamo.QueryAsync(new QueryRequest
            {
                TableName = tableName,
                IndexName = "UserId-index",
                KeyConditionExpression = "UserId = :userId",
                ExpressionAttributeValues = new Dictionary<string, AttributeValue>
                {
                    [":userId"] = new() { S = userId }
                },
                ExclusiveStartKey = lastKey
            }, ct).ConfigureAwait(false);

            results.AddRange(response.Items.Select(MapItem));
            lastKey = response.LastEvaluatedKey?.Count > 0 ? response.LastEvaluatedKey : null;
        }
        while (lastKey is not null);

        return results.AsReadOnly();
    }

    private static NoteSearchView MapItem(Dictionary<string, AttributeValue> item)
    {
        IReadOnlyList<string> tags = item.TryGetValue("Tags", out var tagsAttr) && tagsAttr.SS?.Count > 0
            ? tagsAttr.SS.AsReadOnly()
            : Array.Empty<string>();

        return new NoteSearchView(
            NoteId: new NoteId(Guid.Parse(item["PK"].S)),
            UserId: item.TryGetValue("UserId", out var uid) ? uid.S : string.Empty,
            Title: item.TryGetValue("Title", out var title) ? title.S : string.Empty,
            Body: item.TryGetValue("Body", out var body) ? body.S : string.Empty,
            FinalNotesText: item.TryGetValue("FinalNotesText", out var fn) ? fn.S : string.Empty,
            Tags: tags,
            ActionItemsText: item.TryGetValue("ActionItemsText", out var ai) ? ai.S : string.Empty,
            Deleted: item.TryGetValue("Deleted", out var del) && (del.BOOL ?? false),
            LastModifiedAt: item.TryGetValue("LastModifiedAt", out var lm) ? DateTimeOffset.Parse(lm.S) : default);
    }
}
