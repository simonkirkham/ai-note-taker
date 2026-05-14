using Amazon.DynamoDBv2;
using Amazon.DynamoDBv2.Model;
using Domain.Folders;

namespace EventStore.Projections;

public sealed class DynamoDbFolderTreeStore(IAmazonDynamoDB dynamo, string tableName) : IFolderTreeStore
{
    private readonly IAmazonDynamoDB _dynamo = dynamo;
    private readonly string _tableName = tableName;

    public async Task UpsertAsync(FolderTreeView folder, CancellationToken ct = default)
    {
        var attrs = new Dictionary<string, AttributeValue>
        {
            ["PK"]           = new() { S = folder.FolderId.Value.ToString() },
            ["Name"]         = new() { S = folder.Name },
            ["CreatedAt"]    = new() { S = folder.CreatedAt.ToString("O") }
        };
        if (folder.ParentFolderId.HasValue)
            attrs["ParentFolderId"] = new() { S = folder.ParentFolderId.Value.Value.ToString() };

        await _dynamo.PutItemAsync(new PutItemRequest
        {
            TableName = _tableName,
            Item = attrs
        }, ct).ConfigureAwait(false);
    }

    public async Task<IReadOnlyList<FolderTreeView>> GetAllAsync(CancellationToken ct = default)
    {
        var response = await _dynamo.ScanAsync(new ScanRequest { TableName = _tableName }, ct)
            .ConfigureAwait(false);
        return response.Items.Select(ToView).OrderBy(f => f.CreatedAt).ToList().AsReadOnly();
    }

    public async Task DeleteAllAsync(CancellationToken ct = default)
    {
        var response = await _dynamo.ScanAsync(new ScanRequest { TableName = _tableName }, ct)
            .ConfigureAwait(false);
        foreach (var item in response.Items)
        {
            await _dynamo.DeleteItemAsync(new DeleteItemRequest
            {
                TableName = _tableName,
                Key = new Dictionary<string, AttributeValue>
                {
                    ["PK"] = item["PK"]
                }
            }, ct).ConfigureAwait(false);
        }
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
            CreatedAt: DateTimeOffset.Parse(row["CreatedAt"].S));
    }
}
