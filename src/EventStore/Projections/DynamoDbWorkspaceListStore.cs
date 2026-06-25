using Amazon.DynamoDBv2;
using Amazon.DynamoDBv2.Model;
using Domain.Workspaces;

namespace EventStore.Projections;

public sealed class DynamoDbWorkspaceListStore(IAmazonDynamoDB dynamo, string tableName) : IWorkspaceListStore
{
    public async Task UpsertAsync(WorkspaceListView workspace, CancellationToken ct = default)
    {
        var attrs = new Dictionary<string, AttributeValue>
        {
            ["PK"] = new() { S = workspace.WorkspaceId.Value },
            ["Name"] = new() { S = workspace.Name },
            ["CreatedAt"] = new() { S = workspace.CreatedAt.ToString("O") },
            ["UserId"] = new() { S = workspace.UserId }
        };
        if (!string.IsNullOrEmpty(workspace.Theme))
            attrs["Theme"] = new() { S = workspace.Theme };

        await dynamo.PutItemAsync(new PutItemRequest { TableName = tableName, Item = attrs }, ct)
            .ConfigureAwait(false);
    }

    public async Task<IReadOnlyList<WorkspaceListView>> GetAllAsync(CancellationToken ct = default)
    {
        var items = new List<WorkspaceListView>();
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
        return items.OrderBy(w => w.CreatedAt).ToList().AsReadOnly();
    }

    public async Task DeleteAsync(WorkspaceId workspaceId, CancellationToken ct = default)
    {
        await dynamo.DeleteItemAsync(new DeleteItemRequest
        {
            TableName = tableName,
            Key = new Dictionary<string, AttributeValue> { ["PK"] = new() { S = workspaceId.Value } }
        }, ct).ConfigureAwait(false);
    }

    private static WorkspaceListView ToView(Dictionary<string, AttributeValue> row) =>
        new(
            WorkspaceId: new WorkspaceId(row["PK"].S),
            Name: row["Name"].S,
            CreatedAt: DateTimeOffset.Parse(row["CreatedAt"].S),
            UserId: row.TryGetValue("UserId", out var uidAttr) ? uidAttr.S : "",
            Theme: row.TryGetValue("Theme", out var themeAttr) ? themeAttr.S : null);
}
