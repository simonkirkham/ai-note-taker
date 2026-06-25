using Amazon.DynamoDBv2;
using Amazon.DynamoDBv2.Model;
using Domain.Notes;

namespace EventStore.Projections;

public sealed class DynamoDbTodoListStore(IAmazonDynamoDB dynamo, string tableName) : ITodoListStore
{
    private const string NoteIdIndex = "NoteId-index";

    public async Task PutAsync(TodoItem item, CancellationToken ct = default)
    {
        var attrs = new Dictionary<string, AttributeValue>
        {
            ["PK"] = new() { S = item.ItemId },
            ["Type"] = new() { S = item.Type },
            ["Description"] = new() { S = item.Description },
            ["AddedAt"] = new() { S = item.AddedAt.ToString("O") },
            ["UserId"] = new() { S = item.UserId }
        };

        if (item.NoteId is not null)
            attrs["NoteId"] = new() { S = item.NoteId };
        if (item.NoteTitle is not null)
            attrs["NoteTitle"] = new() { S = item.NoteTitle };
        if (item.CompletedAt is not null)
            attrs["CompletedAt"] = new() { S = item.CompletedAt.Value.ToString("O") };
        if (!string.IsNullOrEmpty(item.WorkspaceId))
            attrs["WorkspaceId"] = new() { S = item.WorkspaceId };
        if (item.Position is not null)
            attrs["Position"] = new() { N = item.Position.Value.ToString() };

        await dynamo.PutItemAsync(new PutItemRequest
        {
            TableName = tableName,
            Item = attrs
        }, ct).ConfigureAwait(false);
    }

    public async Task UpdateCompletedAtAsync(string itemId, DateTimeOffset? completedAt, CancellationToken ct = default)
    {
        if (completedAt is not null)
        {
            await dynamo.UpdateItemAsync(new UpdateItemRequest
            {
                TableName = tableName,
                Key = new Dictionary<string, AttributeValue> { ["PK"] = new() { S = itemId } },
                UpdateExpression = "SET CompletedAt = :at",
                ExpressionAttributeValues = new Dictionary<string, AttributeValue>
                {
                    [":at"] = new() { S = completedAt.Value.ToString("O") }
                }
            }, ct).ConfigureAwait(false);
        }
        else
        {
            await dynamo.UpdateItemAsync(new UpdateItemRequest
            {
                TableName = tableName,
                Key = new Dictionary<string, AttributeValue> { ["PK"] = new() { S = itemId } },
                UpdateExpression = "REMOVE CompletedAt"
            }, ct).ConfigureAwait(false);
        }
    }

    public async Task DeleteAsync(string itemId, CancellationToken ct = default)
    {
        await dynamo.DeleteItemAsync(new DeleteItemRequest
        {
            TableName = tableName,
            Key = new Dictionary<string, AttributeValue>
            {
                ["PK"] = new() { S = itemId }
            }
        }, ct).ConfigureAwait(false);
    }

    public async Task DeleteByNoteAsync(NoteId noteId, CancellationToken ct = default)
    {
        var itemIds = await QueryItemIdsByNoteAsync(noteId, ct).ConfigureAwait(false);
        for (var i = 0; i < itemIds.Count; i += 25)
        {
            var batch = itemIds.Skip(i).Take(25)
                .Select(id => new WriteRequest
                {
                    DeleteRequest = new DeleteRequest
                    {
                        Key = new Dictionary<string, AttributeValue> { ["PK"] = new() { S = id } }
                    }
                }).ToList();
            await dynamo.BatchWriteItemAsync(new BatchWriteItemRequest
            {
                RequestItems = new Dictionary<string, List<WriteRequest>> { [tableName] = batch }
            }, ct).ConfigureAwait(false);
        }
    }

    public async Task UpdateNoteTitleAsync(NoteId noteId, string newTitle, CancellationToken ct = default)
    {
        var itemIds = await QueryItemIdsByNoteAsync(noteId, ct).ConfigureAwait(false);
        await Task.WhenAll(itemIds.Select(id => dynamo.UpdateItemAsync(new UpdateItemRequest
        {
            TableName = tableName,
            Key = new Dictionary<string, AttributeValue> { ["PK"] = new() { S = id } },
            UpdateExpression = "SET NoteTitle = :title",
            ExpressionAttributeValues = new Dictionary<string, AttributeValue>
            {
                [":title"] = new() { S = newTitle }
            }
        }, ct))).ConfigureAwait(false);
    }

    public async Task UpdateNoteWorkspaceAsync(NoteId noteId, string workspaceId, CancellationToken ct = default)
    {
        var itemIds = await QueryItemIdsByNoteAsync(noteId, ct).ConfigureAwait(false);
        await Task.WhenAll(itemIds.Select(id => dynamo.UpdateItemAsync(new UpdateItemRequest
        {
            TableName = tableName,
            Key = new Dictionary<string, AttributeValue> { ["PK"] = new() { S = id } },
            UpdateExpression = "SET WorkspaceId = :ws",
            ExpressionAttributeValues = new Dictionary<string, AttributeValue>
            {
                [":ws"] = new() { S = workspaceId }
            }
        }, ct))).ConfigureAwait(false);
    }

    public async Task<TodoItem?> GetByIdAsync(string itemId, CancellationToken ct = default)
    {
        var resp = await dynamo.GetItemAsync(new GetItemRequest
        {
            TableName = tableName,
            Key = new Dictionary<string, AttributeValue> { ["PK"] = new() { S = itemId } },
            ConsistentRead = true
        }, ct).ConfigureAwait(false);
        return resp.Item?.Count > 0 ? ToTodoItem(resp.Item) : null;
    }

    public async Task<TodoListView> QueryAllAsync(CancellationToken ct = default)
    {
        var items = new List<TodoItem>();
        Dictionary<string, AttributeValue>? lastKey = null;
        do
        {
            var scan = await dynamo.ScanAsync(new ScanRequest
            {
                TableName = tableName,
                ExclusiveStartKey = lastKey,
                ConsistentRead = true
            }, ct).ConfigureAwait(false);

            items.AddRange(scan.Items.Select(ToTodoItem));
            lastKey = scan.LastEvaluatedKey?.Count > 0 ? scan.LastEvaluatedKey : null;
        }
        while (lastKey is not null);

        return new TodoListView(items
            .OrderBy(i => i.Position ?? int.MaxValue)
            .ThenBy(i => i.AddedAt)
            .ToList()
            .AsReadOnly());
    }

    public Task UpdatePositionsAsync(IReadOnlyList<string> orderedItemIds, CancellationToken ct = default) =>
        // Each item is an independent key — update them together rather than sequentially.
        Task.WhenAll(orderedItemIds.Select((itemId, index) => SetPositionAsync(itemId, index, ct)));

    private async Task SetPositionAsync(string itemId, int position, CancellationToken ct)
    {
        try
        {
            await dynamo.UpdateItemAsync(new UpdateItemRequest
            {
                TableName = tableName,
                Key = new Dictionary<string, AttributeValue> { ["PK"] = new() { S = itemId } },
                UpdateExpression = "SET #pos = :pos",
                // Guard against upserting a phantom row for an id completed/deleted since the read.
                ConditionExpression = "attribute_exists(PK)",
                ExpressionAttributeNames = new Dictionary<string, string> { ["#pos"] = "Position" },
                ExpressionAttributeValues = new Dictionary<string, AttributeValue> { [":pos"] = new() { N = position.ToString() } }
            }, ct).ConfigureAwait(false);
        }
        catch (ConditionalCheckFailedException)
        {
            // Stale snapshot id (no longer exists) — ignore; surviving items still get positioned.
        }
    }

    private static TodoItem ToTodoItem(Dictionary<string, AttributeValue> row) =>
        new(
            ItemId: row["PK"].S,
            NoteId: row.TryGetValue("NoteId", out var nid) ? nid.S : null,
            NoteTitle: row.TryGetValue("NoteTitle", out var nt) ? nt.S : null,
            Type: row.TryGetValue("Type", out var t) ? t.S : "action",
            Description: row["Description"].S,
            AddedAt: DateTimeOffset.Parse(row["AddedAt"].S),
            CompletedAt: row.TryGetValue("CompletedAt", out var ca) ? DateTimeOffset.Parse(ca.S) : null,
            UserId: row.TryGetValue("UserId", out var uid) ? uid.S : "",
            WorkspaceId: row.TryGetValue("WorkspaceId", out var ws) ? ws.S : null,
            Position: row.TryGetValue("Position", out var pos) ? int.Parse(pos.N) : null);

    private async Task<List<string>> QueryItemIdsByNoteAsync(NoteId noteId, CancellationToken ct)
    {
        var itemIds = new List<string>();
        Dictionary<string, AttributeValue>? lastKey = null;
        do
        {
            var resp = await dynamo.QueryAsync(new QueryRequest
            {
                TableName = tableName,
                IndexName = NoteIdIndex,
                KeyConditionExpression = "NoteId = :noteId",
                ProjectionExpression = "PK",
                ExpressionAttributeValues = new Dictionary<string, AttributeValue>
                {
                    [":noteId"] = new() { S = noteId.Value.ToString() }
                },
                ExclusiveStartKey = lastKey
            }, ct).ConfigureAwait(false);
            itemIds.AddRange(resp.Items.Select(row => row["PK"].S));
            lastKey = resp.LastEvaluatedKey?.Count > 0 ? resp.LastEvaluatedKey : null;
        }
        while (lastKey is not null);
        return itemIds;
    }
}
