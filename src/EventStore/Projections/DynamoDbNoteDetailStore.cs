using Amazon.DynamoDBv2;
using Amazon.DynamoDBv2.Model;
using Domain.Notes;

namespace EventStore.Projections;

public sealed class DynamoDbNoteDetailStore(IAmazonDynamoDB dynamo, string tableName) : INoteDetailStore
{
    public async Task UpsertAsync(NoteDetailView detail, CancellationToken ct = default)
    {
        var item = new Dictionary<string, AttributeValue>
        {
            ["PK"]             = new() { S = detail.NoteId.ToStreamId() },
            ["NoteId"]         = new() { S = detail.NoteId.Value.ToString() },
            ["Title"]          = new() { S = detail.Title },
            ["Content"]        = new() { S = detail.Content },
            ["CreatedAt"]      = new() { S = detail.CreatedAt.ToString("O") },
            ["LastModifiedAt"] = new() { S = detail.LastModifiedAt.ToString("O") }
        };
        if (detail.Date.HasValue)
            item["Date"] = new AttributeValue { S = detail.Date.Value.ToString("yyyy-MM-dd") };
        if (detail.Tags is { Count: > 0 })
            item["Tags"] = new AttributeValue { SS = detail.Tags.ToList() };

        await dynamo.PutItemAsync(new PutItemRequest { TableName = tableName, Item = item }, ct)
            .ConfigureAwait(false);
    }

    public async Task DeleteAsync(NoteId noteId, CancellationToken ct = default)
    {
        await dynamo.DeleteItemAsync(new DeleteItemRequest
        {
            TableName = tableName,
            Key = new Dictionary<string, AttributeValue>
            {
                ["PK"] = new() { S = noteId.ToStreamId() }
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

    public async Task<NoteDetailView?> GetAsync(NoteId noteId, CancellationToken ct = default)
    {
        var response = await dynamo.GetItemAsync(new GetItemRequest
        {
            TableName = tableName,
            Key = new Dictionary<string, AttributeValue>
            {
                ["PK"] = new() { S = noteId.ToStreamId() }
            }
        }, ct).ConfigureAwait(false);

        if (!response.IsItemSet) return null;

        var item = response.Item;
        var date = item.TryGetValue("Date", out var dateAttr) ? DateOnly.Parse(dateAttr.S) : (DateOnly?)null;
        IReadOnlyList<string> tags = item.TryGetValue("Tags", out var tagsAttr) && tagsAttr.SS?.Count > 0
            ? tagsAttr.SS.AsReadOnly()
            : Array.Empty<string>();
        return new NoteDetailView(
            new NoteId(Guid.Parse(item["NoteId"].S)),
            item["Title"].S,
            item["Content"].S,
            DateTimeOffset.Parse(item["CreatedAt"].S),
            DateTimeOffset.Parse(item["LastModifiedAt"].S),
            date,
            tags);
    }
}
