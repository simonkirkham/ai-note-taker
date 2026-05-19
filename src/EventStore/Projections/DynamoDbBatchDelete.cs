using Amazon.DynamoDBv2;
using Amazon.DynamoDBv2.Model;

namespace EventStore.Projections;

internal static class DynamoDbBatchDelete
{
    internal static async Task ByPrimaryKeyAsync(IAmazonDynamoDB dynamo, string tableName,
        List<Dictionary<string, AttributeValue>> items, CancellationToken ct)
    {
        for (var i = 0; i < items.Count; i += 25)
        {
            var batch = items.Skip(i).Take(25)
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
    }
}
