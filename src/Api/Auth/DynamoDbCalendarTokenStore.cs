using Amazon.DynamoDBv2;
using Amazon.DynamoDBv2.Model;

namespace Api.Auth;

// (sub, provider)-keyed calendar token store — mirrors DynamoDbRefreshTokenStore but with a
// provider sort key so one user can connect Google and Microsoft independently (34-C) and the
// key can later widen to workspace (34-B). Table: notetaker-calendar-tokens (PK sub, SK provider).
public sealed class DynamoDbCalendarTokenStore(IAmazonDynamoDB dynamo, string tableName) : ICalendarTokenStore
{
    private const string PartitionKey = "sub";
    private const string SortKey = "provider";
    private const string TokenAttribute = "refreshToken";
    private const string EmailAttribute = "email";

    public async Task UpsertAsync(string sub, string provider, string refreshToken, string? email, CancellationToken ct = default)
    {
        var item = new Dictionary<string, AttributeValue>
        {
            [PartitionKey] = new() { S = sub },
            [SortKey] = new() { S = provider },
            [TokenAttribute] = new() { S = refreshToken }
        };
        if (!string.IsNullOrEmpty(email))
            item[EmailAttribute] = new() { S = email };

        await dynamo.PutItemAsync(new PutItemRequest { TableName = tableName, Item = item }, ct)
            .ConfigureAwait(false);
    }

    public async Task<CalendarToken?> GetAsync(string sub, string provider, CancellationToken ct = default)
    {
        var response = await dynamo.GetItemAsync(new GetItemRequest
        {
            TableName = tableName,
            Key = new Dictionary<string, AttributeValue>
            {
                [PartitionKey] = new() { S = sub },
                [SortKey] = new() { S = provider }
            },
            ConsistentRead = true
        }, ct).ConfigureAwait(false);

        if (!response.IsItemSet || !response.Item.TryGetValue(TokenAttribute, out var token) || string.IsNullOrEmpty(token.S))
            return null;

        var email = response.Item.TryGetValue(EmailAttribute, out var e) ? e.S : null;
        return new CalendarToken(token.S, email);
    }

    public async Task DeleteAsync(string sub, string provider, CancellationToken ct = default)
    {
        await dynamo.DeleteItemAsync(new DeleteItemRequest
        {
            TableName = tableName,
            Key = new Dictionary<string, AttributeValue>
            {
                [PartitionKey] = new() { S = sub },
                [SortKey] = new() { S = provider }
            }
        }, ct).ConfigureAwait(false);
    }
}
