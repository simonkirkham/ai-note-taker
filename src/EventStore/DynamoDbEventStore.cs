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
        var transactItems = BuildEventWriteItems(streamId, expectedVersion, events);
        transactItems.Add(BuildVersionMetaUpdate(streamId, expectedVersion, newVersion));

        try
        {
            await dynamo.TransactWriteItemsAsync(new TransactWriteItemsRequest { TransactItems = transactItems }, ct).ConfigureAwait(false);
        }
        catch (TransactionCanceledException ex) when (IsRetriableCancellation(ex))
        {
            // Version read after conflict may not reflect the exact version at conflict time;
            // callers should re-read the stream before retrying.
            var actual = await GetCurrentVersionAsync(streamId, ct).ConfigureAwait(false);
            var reason = ex.CancellationReasons
                .FirstOrDefault(r => r.Code is "ConditionalCheckFailed" or "TransactionConflict")?.Code;
            throw new ConcurrencyException(streamId, expectedVersion, actual, reason);
        }
    }

    // A TransactWriteItems cancellation is a retriable optimistic-concurrency conflict — re-read +
    // re-append resolves it — for two reasons, both mapped to ConcurrencyException so the command
    // handler's bounded retry handles them and the loser of a race is never dropped:
    //  - ConditionalCheckFailed: our `currentVersion = :expected` version guard lost; another append
    //    advanced the stream first.
    //  - TransactionConflict: DynamoDB cancelled this transaction because a CONCURRENT transaction
    //    touched the same item (the stream META row) — two genuinely-simultaneous appends to one
    //    stream (e.g. a space-separated multi-tag add fanning into parallel POSTs). NOT a version-guard
    //    failure, so it was previously uncaught → surfaced as an unhandled 500, and because the handler
    //    only retries ConcurrencyException the write was silently DROPPED (BUG-28). Not reproducible
    //    with the in-memory store (no transaction-conflict semantics) — only against real DynamoDB.
    public static bool IsRetriableCancellation(TransactionCanceledException ex) =>
        ex.CancellationReasons.Any(r => r.Code is "ConditionalCheckFailed" or "TransactionConflict");

    private List<TransactWriteItem> BuildEventWriteItems(string streamId, long expectedVersion, IReadOnlyList<EventEnvelope> events)
    {
        var items = new List<TransactWriteItem>(events.Count + 1);
        var seq = expectedVersion + 1;
        foreach (var e in events)
        {
            items.Add(new TransactWriteItem
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
        return items;
    }

    private TransactWriteItem BuildVersionMetaUpdate(string streamId, long expectedVersion, long newVersion)
    {
        var (conditionExpression, exprValues) = expectedVersion == 0
            ? ("attribute_not_exists(PK)", new Dictionary<string, AttributeValue>
            {
                [":newVersion"] = new AttributeValue { N = newVersion.ToString() }
            })
            : ("currentVersion = :expected", new Dictionary<string, AttributeValue>
            {
                [":expected"] = new AttributeValue { N = expectedVersion.ToString() },
                [":newVersion"] = new AttributeValue { N = newVersion.ToString() }
            });

        return new TransactWriteItem
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
        };
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
                ConsistentRead = true,
                ExclusiveStartKey = lastKey
            };

            var response = await dynamo.QueryAsync(request, ct).ConfigureAwait(false);
            items.AddRange(response.Items);
            lastKey = response.LastEvaluatedKey?.Count > 0 ? response.LastEvaluatedKey : null;
        }
        while (lastKey is not null);

        return items
            .Select(item => MapItemToEnvelope(streamId, item))
            .ToList()
            .AsReadOnly();
    }

    public async Task<IReadOnlyList<EventEnvelope>> ReadAllStreamsAsync(CancellationToken ct = default)
    {
        var items = new List<Dictionary<string, AttributeValue>>();
        Dictionary<string, AttributeValue>? lastKey = null;

        do
        {
            var request = new ScanRequest
            {
                TableName = tableName,
                FilterExpression = "begins_with(SK, :v)",
                ExpressionAttributeValues = new Dictionary<string, AttributeValue>
                {
                    [":v"] = new AttributeValue { S = "v" }
                },
                ExclusiveStartKey = lastKey
            };
            var response = await dynamo.ScanAsync(request, ct).ConfigureAwait(false);
            items.AddRange(response.Items);
            lastKey = response.LastEvaluatedKey?.Count > 0 ? response.LastEvaluatedKey : null;
        }
        while (lastKey is not null);

        return items
            .Select(item => MapItemToEnvelope(item["PK"].S, item))
            .OrderBy(e => e.StreamId)
            .ThenBy(e => e.SequenceNumber)
            .ToList()
            .AsReadOnly();
    }

    private EventEnvelope MapItemToEnvelope(string streamId, Dictionary<string, AttributeValue> item) =>
        new(StreamId: streamId,
            SequenceNumber: ParseSequenceSk(item["SK"].S),
            EventType: item["EventType"].S,
            EventVersion: int.Parse(item["EventVersion"].N),
            OccurredAt: DateTimeOffset.Parse(item["OccurredAt"].S),
            Payload: item["Payload"].S,
            Metadata: JsonSerializer.Deserialize<EventMetadata>(item["Metadata"].S, JsonOpts)!);

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
