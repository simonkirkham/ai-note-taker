using Amazon.DynamoDBv2;
using Amazon.DynamoDBv2.Model;
using Domain.Notes;

namespace EventStore.Projections;

public record NoteDetailView(
    NoteId NoteId,
    string Title,
    string Content,
    DateTimeOffset CreatedAt,
    DateTimeOffset LastModifiedAt);

public interface INoteDetailStore
{
    Task UpsertAsync(NoteDetailView detail, CancellationToken ct = default);
    Task<NoteDetailView?> GetAsync(NoteId noteId, CancellationToken ct = default);
}

public sealed class NoteDetailProjection
{
    private readonly Dictionary<NoteId, NoteDetailView> _items = new();

    public void Handle(EventEnvelope envelope)
    {
        switch (EventDeserializer.Deserialize(envelope))
        {
            case NoteCreated e:
                _items[e.NoteId] = new NoteDetailView(e.NoteId, string.Empty, string.Empty,
                    envelope.OccurredAt, envelope.OccurredAt);
                break;
            case NoteRenamed e:
                if (_items.TryGetValue(e.NoteId, out var existing))
                    _items[e.NoteId] = existing with { Title = e.NewTitle, LastModifiedAt = envelope.OccurredAt };
                break;
            case ContentEdited e:
                if (_items.TryGetValue(e.NoteId, out var cur))
                    _items[e.NoteId] = cur with { Content = e.NewContent, LastModifiedAt = envelope.OccurredAt };
                break;
            case ContentEditedV2 e:
                if (_items.TryGetValue(e.NoteId, out var cur2))
                    _items[e.NoteId] = cur2 with { Content = e.NewContent, LastModifiedAt = envelope.OccurredAt };
                break;
            default:
                break;
        }
    }

    public NoteDetailView? GetDetail(NoteId noteId) =>
        _items.TryGetValue(noteId, out var detail) ? detail : null;
}

public sealed class DynamoDbNoteDetailStore(IAmazonDynamoDB dynamo, string tableName) : INoteDetailStore
{
    public async Task UpsertAsync(NoteDetailView detail, CancellationToken ct = default)
    {
        await dynamo.PutItemAsync(new PutItemRequest
        {
            TableName = tableName,
            Item = new Dictionary<string, AttributeValue>
            {
                ["PK"]             = new() { S = detail.NoteId.ToStreamId() },
                ["NoteId"]         = new() { S = detail.NoteId.Value.ToString() },
                ["Title"]          = new() { S = detail.Title },
                ["Content"]        = new() { S = detail.Content },
                ["CreatedAt"]      = new() { S = detail.CreatedAt.ToString("O") },
                ["LastModifiedAt"] = new() { S = detail.LastModifiedAt.ToString("O") }
            }
        }, ct).ConfigureAwait(false);
    }

    public async Task<NoteDetailView?> GetAsync(NoteId noteId, CancellationToken ct = default)
    {
        var response = await dynamo.GetItemAsync(new GetItemRequest
        {
            TableName = tableName,
            Key = new Dictionary<string, AttributeValue>
            {
                ["PK"] = new() { S = noteId.ToStreamId() }
            }
        }, ct).ConfigureAwait(false);

        if (!response.IsItemSet) return null;

        var item = response.Item;
        return new NoteDetailView(
            new NoteId(Guid.Parse(item["NoteId"].S)),
            item["Title"].S,
            item["Content"].S,
            DateTimeOffset.Parse(item["CreatedAt"].S),
            DateTimeOffset.Parse(item["LastModifiedAt"].S));
    }
}
