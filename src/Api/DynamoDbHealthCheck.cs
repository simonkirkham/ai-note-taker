using Amazon.DynamoDBv2;

namespace Api;

public sealed class DynamoDbHealthCheck(IAmazonDynamoDB dynamo, string tableName) : IDynamoHealthCheck
{
    public async Task<DynamoHealth> CheckAsync(CancellationToken ct = default)
    {
        try
        {
            await dynamo.DescribeTableAsync(tableName, ct).ConfigureAwait(false);
            return new DynamoHealth(true);
        }
        catch (Exception ex)
        {
            return new DynamoHealth(false, ex.Message);
        }
    }
}
