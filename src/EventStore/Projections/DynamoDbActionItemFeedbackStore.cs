using Amazon.DynamoDBv2;
using Amazon.DynamoDBv2.Model;

namespace EventStore.Projections;

public sealed class DynamoDbActionItemFeedbackStore(IAmazonDynamoDB dynamo, string tableName) : IActionItemFeedbackStore
{
    private static string UserPk(string userId) => $"USER#{userId}";
    private static string ActionPk(string actionItemId) => $"ACTION#{actionItemId}";

    public async Task RecordSuggestionAsync(string userId, string actionItemId, string promptVersion, CancellationToken ct = default)
    {
        await IncrementAsync(userId, "SuggestedCount", ct).ConfigureAwait(false);
        await PutProvenanceAsync(actionItemId, userId, promptVersion, ct).ConfigureAwait(false);
    }

    public Task<bool> TryRecordDeletionAsync(string actionItemId, CancellationToken ct = default) =>
        TryIncrementForProvenanceAsync(actionItemId, "DeletedCount", ct);

    public Task<bool> TryRecordCompletionAsync(string actionItemId, CancellationToken ct = default) =>
        TryIncrementForProvenanceAsync(actionItemId, "CompletedCount", ct);

    public async Task<IReadOnlyList<ActionItemFeedbackView>> GetAllAsync(CancellationToken ct = default)
    {
        var items = new List<ActionItemFeedbackView>();
        Dictionary<string, AttributeValue>? lastKey = null;
        do
        {
            var response = await dynamo.ScanAsync(new ScanRequest
            {
                TableName = tableName,
                FilterExpression = "begins_with(PK, :u)",
                ExpressionAttributeValues = new Dictionary<string, AttributeValue> { [":u"] = new() { S = "USER#" } },
                ExclusiveStartKey = lastKey,
                ConsistentRead = true
            }, ct).ConfigureAwait(false);

            foreach (var row in response.Items)
                items.Add(new ActionItemFeedbackView(
                    row["PK"].S["USER#".Length..],
                    Count(row, "SuggestedCount"),
                    Count(row, "DeletedCount"),
                    Count(row, "CompletedCount")));

            lastKey = response.LastEvaluatedKey?.Count > 0 ? response.LastEvaluatedKey : null;
        }
        while (lastKey is not null);
        return items.AsReadOnly();
    }

    public async Task UpsertAggregateAsync(ActionItemFeedbackView view, CancellationToken ct = default)
    {
        await dynamo.PutItemAsync(new PutItemRequest
        {
            TableName = tableName,
            Item = new Dictionary<string, AttributeValue>
            {
                ["PK"] = new() { S = UserPk(view.UserId) },
                ["SuggestedCount"] = new() { N = view.SuggestedCount.ToString() },
                ["DeletedCount"] = new() { N = view.DeletedCount.ToString() },
                ["CompletedCount"] = new() { N = view.CompletedCount.ToString() }
            }
        }, ct).ConfigureAwait(false);
    }

    public async Task PutProvenanceAsync(string actionItemId, string userId, string promptVersion, CancellationToken ct = default)
    {
        await dynamo.PutItemAsync(new PutItemRequest
        {
            TableName = tableName,
            Item = new Dictionary<string, AttributeValue>
            {
                ["PK"] = new() { S = ActionPk(actionItemId) },
                ["UserId"] = new() { S = userId },
                ["PromptVersion"] = new() { S = promptVersion }
            }
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

            for (var i = 0; i < scan.Items.Count; i += 25)
            {
                var batch = scan.Items.Skip(i).Take(25)
                    .Select(row => new WriteRequest
                    {
                        DeleteRequest = new DeleteRequest
                        {
                            Key = new Dictionary<string, AttributeValue> { ["PK"] = row["PK"] }
                        }
                    }).ToList();

                await dynamo.BatchWriteItemAsync(new BatchWriteItemRequest
                {
                    RequestItems = new Dictionary<string, List<WriteRequest>> { [tableName] = batch }
                }, ct).ConfigureAwait(false);
            }

            lastKey = scan.LastEvaluatedKey?.Count > 0 ? scan.LastEvaluatedKey : null;
        }
        while (lastKey is not null);
    }

    private async Task<bool> TryIncrementForProvenanceAsync(string actionItemId, string counter, CancellationToken ct)
    {
        var prov = await dynamo.GetItemAsync(new GetItemRequest
        {
            TableName = tableName,
            Key = new Dictionary<string, AttributeValue> { ["PK"] = new() { S = ActionPk(actionItemId) } },
            ConsistentRead = true
        }, ct).ConfigureAwait(false);

        if (prov.Item is null || prov.Item.Count == 0 || !prov.Item.TryGetValue("UserId", out var userIdAttr))
            return false;

        await IncrementAsync(userIdAttr.S, counter, ct).ConfigureAwait(false);
        return true;
    }

    private async Task IncrementAsync(string userId, string counter, CancellationToken ct)
    {
        await dynamo.UpdateItemAsync(new UpdateItemRequest
        {
            TableName = tableName,
            Key = new Dictionary<string, AttributeValue> { ["PK"] = new() { S = UserPk(userId) } },
            UpdateExpression = $"ADD {counter} :one",
            ExpressionAttributeValues = new Dictionary<string, AttributeValue> { [":one"] = new() { N = "1" } }
        }, ct).ConfigureAwait(false);
    }

    private static int Count(Dictionary<string, AttributeValue> row, string attr) =>
        row.TryGetValue(attr, out var v) && int.TryParse(v.N, out var n) ? n : 0;
}
