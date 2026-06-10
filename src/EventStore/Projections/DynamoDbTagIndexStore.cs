using Amazon.DynamoDBv2;
using Amazon.DynamoDBv2.Model;

namespace EventStore.Projections;

public sealed class DynamoDbTagIndexStore(IAmazonDynamoDB dynamo, string tableName) : ITagIndexStore
{
    public async Task PutAsync(string tag, string noteId, string userId, string? workspaceId, CancellationToken ct = default)
    {
        var item = new Dictionary<string, AttributeValue>
        {
            ["Tag"] = new() { S = tag },
            ["NoteId"] = new() { S = noteId },
            ["UserId"] = new() { S = userId }
        };
        if (!string.IsNullOrEmpty(workspaceId))
            item["WorkspaceId"] = new() { S = workspaceId };

        await dynamo.PutItemAsync(new PutItemRequest
        {
            TableName = tableName,
            Item = item
        }, ct).ConfigureAwait(false);
    }

    public async Task DeleteAsync(string tag, string noteId, CancellationToken ct = default)
    {
        await dynamo.DeleteItemAsync(new DeleteItemRequest
        {
            TableName = tableName,
            Key = new Dictionary<string, AttributeValue>
            {
                ["Tag"] = new() { S = tag },
                ["NoteId"] = new() { S = noteId }
            }
        }, ct).ConfigureAwait(false);
    }

    public async Task DeleteByNoteAsync(string noteId, CancellationToken ct = default)
    {
        Dictionary<string, AttributeValue>? lastKey = null;
        do
        {
            var scan = await dynamo.ScanAsync(new ScanRequest
            {
                TableName = tableName,
                FilterExpression = "NoteId = :noteId",
                ExpressionAttributeValues = new Dictionary<string, AttributeValue>
                {
                    [":noteId"] = new() { S = noteId }
                },
                ProjectionExpression = "Tag, NoteId",
                ExclusiveStartKey = lastKey
            }, ct).ConfigureAwait(false);

            await BatchDeleteByCompositeKeyAsync(scan.Items, ct).ConfigureAwait(false);

            lastKey = scan.LastEvaluatedKey?.Count > 0 ? scan.LastEvaluatedKey : null;
        }
        while (lastKey is not null);
    }

    public async Task<IReadOnlyList<TagIndexView>> GetAllAsync(CancellationToken ct = default)
    {
        var items = new List<TagIndexView>();
        Dictionary<string, AttributeValue>? lastKey = null;
        do
        {
            var response = await dynamo.ScanAsync(new ScanRequest
            {
                TableName = tableName,
                ExclusiveStartKey = lastKey,
                ConsistentRead = true
            }, ct).ConfigureAwait(false);
            foreach (var row in response.Items)
                items.Add(new TagIndexView(row["Tag"].S, row["NoteId"].S,
                    row.TryGetValue("UserId", out var uidAttr) ? uidAttr.S : "",
                    row.TryGetValue("WorkspaceId", out var wsAttr) ? wsAttr.S : null));
            lastKey = response.LastEvaluatedKey?.Count > 0 ? response.LastEvaluatedKey : null;
        }
        while (lastKey is not null);
        return items.AsReadOnly();
    }

    public async Task DeleteAllAsync(CancellationToken ct = default)
    {
        Dictionary<string, AttributeValue>? lastKey = null;
        do
        {
            var scan = await dynamo.ScanAsync(new ScanRequest
            {
                TableName = tableName,
                ProjectionExpression = "Tag, NoteId",
                ExclusiveStartKey = lastKey
            }, ct).ConfigureAwait(false);

            await BatchDeleteByCompositeKeyAsync(scan.Items, ct).ConfigureAwait(false);

            lastKey = scan.LastEvaluatedKey?.Count > 0 ? scan.LastEvaluatedKey : null;
        }
        while (lastKey is not null);
    }

    private async Task BatchDeleteByCompositeKeyAsync(List<Dictionary<string, AttributeValue>> items, CancellationToken ct)
    {
        for (var i = 0; i < items.Count; i += 25)
        {
            var batch = items.Skip(i).Take(25)
                .Select(row => new WriteRequest
                {
                    DeleteRequest = new DeleteRequest
                    {
                        Key = new Dictionary<string, AttributeValue>
                        {
                            ["Tag"] = row["Tag"],
                            ["NoteId"] = row["NoteId"]
                        }
                    }
                }).ToList();

            await dynamo.BatchWriteItemAsync(new BatchWriteItemRequest
            {
                RequestItems = new Dictionary<string, List<WriteRequest>> { [tableName] = batch }
            }, ct).ConfigureAwait(false);
        }
    }
}
