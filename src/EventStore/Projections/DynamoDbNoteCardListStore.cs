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
        if (!string.IsNullOrEmpty(card.WorkspaceId))
            attrs["WorkspaceId"] = new() { S = card.WorkspaceId };

        await dynamo.PutItemAsync(new PutItemRequest
        {
            TableName = tableName,
            Item = attrs
        }, ct).ConfigureAwait(false);
    }

    // SET the note-owned attributes only (leaving ActionItems untouched), so a concurrent
    // action-item write to the same card row does not get clobbered. ActionItems is seeded to an
    // empty list on the first write (if_not_exists) so the row is always readable; a later
    // note-field write never overwrites it. Optional attributes absent on the card are REMOVEd so
    // the row matches a full rebuild (e.g. an untag-to-empty drops the Tags set, which Dynamo
    // cannot store empty).
    public async Task UpsertNoteFieldsAsync(NoteCardView card, CancellationToken ct = default)
    {
        var names = new Dictionary<string, string>
        {
            ["#title"] = "Title", ["#content"] = "Content", ["#createdAt"] = "CreatedAt",
            ["#lastModifiedAt"] = "LastModifiedAt", ["#deleted"] = "Deleted", ["#userId"] = "UserId",
            ["#actionItems"] = "ActionItems", ["#date"] = "Date", ["#tags"] = "Tags",
            ["#folderId"] = "FolderId", ["#workspaceId"] = "WorkspaceId"
        };
        var values = new Dictionary<string, AttributeValue>
        {
            [":title"] = new() { S = card.Title },
            [":content"] = new() { S = card.Content },
            [":createdAt"] = new() { S = card.CreatedAt.ToString("O") },
            [":lastModifiedAt"] = new() { S = card.LastModifiedAt.ToString("O") },
            [":deleted"] = new() { BOOL = card.Deleted },
            [":userId"] = new() { S = card.UserId },
            [":emptyActions"] = new() { S = JsonSerializer.Serialize(Array.Empty<NoteCardActionItem>()) }
        };

        var sets = new List<string>
        {
            "#title = :title", "#content = :content", "#createdAt = :createdAt",
            "#lastModifiedAt = :lastModifiedAt", "#deleted = :deleted", "#userId = :userId",
            "#actionItems = if_not_exists(#actionItems, :emptyActions)"
        };
        var removes = new List<string>();

        AddOptional(sets, removes, values, "#date", ":date", card.Date.HasValue ? new AttributeValue { S = card.Date.Value.ToString("O") } : null);
        AddOptional(sets, removes, values, "#tags", ":tags", card.Tags is { Count: > 0 } ? new AttributeValue { SS = card.Tags.ToList() } : null);
        AddOptional(sets, removes, values, "#folderId", ":folderId", card.FolderId.HasValue ? new AttributeValue { S = card.FolderId.Value.Value.ToString() } : null);
        AddOptional(sets, removes, values, "#workspaceId", ":workspaceId", string.IsNullOrEmpty(card.WorkspaceId) ? null : new AttributeValue { S = card.WorkspaceId });

        var expression = "SET " + string.Join(", ", sets) + (removes.Count > 0 ? " REMOVE " + string.Join(", ", removes) : "");
        await UpdateAsync(card.NoteId, expression, names, values, ct).ConfigureAwait(false);
    }

    // SET only ActionItems + LastModifiedAt, leaving the note-owned fields untouched.
    public async Task UpdateActionItemsAsync(NoteId noteId, IReadOnlyList<NoteCardActionItem> actionItems, DateTimeOffset lastModifiedAt, CancellationToken ct = default)
    {
        var names = new Dictionary<string, string> { ["#actionItems"] = "ActionItems", ["#lastModifiedAt"] = "LastModifiedAt" };
        var values = new Dictionary<string, AttributeValue>
        {
            [":actionItems"] = new() { S = JsonSerializer.Serialize(actionItems) },
            [":lastModifiedAt"] = new() { S = lastModifiedAt.ToString("O") }
        };
        await UpdateAsync(noteId, "SET #actionItems = :actionItems, #lastModifiedAt = :lastModifiedAt", names, values, ct).ConfigureAwait(false);
    }

    private static void AddOptional(List<string> sets, List<string> removes, Dictionary<string, AttributeValue> values,
        string nameToken, string valueToken, AttributeValue? value)
    {
        if (value is null) { removes.Add(nameToken); return; }
        sets.Add($"{nameToken} = {valueToken}");
        values[valueToken] = value;
    }

    private Task UpdateAsync(NoteId noteId, string expression, Dictionary<string, string> names, Dictionary<string, AttributeValue> values, CancellationToken ct) =>
        dynamo.UpdateItemAsync(new UpdateItemRequest
        {
            TableName = tableName,
            Key = new Dictionary<string, AttributeValue> { ["PK"] = new() { S = noteId.Value.ToString() } },
            UpdateExpression = expression,
            ExpressionAttributeNames = names,
            ExpressionAttributeValues = values
        }, ct);

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
        var rows = new List<NoteCardView>();
        Dictionary<string, AttributeValue>? lastKey = null;
        do
        {
            var scan = await dynamo.ScanAsync(
                new ScanRequest { TableName = tableName, ConsistentRead = true, ExclusiveStartKey = lastKey }, ct)
                .ConfigureAwait(false);
            rows.AddRange(scan.Items.Select(ToCard));
            lastKey = scan.LastEvaluatedKey?.Count > 0 ? scan.LastEvaluatedKey : null;
        }
        while (lastKey is not null);
        return rows.OrderByDescending(c => c.CreatedAt).ToList().AsReadOnly();
    }

    public async Task DeleteAsync(NoteId noteId, CancellationToken ct = default)
    {
        await dynamo.DeleteItemAsync(new DeleteItemRequest
        {
            TableName = tableName,
            Key = new Dictionary<string, AttributeValue> { ["PK"] = new() { S = noteId.Value.ToString() } }
        }, ct).ConfigureAwait(false);
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
            UserId: row.TryGetValue("UserId", out var uidAttr) ? uidAttr.S : "",
            WorkspaceId: row.TryGetValue("WorkspaceId", out var wsAttr) ? wsAttr.S : null);
    }

    private record ActionItemDto(ActionId ActionId, string Description, bool Completed);
}
