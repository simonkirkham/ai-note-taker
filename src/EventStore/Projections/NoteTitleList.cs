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
            case NoteDeleted e:
                _items.Remove(e.NoteId);
                break;
            default:
                break;
        }
    }

    public NoteTitleListView GetView() =>
        new(new List<NoteTitleListItem>(_items.Values).AsReadOnly());
}

public interface INoteTitleListStore
{
    Task UpsertAsync(NoteTitleListItem item, CancellationToken ct = default);
    Task DeleteAsync(NoteId noteId, CancellationToken ct = default);
    Task DeleteAllAsync(CancellationToken ct = default);
    Task<NoteTitleListView> QueryAllAsync(CancellationToken ct = default);
}

public sealed class NoteTitleListStore(IAmazonDynamoDB dynamo, string tableName) : INoteTitleListStore
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

    public async Task DeleteAsync(NoteId noteId, CancellationToken ct = default)
    {
        await dynamo.DeleteItemAsync(new DeleteItemRequest
        {
            TableName = tableName,
            Key = new Dictionary<string, AttributeValue>
            {
                ["PK"] = new() { S = noteId.ToStreamId() }
            }
        }, ct).ConfigureAwait(false);
    }

    public async Task DeleteAllAsync(CancellationToken ct = default)
    {
        Dictionary<string, AttributeValue>? lastKey = null;
        do
        {
            var scan = await dynamo.ScanAsync(new ScanRequest
            {
                TableName = tableName,
                ProjectionExpression = "PK",
                ExclusiveStartKey = lastKey
            }, ct).ConfigureAwait(false);

            for (var i = 0; i < scan.Items.Count; i += 25)
            {
                var batch = scan.Items.Skip(i).Take(25)
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

            lastKey = scan.LastEvaluatedKey?.Count > 0 ? scan.LastEvaluatedKey : null;
        }
        while (lastKey is not null);
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
