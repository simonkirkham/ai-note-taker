using Amazon.DynamoDBv2;
using Amazon.DynamoDBv2.Model;

namespace EventStore.Projections;

public sealed class DynamoDbTagFeedbackStore(IAmazonDynamoDB dynamo, string tableName) : ITagFeedbackStore
{
    private static string UserPk(string userId) => $"USER#{userId}";
    private static string NotePk(string noteId) => $"NOTE#{noteId}";
    private static string TagSk(string tag) => $"TAG#{tag}";

    public async Task RecordSuggestionAsync(string userId, string noteId, string tag, CancellationToken ct = default)
    {
        await IncrementAsync(userId, tag, "SuggestedCount", ct).ConfigureAwait(false);
        await PutProvenanceAsync(noteId, tag, userId, ct).ConfigureAwait(false);
    }

    public async Task<bool> TryRecordRejectionAsync(string noteId, string tag, CancellationToken ct = default)
    {
        var prov = await dynamo.GetItemAsync(new GetItemRequest
        {
            TableName = tableName,
            Key = Key(NotePk(noteId), TagSk(tag)),
            ConsistentRead = true
        }, ct).ConfigureAwait(false);

        if (prov.Item is null || prov.Item.Count == 0 || !prov.Item.TryGetValue("UserId", out var userIdAttr))
            return false;

        await IncrementAsync(userIdAttr.S, tag, "RejectedCount", ct).ConfigureAwait(false);
        await dynamo.DeleteItemAsync(new DeleteItemRequest
        {
            TableName = tableName,
            Key = Key(NotePk(noteId), TagSk(tag))
        }, ct).ConfigureAwait(false);
        return true;
    }

    public async Task DeleteProvenanceByNoteAsync(string noteId, CancellationToken ct = default)
    {
        var query = await dynamo.QueryAsync(new QueryRequest
        {
            TableName = tableName,
            KeyConditionExpression = "PK = :pk",
            ExpressionAttributeValues = new Dictionary<string, AttributeValue> { [":pk"] = new() { S = NotePk(noteId) } },
            ProjectionExpression = "PK, SK"
        }, ct).ConfigureAwait(false);

        await BatchDeleteAsync(query.Items, ct).ConfigureAwait(false);
    }

    public async Task<IReadOnlyList<TagFeedbackView>> GetAllAsync(CancellationToken ct = default)
    {
        var items = new List<TagFeedbackView>();
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
                items.Add(new TagFeedbackView(
                    row["PK"].S["USER#".Length..],
                    row["SK"].S["TAG#".Length..],
                    Count(row, "SuggestedCount"),
                    Count(row, "RejectedCount")));

            lastKey = response.LastEvaluatedKey?.Count > 0 ? response.LastEvaluatedKey : null;
        }
        while (lastKey is not null);
        return items.AsReadOnly();
    }

    public async Task UpsertAggregateAsync(TagFeedbackView view, CancellationToken ct = default)
    {
        await dynamo.PutItemAsync(new PutItemRequest
        {
            TableName = tableName,
            Item = new Dictionary<string, AttributeValue>
            {
                ["PK"] = new() { S = UserPk(view.UserId) },
                ["SK"] = new() { S = TagSk(view.Tag) },
                ["SuggestedCount"] = new() { N = view.SuggestedCount.ToString() },
                ["RejectedCount"] = new() { N = view.RejectedCount.ToString() }
            }
        }, ct).ConfigureAwait(false);
    }

    public async Task PutProvenanceAsync(string noteId, string tag, string userId, CancellationToken ct = default)
    {
        await dynamo.PutItemAsync(new PutItemRequest
        {
            TableName = tableName,
            Item = new Dictionary<string, AttributeValue>
            {
                ["PK"] = new() { S = NotePk(noteId) },
                ["SK"] = new() { S = TagSk(tag) },
                ["UserId"] = new() { S = userId }
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
                ProjectionExpression = "PK, SK",
                ExclusiveStartKey = lastKey
            }, ct).ConfigureAwait(false);

            await BatchDeleteAsync(scan.Items, ct).ConfigureAwait(false);

            lastKey = scan.LastEvaluatedKey?.Count > 0 ? scan.LastEvaluatedKey : null;
        }
        while (lastKey is not null);
    }

    private async Task IncrementAsync(string userId, string tag, string counter, CancellationToken ct)
    {
        await dynamo.UpdateItemAsync(new UpdateItemRequest
        {
            TableName = tableName,
            Key = Key(UserPk(userId), TagSk(tag)),
            UpdateExpression = $"ADD {counter} :one",
            ExpressionAttributeValues = new Dictionary<string, AttributeValue> { [":one"] = new() { N = "1" } }
        }, ct).ConfigureAwait(false);
    }

    private async Task BatchDeleteAsync(List<Dictionary<string, AttributeValue>> items, CancellationToken ct)
    {
        for (var i = 0; i < items.Count; i += 25)
        {
            var batch = items.Skip(i).Take(25)
                .Select(row => new WriteRequest
                {
                    DeleteRequest = new DeleteRequest { Key = Key(row["PK"].S, row["SK"].S) }
                }).ToList();

            await dynamo.BatchWriteItemAsync(new BatchWriteItemRequest
            {
                RequestItems = new Dictionary<string, List<WriteRequest>> { [tableName] = batch }
            }, ct).ConfigureAwait(false);
        }
    }

    private static Dictionary<string, AttributeValue> Key(string pk, string sk) => new()
    {
        ["PK"] = new() { S = pk },
        ["SK"] = new() { S = sk }
    };

    private static int Count(Dictionary<string, AttributeValue> row, string attr) =>
        row.TryGetValue(attr, out var v) && int.TryParse(v.N, out var n) ? n : 0;
}
