using System.Text.Json;
using Amazon.DynamoDBv2;
using Amazon.DynamoDBv2.Model;

namespace EventStore;

public sealed class DynamoDbEventStore(IAmazonDynamoDB dynamo, string tableName) : IEventStore
{
    private const string MetaStreamSk = "META#stream";
    private static readonly JsonSerializerOptions JsonOpts = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    private static string SequenceSk(long seq) => $"v{seq:D8}";
    private static long ParseSequenceSk(string sk) => long.Parse(sk[1..]);

    public async Task AppendAsync(string streamId, long expectedVersion, IReadOnlyList<EventEnvelope> events, CancellationToken ct = default)
    {
        if (events.Count == 0) return;

        var newVersion = expectedVersion + events.Count;
        var transactItems = new List<TransactWriteItem>(events.Count + 1);

        var seq = expectedVersion + 1;
        foreach (var e in events)
        {
            transactItems.Add(new TransactWriteItem
            {
                Put = new Put
                {
                    TableName = tableName,
                    Item = new Dictionary<string, AttributeValue>
                    {
                        ["PK"] = new AttributeValue { S = streamId },
                        ["SK"] = new AttributeValue { S = SequenceSk(seq++) },
                        ["EventType"] = new AttributeValue { S = e.EventType },
                        ["EventVersion"] = new AttributeValue { N = e.EventVersion.ToString() },
                        ["OccurredAt"] = new AttributeValue { S = e.OccurredAt.ToString("O") },
                        ["Payload"] = new AttributeValue { S = e.Payload },
                        ["Metadata"] = new AttributeValue { S = JsonSerializer.Serialize(e.Metadata, JsonOpts) }
                    }
                }
            });
        }

        string conditionExpression;
        Dictionary<string, AttributeValue> exprValues;

        if (expectedVersion == 0)
        {
            conditionExpression = "attribute_not_exists(PK)";
            exprValues = new Dictionary<string, AttributeValue>
            {
                [":newVersion"] = new AttributeValue { N = newVersion.ToString() }
            };
        }
        else
        {
            conditionExpression = "currentVersion = :expected";
            exprValues = new Dictionary<string, AttributeValue>
            {
                [":expected"] = new AttributeValue { N = expectedVersion.ToString() },
                [":newVersion"] = new AttributeValue { N = newVersion.ToString() }
            };
        }

        transactItems.Add(new TransactWriteItem
        {
            Update = new Update
            {
                TableName = tableName,
                Key = new Dictionary<string, AttributeValue>
                {
                    ["PK"] = new AttributeValue { S = streamId },
                    ["SK"] = new AttributeValue { S = MetaStreamSk }
                },
                UpdateExpression = "SET currentVersion = :newVersion",
                ConditionExpression = conditionExpression,
                ExpressionAttributeValues = exprValues
            }
        });

        try
        {
            await dynamo.TransactWriteItemsAsync(new TransactWriteItemsRequest { TransactItems = transactItems }, ct).ConfigureAwait(false);
        }
        catch (TransactionCanceledException ex)
            when (ex.CancellationReasons.Any(r => r.Code == "ConditionalCheckFailed"))
        {
            // Version read after conflict may not reflect the exact version at conflict time;
            // callers should re-read the stream before retrying.
            var actual = await GetCurrentVersionAsync(streamId, ct).ConfigureAwait(false);
            throw new ConcurrencyException(streamId, expectedVersion, actual);
        }
    }

    public async Task<IReadOnlyList<EventEnvelope>> ReadAsync(string streamId, CancellationToken ct = default)
    {
        var items = new List<Dictionary<string, AttributeValue>>();
        Dictionary<string, AttributeValue>? lastKey = null;

        do
        {
            var request = new QueryRequest
            {
                TableName = tableName,
                KeyConditionExpression = "PK = :pk AND begins_with(SK, :v)",
                ExpressionAttributeValues = new Dictionary<string, AttributeValue>
                {
                    [":pk"] = new AttributeValue { S = streamId },
                    [":v"] = new AttributeValue { S = "v" }
                },
                ScanIndexForward = true,
                ExclusiveStartKey = lastKey
            };

            var response = await dynamo.QueryAsync(request, ct).ConfigureAwait(false);
            items.AddRange(response.Items);
            lastKey = response.LastEvaluatedKey?.Count > 0 ? response.LastEvaluatedKey : null;
        }
        while (lastKey is not null);

        return items
            .Select(item => new EventEnvelope(
                StreamId: streamId,
                SequenceNumber: ParseSequenceSk(item["SK"].S),
                EventType: item["EventType"].S,
                EventVersion: int.Parse(item["EventVersion"].N),
                OccurredAt: DateTimeOffset.Parse(item["OccurredAt"].S),
                Payload: item["Payload"].S,
                Metadata: JsonSerializer.Deserialize<EventMetadata>(item["Metadata"].S, JsonOpts)!
            ))
            .ToList()
            .AsReadOnly();
    }

    private async Task<long> GetCurrentVersionAsync(string streamId, CancellationToken ct)
    {
        var response = await dynamo.GetItemAsync(new GetItemRequest
        {
            TableName = tableName,
            Key = new Dictionary<string, AttributeValue>
            {
                ["PK"] = new AttributeValue { S = streamId },
                ["SK"] = new AttributeValue { S = MetaStreamSk }
            }
        }, ct).ConfigureAwait(false);

        return response.Item.TryGetValue("currentVersion", out var v) ? long.Parse(v.N) : 0;
    }
}
