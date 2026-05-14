using Amazon.DynamoDBv2;
using Amazon.DynamoDBv2.Model;

namespace EventStore.Projections;

public sealed class DynamoDbTagIndexStore(IAmazonDynamoDB dynamo, string tableName) : ITagIndexStore
{
    private readonly IAmazonDynamoDB _dynamo = dynamo;
    private readonly string _tableName = tableName;

    public async Task PutAsync(string tag, string noteId, CancellationToken ct = default)
    {
        await _dynamo.PutItemAsync(new PutItemRequest
        {
            TableName = _tableName,
            Item = new Dictionary<string, AttributeValue>
            {
                ["Tag"]    = new() { S = tag },
                ["NoteId"] = new() { S = noteId }
            }
        }, ct).ConfigureAwait(false);
    }

    public async Task DeleteAsync(string tag, string noteId, CancellationToken ct = default)
    {
        await _dynamo.DeleteItemAsync(new DeleteItemRequest
        {
            TableName = _tableName,
            Key = new Dictionary<string, AttributeValue>
            {
                ["Tag"]    = new() { S = tag },
                ["NoteId"] = new() { S = noteId }
            }
        }, ct).ConfigureAwait(false);
    }

    public async Task DeleteByNoteAsync(string noteId, CancellationToken ct = default)
    {
        Dictionary<string, AttributeValue>? lastKey = null;
        do
        {
            var scan = await _dynamo.ScanAsync(new ScanRequest
            {
                TableName = _tableName,
                FilterExpression = "NoteId = :noteId",
                ExpressionAttributeValues = new Dictionary<string, AttributeValue>
                {
                    [":noteId"] = new() { S = noteId }
                },
                ProjectionExpression = "Tag, NoteId",
                ExclusiveStartKey = lastKey
            }, ct).ConfigureAwait(false);

            for (var i = 0; i < scan.Items.Count; i += 25)
            {
                var batch = scan.Items.Skip(i).Take(25)
                    .Select(row => new WriteRequest
                    {
                        DeleteRequest = new DeleteRequest
                        {
                            Key = new Dictionary<string, AttributeValue>
                            {
                                ["Tag"]    = row["Tag"],
                                ["NoteId"] = row["NoteId"]
                            }
                        }
                    }).ToList();

                await _dynamo.BatchWriteItemAsync(new BatchWriteItemRequest
                {
                    RequestItems = new Dictionary<string, List<WriteRequest>> { [_tableName] = batch }
                }, ct).ConfigureAwait(false);
            }

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
            var response = await _dynamo.ScanAsync(new ScanRequest
            {
                TableName = _tableName,
                ExclusiveStartKey = lastKey
            }, ct).ConfigureAwait(false);
            foreach (var row in response.Items)
                items.Add(new TagIndexView(row["Tag"].S, row["NoteId"].S));
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
            var scan = await _dynamo.ScanAsync(new ScanRequest
            {
                TableName = _tableName,
                ProjectionExpression = "Tag, NoteId",
                ExclusiveStartKey = lastKey
            }, ct).ConfigureAwait(false);

            for (var i = 0; i < scan.Items.Count; i += 25)
            {
                var batch = scan.Items.Skip(i).Take(25)
                    .Select(row => new WriteRequest
                    {
                        DeleteRequest = new DeleteRequest
                        {
                            Key = new Dictionary<string, AttributeValue>
                            {
                                ["Tag"]    = row["Tag"],
                                ["NoteId"] = row["NoteId"]
                            }
                        }
                    }).ToList();

                await _dynamo.BatchWriteItemAsync(new BatchWriteItemRequest
                {
                    RequestItems = new Dictionary<string, List<WriteRequest>> { [_tableName] = batch }
                }, ct).ConfigureAwait(false);
            }

            lastKey = scan.LastEvaluatedKey?.Count > 0 ? scan.LastEvaluatedKey : null;
        }
        while (lastKey is not null);
    }
}
