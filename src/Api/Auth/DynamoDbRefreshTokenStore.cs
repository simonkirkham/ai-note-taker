using Amazon.DynamoDBv2;
using Amazon.DynamoDBv2.Model;

namespace Api.Auth;

public sealed class DynamoDbRefreshTokenStore(IAmazonDynamoDB dynamo, string tableName) : IRefreshTokenStore
{
    private const string PartitionKey = "sub";
    private const string TokenAttribute = "refreshToken";

    public async Task UpsertAsync(string sub, string refreshToken, CancellationToken ct = default)
    {
        var item = new Dictionary<string, AttributeValue>
        {
            [PartitionKey] = new() { S = sub },
            [TokenAttribute] = new() { S = refreshToken }
        };
        await dynamo.PutItemAsync(new PutItemRequest { TableName = tableName, Item = item }, ct)
            .ConfigureAwait(false);
    }

    public async Task<string?> GetAsync(string sub, CancellationToken ct = default)
    {
        var response = await dynamo.GetItemAsync(new GetItemRequest
        {
            TableName = tableName,
            Key = new Dictionary<string, AttributeValue> { [PartitionKey] = new() { S = sub } },
            ConsistentRead = true
        }, ct).ConfigureAwait(false);

        if (!response.IsItemSet) return null;
        return response.Item.TryGetValue(TokenAttribute, out var token) ? token.S : null;
    }

    public async Task DeleteAsync(string sub, CancellationToken ct = default)
    {
        await dynamo.DeleteItemAsync(new DeleteItemRequest
        {
            TableName = tableName,
            Key = new Dictionary<string, AttributeValue> { [PartitionKey] = new() { S = sub } }
        }, ct).ConfigureAwait(false);
    }
}
