using Amazon.DynamoDBv2;
using Amazon.DynamoDBv2.Model;
using Domain.Notes;

namespace EventStore.Projections;

public sealed class DynamoDbNoteDetailStore(IAmazonDynamoDB dynamo, string tableName) : INoteDetailStore
{
    public async Task UpsertAsync(NoteDetailView detail, CancellationToken ct = default)
    {
        var item = new Dictionary<string, AttributeValue>
        {
            ["PK"] = new() { S = detail.NoteId.ToStreamId() },
            ["NoteId"] = new() { S = detail.NoteId.Value.ToString() },
            ["Title"] = string.IsNullOrEmpty(detail.Title) ? new() { NULL = true } : new() { S = detail.Title },
            ["Content"] = string.IsNullOrEmpty(detail.Content) ? new() { NULL = true } : new() { S = detail.Content },
            ["CreatedAt"] = new() { S = detail.CreatedAt.ToString("O") },
            ["LastModifiedAt"] = new() { S = detail.LastModifiedAt.ToString("O") },
            ["UserId"] = new() { S = detail.UserId }
        };
        if (detail.Date.HasValue)
            item["Date"] = new AttributeValue { S = detail.Date.Value.ToString("yyyy-MM-dd") };
        if (detail.Tags is { Count: > 0 })
            item["Tags"] = new AttributeValue { SS = detail.Tags.ToList() };
        if (!string.IsNullOrEmpty(detail.TranscriptText))
            item["TranscriptText"] = new AttributeValue { S = detail.TranscriptText };
        if (detail.Summary is not null)
            item["Summary"] = new AttributeValue { S = detail.Summary };
        if (detail.DiscussionPoints is { Count: > 0 })
            item["DiscussionPoints"] = new AttributeValue { L = detail.DiscussionPoints.Select(p => new AttributeValue { S = p }).ToList() };
        if (detail.Decisions is { Count: > 0 })
            item["Decisions"] = new AttributeValue { L = detail.Decisions.Select(d => new AttributeValue { S = d }).ToList() };
        if (!string.IsNullOrEmpty(detail.SummaryModelId))
            item["SummaryModelId"] = new AttributeValue { S = detail.SummaryModelId };
        if (!string.IsNullOrEmpty(detail.SummaryPromptVersion))
            item["SummaryPromptVersion"] = new AttributeValue { S = detail.SummaryPromptVersion };

        await dynamo.PutItemAsync(new PutItemRequest { TableName = tableName, Item = item }, ct)
            .ConfigureAwait(false);
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

            await DynamoDbBatchDelete.ByPrimaryKeyAsync(dynamo, tableName, scan.Items, ct).ConfigureAwait(false);

            lastKey = scan.LastEvaluatedKey?.Count > 0 ? scan.LastEvaluatedKey : null;
        }
        while (lastKey is not null);
    }

    public async Task<IReadOnlyList<NoteDetailView>> QueryAllAsync(CancellationToken ct = default)
    {
        var results = new List<NoteDetailView>();
        Dictionary<string, AttributeValue>? lastKey = null;
        do
        {
            var scan = await dynamo.ScanAsync(
                new ScanRequest { TableName = tableName, ConsistentRead = true, ExclusiveStartKey = lastKey }, ct)
                .ConfigureAwait(false);
            results.AddRange(scan.Items.Select(MapItemToNoteDetailView));
            lastKey = scan.LastEvaluatedKey?.Count > 0 ? scan.LastEvaluatedKey : null;
        }
        while (lastKey is not null);
        return results.AsReadOnly();
    }

    public async Task<NoteDetailView?> GetAsync(NoteId noteId, CancellationToken ct = default)
    {
        var response = await dynamo.GetItemAsync(new GetItemRequest
        {
            TableName = tableName,
            Key = new Dictionary<string, AttributeValue> { ["PK"] = new() { S = noteId.ToStreamId() } },
            ConsistentRead = true
        }, ct).ConfigureAwait(false);

        if (!response.IsItemSet) return null;

        return MapItemToNoteDetailView(response.Item);
    }

    private static NoteDetailView MapItemToNoteDetailView(Dictionary<string, AttributeValue> item)
    {
        var date = item.TryGetValue("Date", out var dateAttr) ? DateOnly.Parse(dateAttr.S) : (DateOnly?)null;
        IReadOnlyList<string> tags = item.TryGetValue("Tags", out var tagsAttr) && tagsAttr.SS?.Count > 0
            ? tagsAttr.SS.AsReadOnly()
            : Array.Empty<string>();
        var transcriptText = item.TryGetValue("TranscriptText", out var txAttr) ? txAttr.S : null;
        var summary = item.TryGetValue("Summary", out var summaryAttr) ? summaryAttr.S : null;
        var discussionPoints = ReadStringList(item, "DiscussionPoints");
        var decisions = ReadStringList(item, "Decisions");
        var summaryModelId = item.TryGetValue("SummaryModelId", out var modelAttr) ? modelAttr.S : null;
        var summaryPromptVersion = item.TryGetValue("SummaryPromptVersion", out var promptAttr) ? promptAttr.S : null;
        return new NoteDetailView(
            new NoteId(Guid.Parse(item["NoteId"].S)),
            ReadStringAttribute(item, "Title"),
            ReadStringAttribute(item, "Content"),
            DateTimeOffset.Parse(item["CreatedAt"].S),
            DateTimeOffset.Parse(item["LastModifiedAt"].S),
            date,
            tags,
            UserId: item.TryGetValue("UserId", out var uidAttr) ? uidAttr.S : "",
            TranscriptText: transcriptText,
            Summary: summary,
            DiscussionPoints: discussionPoints,
            Decisions: decisions,
            SummaryModelId: summaryModelId,
            SummaryPromptVersion: summaryPromptVersion);
    }

    private static IReadOnlyList<string>? ReadStringList(Dictionary<string, AttributeValue> item, string key) =>
        item.TryGetValue(key, out var attr) && attr.L?.Count > 0
            ? attr.L.Select(v => v.S).ToList().AsReadOnly()
            : null;

    private static string ReadStringAttribute(Dictionary<string, AttributeValue> item, string key) =>
        item.TryGetValue(key, out var attr) && attr.NULL != true ? (attr.S ?? "") : "";
}
