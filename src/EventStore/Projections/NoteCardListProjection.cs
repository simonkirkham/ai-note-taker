using System.Text.Json;
using Amazon.DynamoDBv2;
using Amazon.DynamoDBv2.Model;
using Domain.ActionItems;
using Domain.Notes;

namespace EventStore.Projections;

public record NoteCardActionItem(
    ActionId ActionId,
    string Description,
    bool Completed);

public record NoteCardView(
    NoteId NoteId,
    string Title,
    string Content,
    IReadOnlyList<NoteCardActionItem> ActionItems,
    DateOnly? Date,
    DateTimeOffset CreatedAt,
    DateTimeOffset LastModifiedAt,
    bool Deleted);

public interface INoteCardListStore
{
    Task UpsertAsync(NoteCardView card, CancellationToken ct = default);
    Task<NoteCardView?> GetByNoteAsync(NoteId noteId, CancellationToken ct = default);
    Task<IReadOnlyList<NoteCardView>> QueryAllAsync(CancellationToken ct = default);
}

public sealed class NoteCardListProjection
{
    private readonly Dictionary<NoteId, NoteCardView> _cards = new();
    private readonly Dictionary<ActionId, NoteId> _noteByAction = new();

    public void Handle(EventEnvelope envelope)
    {
        switch (EventDeserializer.Deserialize(envelope))
        {
            case NoteCreated e:
                _cards[e.NoteId] = new NoteCardView(e.NoteId, string.Empty, string.Empty,
                    Array.Empty<NoteCardActionItem>(), null,
                    envelope.OccurredAt, envelope.OccurredAt, false);
                break;
            case NoteRenamed e when _cards.TryGetValue(e.NoteId, out var c):
                _cards[e.NoteId] = c with { Title = e.NewTitle, LastModifiedAt = envelope.OccurredAt };
                break;
            case ContentEditedV2 e when _cards.TryGetValue(e.NoteId, out var c):
                var trimmed = e.NewContent.Length > 200 ? e.NewContent[..200] : e.NewContent;
                _cards[e.NoteId] = c with { Content = trimmed, LastModifiedAt = envelope.OccurredAt };
                break;
            case NoteDateSet e when _cards.TryGetValue(e.NoteId, out var c):
                _cards[e.NoteId] = c with { Date = e.Date, LastModifiedAt = envelope.OccurredAt };
                break;
            case NoteDeleted e when _cards.TryGetValue(e.NoteId, out var c):
                _cards[e.NoteId] = c with { Deleted = true, LastModifiedAt = envelope.OccurredAt };
                break;
            case ActionItemAdded e when _cards.TryGetValue(e.NoteId, out var c):
                _noteByAction[e.ActionId] = e.NoteId;
                _cards[e.NoteId] = c with
                {
                    ActionItems = c.ActionItems.Append(new NoteCardActionItem(e.ActionId, e.Description, false))
                        .ToList().AsReadOnly()
                };
                break;
            case ActionItemCompleted e when _noteByAction.TryGetValue(e.ActionId, out var noteId)
                && _cards.TryGetValue(noteId, out var cc):
                _cards[noteId] = cc with
                {
                    ActionItems = cc.ActionItems
                        .Select(a => a.ActionId == e.ActionId ? a with { Completed = true } : a)
                        .ToList().AsReadOnly()
                };
                break;
            case ActionItemReopened e when _noteByAction.TryGetValue(e.ActionId, out var noteId)
                && _cards.TryGetValue(noteId, out var rc):
                _cards[noteId] = rc with
                {
                    ActionItems = rc.ActionItems
                        .Select(a => a.ActionId == e.ActionId ? a with { Completed = false } : a)
                        .ToList().AsReadOnly()
                };
                break;
            case ActionItemDeleted e when _noteByAction.TryGetValue(e.ActionId, out var noteId)
                && _cards.TryGetValue(noteId, out var dc):
                _noteByAction.Remove(e.ActionId);
                _cards[noteId] = dc with
                {
                    ActionItems = dc.ActionItems
                        .Where(a => a.ActionId != e.ActionId)
                        .ToList().AsReadOnly()
                };
                break;
        }
    }

    public IReadOnlyList<NoteCardView> GetAll() =>
        _cards.Values
            .OrderByDescending(c => c.CreatedAt)
            .ToList()
            .AsReadOnly();
}

public sealed class DynamoDbNoteCardListStore(IAmazonDynamoDB dynamo, string tableName) : INoteCardListStore
{
    private readonly IAmazonDynamoDB _dynamo = dynamo;
    private readonly string _tableName = tableName;

    public async Task UpsertAsync(NoteCardView card, CancellationToken ct = default)
    {
        var attrs = new Dictionary<string, AttributeValue>
        {
            ["PK"]             = new() { S = card.NoteId.Value.ToString() },
            ["Title"]          = new() { S = card.Title },
            ["Content"]        = new() { S = card.Content },
            ["ActionItems"]    = new() { S = JsonSerializer.Serialize(card.ActionItems) },
            ["CreatedAt"]      = new() { S = card.CreatedAt.ToString("O") },
            ["LastModifiedAt"] = new() { S = card.LastModifiedAt.ToString("O") },
            ["Deleted"]        = new() { BOOL = card.Deleted }
        };
        if (card.Date.HasValue)
            attrs["Date"] = new() { S = card.Date.Value.ToString("O") };

        await _dynamo.PutItemAsync(new PutItemRequest
        {
            TableName = _tableName,
            Item = attrs
        }, ct).ConfigureAwait(false);
    }

    public async Task<NoteCardView?> GetByNoteAsync(NoteId noteId, CancellationToken ct = default)
    {
        var response = await _dynamo.GetItemAsync(new GetItemRequest
        {
            TableName = _tableName,
            Key = new Dictionary<string, AttributeValue>
            {
                ["PK"] = new() { S = noteId.Value.ToString() }
            }
        }, ct).ConfigureAwait(false);

        return response.Item.Count == 0 ? null : ToCard(response.Item);
    }

    public async Task<IReadOnlyList<NoteCardView>> QueryAllAsync(CancellationToken ct = default)
    {
        var response = await _dynamo.ScanAsync(new ScanRequest { TableName = _tableName }, ct)
            .ConfigureAwait(false);
        return response.Items.Select(ToCard).OrderByDescending(c => c.CreatedAt).ToList().AsReadOnly();
    }

    private static NoteCardView ToCard(Dictionary<string, AttributeValue> row)
    {
        var actions = JsonSerializer.Deserialize<List<ActionItemDto>>(row["ActionItems"].S)!
            .Select(d => new NoteCardActionItem(new ActionId(d.ActionId), d.Description, d.Completed))
            .ToList()
            .AsReadOnly();

        DateOnly? date = row.TryGetValue("Date", out var dateAttr)
            ? DateOnly.Parse(dateAttr.S)
            : null;

        return new NoteCardView(
            NoteId: new NoteId(Guid.Parse(row["PK"].S)),
            Title: row["Title"].S,
            Content: row["Content"].S,
            ActionItems: actions,
            Date: date,
            CreatedAt: DateTimeOffset.Parse(row["CreatedAt"].S),
            LastModifiedAt: DateTimeOffset.Parse(row["LastModifiedAt"].S),
            Deleted: row["Deleted"].BOOL ?? false);
    }

    private record ActionItemDto(Guid ActionId, string Description, bool Completed);
}
