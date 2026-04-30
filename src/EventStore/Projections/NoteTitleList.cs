using Amazon.DynamoDBv2;
using Amazon.DynamoDBv2.Model;
using Domain.Notes;

namespace EventStore.Projections;

public record NoteTitleListItem(NoteId NoteId, string Title, DateTimeOffset LastModifiedAt);

public record NoteTitleListView(IReadOnlyList<NoteTitleListItem> Items);

public sealed class NoteTitleListProjection
{
    private readonly Dictionary<NoteId, NoteTitleListItem> _items = new();

    public void Handle(EventEnvelope envelope)
    {
        switch (EventDeserializer.Deserialize(envelope))
        {
            case NoteCreated e:
                _items[e.NoteId] = new NoteTitleListItem(e.NoteId, string.Empty, envelope.OccurredAt);
                break;
            case NoteRenamed e:
                if (_items.TryGetValue(e.NoteId, out var existing))
                    _items[e.NoteId] = existing with { Title = e.NewTitle, LastModifiedAt = envelope.OccurredAt };
                break;
        }
    }

    public NoteTitleListView GetView() =>
        new(new List<NoteTitleListItem>(_items.Values).AsReadOnly());
}

public sealed class NoteTitleListStore(IAmazonDynamoDB dynamo, string tableName)
{
    public async Task UpsertAsync(NoteTitleListItem item, CancellationToken ct = default)
    {
        await dynamo.PutItemAsync(new PutItemRequest
        {
            TableName = tableName,
            Item = new Dictionary<string, AttributeValue>
            {
                ["PK"] = new AttributeValue { S = item.NoteId.ToStreamId() },
                ["NoteId"] = new AttributeValue { S = item.NoteId.Value.ToString() },
                ["Title"] = new AttributeValue { S = item.Title },
                ["LastModifiedAt"] = new AttributeValue { S = item.LastModifiedAt.ToString("O") }
            }
        }, ct).ConfigureAwait(false);
    }

    public async Task<NoteTitleListView> QueryAllAsync(CancellationToken ct = default)
    {
        var items = new List<NoteTitleListItem>();
        Dictionary<string, AttributeValue>? lastKey = null;
        do
        {
            var request = new ScanRequest { TableName = tableName, ExclusiveStartKey = lastKey };
            var response = await dynamo.ScanAsync(request, ct).ConfigureAwait(false);
            foreach (var row in response.Items)
            {
                items.Add(new NoteTitleListItem(
                    new NoteId(Guid.Parse(row["NoteId"].S)),
                    row["Title"].S,
                    DateTimeOffset.Parse(row["LastModifiedAt"].S)));
            }
            lastKey = response.LastEvaluatedKey?.Count > 0 ? response.LastEvaluatedKey : null;
        } while (lastKey is not null);
        return new NoteTitleListView(items.AsReadOnly());
    }
}
