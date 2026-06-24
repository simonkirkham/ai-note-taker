using Amazon.DynamoDBv2;
using Amazon.DynamoDBv2.Model;

namespace Api.Auth;

// Calendar token store keyed by (userId, workspaceId, provider) since 34-B. The physical DynamoDB
// schema is unchanged from 34-A — PK "sub" (= userId), SK "provider" — to avoid a RETAIN-table
// replacement (the SK now holds a "{workspaceId}#{provider}" composite). Keeping userId as the
// partition key isolates the shared default workspace (`__default__`) between users; the workspace
// scopes the connection within a user. Table: notetaker-calendar-tokens.
public sealed class DynamoDbCalendarTokenStore(IAmazonDynamoDB dynamo, string tableName) : ICalendarTokenStore
{
    private const string PartitionKey = "sub";
    private const string SortKey = "provider";
    private const string TokenAttribute = "refreshToken";
    private const string EmailAttribute = "email";

    private static string Sort(string workspaceId, string provider) => $"{workspaceId}#{provider}";

    public async Task UpsertAsync(string userId, string workspaceId, string provider, string refreshToken, string? email, CancellationToken ct = default)
    {
        var item = new Dictionary<string, AttributeValue>
        {
            [PartitionKey] = new() { S = userId },
            [SortKey] = new() { S = Sort(workspaceId, provider) },
            [TokenAttribute] = new() { S = refreshToken }
        };
        if (!string.IsNullOrEmpty(email))
            item[EmailAttribute] = new() { S = email };

        await dynamo.PutItemAsync(new PutItemRequest { TableName = tableName, Item = item }, ct)
            .ConfigureAwait(false);
    }

    public async Task<CalendarToken?> GetAsync(string userId, string workspaceId, string provider, CancellationToken ct = default)
    {
        var response = await dynamo.GetItemAsync(new GetItemRequest
        {
            TableName = tableName,
            Key = new Dictionary<string, AttributeValue>
            {
                [PartitionKey] = new() { S = userId },
                [SortKey] = new() { S = Sort(workspaceId, provider) }
            },
            ConsistentRead = true
        }, ct).ConfigureAwait(false);

        if (!response.IsItemSet || !response.Item.TryGetValue(TokenAttribute, out var token) || string.IsNullOrEmpty(token.S))
            return null;

        var email = response.Item.TryGetValue(EmailAttribute, out var e) ? e.S : null;
        return new CalendarToken(token.S, email);
    }

    public async Task DeleteAsync(string userId, string workspaceId, string provider, CancellationToken ct = default)
    {
        await dynamo.DeleteItemAsync(new DeleteItemRequest
        {
            TableName = tableName,
            Key = new Dictionary<string, AttributeValue>
            {
                [PartitionKey] = new() { S = userId },
                [SortKey] = new() { S = Sort(workspaceId, provider) }
            }
        }, ct).ConfigureAwait(false);
    }
}
