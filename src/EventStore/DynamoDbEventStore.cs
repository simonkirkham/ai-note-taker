using System.Text.Json;
using Amazon.DynamoDBv2;
using Amazon.DynamoDBv2.Model;

namespace EventStore;

public sealed class DynamoDbEventStore(IAmazonDynamoDB dynamo, string tableName) : IEventStore
{
    private static readonly JsonSerializerOptions JsonOpts = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

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
                        ["SK"] = new AttributeValue { S = $"v{seq++:D8}" },
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
                    ["SK"] = new AttributeValue { S = "META#stream" }
                },
                UpdateExpression = "SET currentVersion = :newVersion",
                ConditionExpression = conditionExpression,
                ExpressionAttributeValues = exprValues
            }
        });

        try
        {
            await dynamo.TransactWriteItemsAsync(new TransactWriteItemsRequest { TransactItems = transactItems }, ct);
        }
        catch (TransactionCanceledException ex)
            when (ex.CancellationReasons.Any(r => r.Code == "ConditionalCheckFailed"))
        {
            var actual = await GetCurrentVersionAsync(streamId, ct);
            throw new ConcurrencyException(streamId, expectedVersion, actual);
        }
    }

    public async Task<IReadOnlyList<EventEnvelope>> ReadAsync(string streamId, CancellationToken ct = default)
    {
        var response = await dynamo.QueryAsync(new QueryRequest
        {
            TableName = tableName,
            KeyConditionExpression = "PK = :pk AND begins_with(SK, :v)",
            ExpressionAttributeValues = new Dictionary<string, AttributeValue>
            {
                [":pk"] = new AttributeValue { S = streamId },
                [":v"] = new AttributeValue { S = "v" }
            },
            ScanIndexForward = true
        }, ct);

        return response.Items
            .Select(item => new EventEnvelope(
                StreamId: streamId,
                SequenceNumber: long.Parse(item["SK"].S[1..]),
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
                ["SK"] = new AttributeValue { S = "META#stream" }
            }
        }, ct);

        return response.Item.TryGetValue("currentVersion", out var v) ? long.Parse(v.N) : 0;
    }
}
