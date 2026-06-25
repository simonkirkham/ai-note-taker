using System.Text.Json;
using Amazon.DynamoDBv2;
using Amazon.DynamoDBv2.Model;

namespace Api.Mcp.OAuth;

// DynamoDB-backed short-lived OAuth store. PK "id" (the google_state or the issued code); a "kind"
// guards a state from being consumed as a code (and vice-versa); "payload" is the JSON record;
// "TTL" is a Unix-seconds expiry DynamoDB reaps. Single-use is enforced by DeleteItem(ReturnValues=
// ALL_OLD): the take reads the item AND removes it in one call, so a replay finds nothing. The stored
// expiry is also re-checked on read because DynamoDB TTL deletion can lag minutes behind the timestamp.
public sealed class DynamoDbMcpAuthCodeStore(IAmazonDynamoDB dynamo, string tableName, McpOAuthOptions options) : IMcpAuthCodeStore
{
    private const string KindPending = "pending";
    private const string KindCode = "code";
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public Task PutPendingAsync(McpPendingAuth pending, DateTimeOffset now, CancellationToken ct = default) =>
        PutAsync(pending.GoogleState, KindPending, pending, now.Add(options.AuthCodeLifetime), ct);

    public Task<McpPendingAuth?> TakePendingAsync(string googleState, DateTimeOffset now, CancellationToken ct = default) =>
        TakeAsync<McpPendingAuth>(googleState, KindPending, now, ct);

    public Task PutCodeAsync(McpAuthCode code, DateTimeOffset now, CancellationToken ct = default) =>
        PutAsync(code.Code, KindCode, code, now.Add(options.AuthCodeLifetime), ct);

    public Task<McpAuthCode?> TakeCodeAsync(string code, DateTimeOffset now, CancellationToken ct = default) =>
        TakeAsync<McpAuthCode>(code, KindCode, now, ct);

    private async Task PutAsync<T>(string id, string kind, T payload, DateTimeOffset expiresAt, CancellationToken ct)
    {
        var item = new Dictionary<string, AttributeValue>
        {
            ["id"] = new() { S = id },
            ["kind"] = new() { S = kind },
            ["payload"] = new() { S = JsonSerializer.Serialize(payload, Json) },
            ["expiresAtUnix"] = new() { N = expiresAt.ToUnixTimeSeconds().ToString() },
            ["TTL"] = new() { N = expiresAt.ToUnixTimeSeconds().ToString() }
        };
        await dynamo.PutItemAsync(new PutItemRequest { TableName = tableName, Item = item }, ct).ConfigureAwait(false);
    }

    private async Task<T?> TakeAsync<T>(string id, string kind, DateTimeOffset now, CancellationToken ct) where T : class
    {
        var response = await dynamo.DeleteItemAsync(new DeleteItemRequest
        {
            TableName = tableName,
            Key = new Dictionary<string, AttributeValue> { ["id"] = new() { S = id } },
            ReturnValues = ReturnValue.ALL_OLD
        }, ct).ConfigureAwait(false);

        if (response.Attributes is null || response.Attributes.Count == 0)
            return null;
        if (!response.Attributes.TryGetValue("kind", out var k) || k.S != kind)
            return null;
        if (response.Attributes.TryGetValue("expiresAtUnix", out var exp)
            && long.TryParse(exp.N, out var expUnix)
            && now.ToUnixTimeSeconds() > expUnix)
            return null;
        if (!response.Attributes.TryGetValue("payload", out var payload) || string.IsNullOrEmpty(payload.S))
            return null;

        return JsonSerializer.Deserialize<T>(payload.S, Json);
    }
}
