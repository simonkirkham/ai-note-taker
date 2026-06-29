using Amazon.DynamoDBv2;
using Amazon.DynamoDBv2.Model;
using Domain.Notes;

namespace EventStore.Projections;

public sealed class DynamoDbTranscriptionDraftStore(IAmazonDynamoDB dynamo, string tableName) : ITranscriptionDraftStore
{
    // Abandoned drafts self-reap well after any meeting could run. The window is
    // far longer than a recording, so a draft is always recoverable while it
    // matters; DynamoDB TTL is the cleanup mechanism, set on the "TTL" attribute.
    private const int TtlHours = 48;

    public async Task SaveAsync(TranscriptionDraft draft, CancellationToken ct = default)
    {
        var ttl = draft.CapturedAt.AddHours(TtlHours).ToUnixTimeSeconds();
        var item = new Dictionary<string, AttributeValue>
        {
            ["PK"] = new() { S = draft.NoteId.ToStreamId() },
            ["NoteId"] = new() { S = draft.NoteId.Value.ToString() },
            ["UserId"] = new() { S = draft.UserId },
            ["Text"] = new() { S = draft.Text },
            ["DurationSeconds"] = new() { N = draft.DurationSeconds.ToString() },
            ["CapturedAt"] = new() { S = draft.CapturedAt.ToString("O") },
            ["TTL"] = new() { N = ttl.ToString() }
        };
        await dynamo.PutItemAsync(new PutItemRequest { TableName = tableName, Item = item }, ct)
            .ConfigureAwait(false);
    }

    public async Task<TranscriptionDraft?> GetAsync(NoteId noteId, CancellationToken ct = default)
    {
        var response = await dynamo.GetItemAsync(new GetItemRequest
        {
            TableName = tableName,
            Key = new Dictionary<string, AttributeValue> { ["PK"] = new() { S = noteId.ToStreamId() } },
            ConsistentRead = true
        }, ct).ConfigureAwait(false);

        if (!response.IsItemSet) return null;
        var item = response.Item;
        return new TranscriptionDraft(
            new NoteId(Guid.Parse(item["NoteId"].S)),
            item.TryGetValue("UserId", out var uid) ? uid.S : "",
            item.TryGetValue("Text", out var text) ? text.S : "",
            item.TryGetValue("DurationSeconds", out var dur) ? int.Parse(dur.N) : 0,
            DateTimeOffset.Parse(item["CapturedAt"].S));
    }

    public async Task DeleteAsync(NoteId noteId, CancellationToken ct = default)
    {
        await dynamo.DeleteItemAsync(new DeleteItemRequest
        {
            TableName = tableName,
            Key = new Dictionary<string, AttributeValue> { ["PK"] = new() { S = noteId.ToStreamId() } }
        }, ct).ConfigureAwait(false);
    }
}
