using System.Text.Json;
using Amazon.DynamoDBv2;
using Amazon.DynamoDBv2.Model;
using Domain.ActionItems;
using Domain.Notes;

namespace EventStore.Projections;

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

        if (!response.IsItemSet) return null;
        return ToCard(response.Item);
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
            .Select(d => new NoteCardActionItem(d.ActionId, d.Description, d.Completed))
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

    private record ActionItemDto(ActionId ActionId, string Description, bool Completed);
}
