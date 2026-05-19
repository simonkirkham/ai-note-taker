using System.Text.Json;
using Amazon.DynamoDBv2;
using Amazon.DynamoDBv2.Model;
using Domain.ActionItems;
using Domain.Folders;
using Domain.Notes;

namespace EventStore.Projections;

public sealed class DynamoDbNoteCardListStore(IAmazonDynamoDB dynamo, string tableName) : INoteCardListStore
{
    public async Task UpsertAsync(NoteCardView card, CancellationToken ct = default)
    {
        var attrs = new Dictionary<string, AttributeValue>
        {
            ["PK"] = new() { S = card.NoteId.Value.ToString() },
            ["Title"] = new() { S = card.Title },
            ["Content"] = new() { S = card.Content },
            ["ActionItems"] = new() { S = JsonSerializer.Serialize(card.ActionItems) },
            ["CreatedAt"] = new() { S = card.CreatedAt.ToString("O") },
            ["LastModifiedAt"] = new() { S = card.LastModifiedAt.ToString("O") },
            ["Deleted"] = new() { BOOL = card.Deleted },
            ["UserId"] = new() { S = card.UserId }
        };
        if (card.Date.HasValue)
            attrs["Date"] = new() { S = card.Date.Value.ToString("O") };
        if (card.Tags is { Count: > 0 })
            attrs["Tags"] = new() { SS = card.Tags.ToList() };
        if (card.FolderId.HasValue)
            attrs["FolderId"] = new() { S = card.FolderId.Value.Value.ToString() };

        await dynamo.PutItemAsync(new PutItemRequest
        {
            TableName = tableName,
            Item = attrs
        }, ct).ConfigureAwait(false);
    }

    public async Task<NoteCardView?> GetByNoteAsync(NoteId noteId, CancellationToken ct = default)
    {
        var response = await dynamo.GetItemAsync(new GetItemRequest
        {
            TableName = tableName,
            Key = new Dictionary<string, AttributeValue>
            {
                ["PK"] = new() { S = noteId.Value.ToString() }
            },
            ConsistentRead = true
        }, ct).ConfigureAwait(false);

        if (!response.IsItemSet) return null;
        return ToCard(response.Item);
    }

    public async Task<IReadOnlyList<NoteCardView>> QueryAllAsync(CancellationToken ct = default)
    {
        var response = await dynamo.ScanAsync(new ScanRequest { TableName = tableName, ConsistentRead = true }, ct)
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
        IReadOnlyList<string> tags = row.TryGetValue("Tags", out var tagsAttr) && tagsAttr.SS?.Count > 0
            ? tagsAttr.SS.AsReadOnly()
            : Array.Empty<string>();
        FolderId? folderId = row.TryGetValue("FolderId", out var folderAttr)
            ? new FolderId(Guid.Parse(folderAttr.S))
            : null;

        return new NoteCardView(
            NoteId: new NoteId(Guid.Parse(row["PK"].S)),
            Title: row["Title"].S,
            Content: row["Content"].S,
            ActionItems: actions,
            Date: date,
            CreatedAt: DateTimeOffset.Parse(row["CreatedAt"].S),
            LastModifiedAt: DateTimeOffset.Parse(row["LastModifiedAt"].S),
            Deleted: row["Deleted"].BOOL ?? false,
            Tags: tags,
            FolderId: folderId,
            UserId: row.TryGetValue("UserId", out var uidAttr) ? uidAttr.S : "");
    }

    private record ActionItemDto(ActionId ActionId, string Description, bool Completed);
}
