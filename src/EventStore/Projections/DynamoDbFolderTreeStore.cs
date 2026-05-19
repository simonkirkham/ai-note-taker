using Amazon.DynamoDBv2;
using Amazon.DynamoDBv2.Model;
using Domain.Folders;

namespace EventStore.Projections;

public sealed class DynamoDbFolderTreeStore(IAmazonDynamoDB dynamo, string tableName) : IFolderTreeStore
{
    public async Task UpsertAsync(FolderTreeView folder, CancellationToken ct = default)
    {
        var attrs = new Dictionary<string, AttributeValue>
        {
            ["PK"] = new() { S = folder.FolderId.Value.ToString() },
            ["Name"] = new() { S = folder.Name },
            ["CreatedAt"] = new() { S = folder.CreatedAt.ToString("O") },
            ["UserId"] = new() { S = folder.UserId }
        };
        if (folder.ParentFolderId.HasValue)
            attrs["ParentFolderId"] = new() { S = folder.ParentFolderId.Value.Value.ToString() };

        await dynamo.PutItemAsync(new PutItemRequest { TableName = tableName, Item = attrs }, ct)
            .ConfigureAwait(false);
    }

    public async Task<IReadOnlyList<FolderTreeView>> GetAllAsync(CancellationToken ct = default)
    {
        var items = new List<FolderTreeView>();
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
                items.Add(ToView(row));
            lastKey = response.LastEvaluatedKey?.Count > 0 ? response.LastEvaluatedKey : null;
        }
        while (lastKey is not null);
        return items.OrderBy(f => f.CreatedAt).ToList().AsReadOnly();
    }

    public async Task DeleteAsync(FolderId folderId, CancellationToken ct = default)
    {
        await dynamo.DeleteItemAsync(new DeleteItemRequest
        {
            TableName = tableName,
            Key = new Dictionary<string, AttributeValue> { ["PK"] = new() { S = folderId.Value.ToString() } }
        }, ct).ConfigureAwait(false);
    }

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

            await DynamoDbBatchDelete.ByPrimaryKeyAsync(dynamo, tableName, scan.Items, ct).ConfigureAwait(false);

            lastKey = scan.LastEvaluatedKey?.Count > 0 ? scan.LastEvaluatedKey : null;
        }
        while (lastKey is not null);
    }

    private static FolderTreeView ToView(Dictionary<string, AttributeValue> row)
    {
        FolderId? parentFolderId = row.TryGetValue("ParentFolderId", out var parentAttr)
            ? new FolderId(Guid.Parse(parentAttr.S))
            : null;

        return new FolderTreeView(
            FolderId: new FolderId(Guid.Parse(row["PK"].S)),
            Name: row["Name"].S,
            ParentFolderId: parentFolderId,
            CreatedAt: DateTimeOffset.Parse(row["CreatedAt"].S),
            UserId: row.TryGetValue("UserId", out var uidAttr) ? uidAttr.S : "");
    }
}
