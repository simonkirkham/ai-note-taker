using System.Text.Json;
using Amazon.DynamoDBv2;
using Amazon.DynamoDBv2.Model;

namespace Api.Mcp.OAuth;

// DynamoDB-backed rotating refresh-token store. PK "token" (the opaque refresh token); "payload" is
// the bound identity/audience JSON. Single-use rotation is enforced by DeleteItem(ReturnValues=ALL_OLD):
// the take reads AND removes the row, so a replayed (already-rotated) token finds nothing.
public sealed class DynamoDbMcpRefreshTokenStore(IAmazonDynamoDB dynamo, string tableName) : IMcpRefreshTokenStore
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public async Task PutAsync(McpRefreshToken token, CancellationToken ct = default)
    {
        var item = new Dictionary<string, AttributeValue>
        {
            ["token"] = new() { S = token.Token },
            ["payload"] = new() { S = JsonSerializer.Serialize(token, Json) }
        };
        await dynamo.PutItemAsync(new PutItemRequest { TableName = tableName, Item = item }, ct).ConfigureAwait(false);
    }

    public async Task<McpRefreshToken?> TakeAsync(string token, CancellationToken ct = default)
    {
        var response = await dynamo.DeleteItemAsync(new DeleteItemRequest
        {
            TableName = tableName,
            Key = new Dictionary<string, AttributeValue> { ["token"] = new() { S = token } },
            ReturnValues = ReturnValue.ALL_OLD
        }, ct).ConfigureAwait(false);

        if (response.Attributes is null
            || !response.Attributes.TryGetValue("payload", out var payload)
            || string.IsNullOrEmpty(payload.S))
            return null;

        return JsonSerializer.Deserialize<McpRefreshToken>(payload.S, Json);
    }
}
