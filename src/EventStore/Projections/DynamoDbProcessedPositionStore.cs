using Amazon.DynamoDBv2;
using Amazon.DynamoDBv2.Model;

namespace EventStore.Projections;

public sealed class DynamoDbProcessedPositionStore(IAmazonDynamoDB dynamo, string tableName) : IProcessedPositionStore
{
    public async Task<long> GetLastSeqAsync(string streamId, CancellationToken ct = default)
    {
        var response = await dynamo.GetItemAsync(new GetItemRequest
        {
            TableName = tableName,
            Key = new Dictionary<string, AttributeValue> { ["PK"] = new() { S = streamId } },
            ConsistentRead = true
        }, ct).ConfigureAwait(false);

        return response.Item is { Count: > 0 } item && item.TryGetValue("LastSeq", out var v) && long.TryParse(v.N, out var seq)
            ? seq
            : -1;
    }

    public async Task SetLastSeqAsync(string streamId, long seq, CancellationToken ct = default)
    {
        try
        {
            await dynamo.UpdateItemAsync(new UpdateItemRequest
            {
                TableName = tableName,
                Key = new Dictionary<string, AttributeValue> { ["PK"] = new() { S = streamId } },
                UpdateExpression = "SET LastSeq = :seq",
                ConditionExpression = "attribute_not_exists(PK) OR LastSeq < :seq",
                ExpressionAttributeValues = new Dictionary<string, AttributeValue> { [":seq"] = new() { N = seq.ToString() } }
            }, ct).ConfigureAwait(false);
        }
        catch (ConditionalCheckFailedException)
        {
            // Another invocation already advanced the mark to >= seq. The guard is a
            // monotonic high-water mark, so losing this race is the correct outcome.
        }
    }
}
