using Amazon.DynamoDBv2;
using Amazon.DynamoDBv2.Model;

namespace EventStore.Projections;

public sealed class DynamoDbCalendarLinkIndexStore(IAmazonDynamoDB dynamo, string tableName) : ICalendarLinkIndexStore
{
    public async Task<CalendarLinkView?> GetByCalendarEventIdAsync(string calendarEventId, CancellationToken ct = default)
    {
        var response = await dynamo.GetItemAsync(new GetItemRequest
        {
            TableName = tableName,
            Key = new Dictionary<string, AttributeValue> { ["CalendarEventId"] = new() { S = calendarEventId } },
            ConsistentRead = true
        }, ct).ConfigureAwait(false);

        return response.IsItemSet ? MapItem(response.Item) : null;
    }

    public async Task<CalendarLinkView?> GetByNoteIdAsync(string noteId, CancellationToken ct = default)
    {
        Dictionary<string, AttributeValue>? lastKey = null;
        do
        {
            var scan = await dynamo.ScanAsync(new ScanRequest
            {
                TableName = tableName,
                FilterExpression = "NoteId = :noteId",
                ExpressionAttributeValues = new Dictionary<string, AttributeValue>
                {
                    [":noteId"] = new() { S = noteId }
                },
                ExclusiveStartKey = lastKey
            }, ct).ConfigureAwait(false);

            if (scan.Items.Count > 0)
                return MapItem(scan.Items[0]);

            lastKey = scan.LastEvaluatedKey?.Count > 0 ? scan.LastEvaluatedKey : null;
        }
        while (lastKey is not null);

        return null;
    }

    public async Task<IReadOnlyList<CalendarLinkView>> GetByRecurringSeriesIdAsync(string seriesId, CancellationToken ct = default)
    {
        var response = await dynamo.QueryAsync(new QueryRequest
        {
            TableName = tableName,
            IndexName = "RecurringSeriesId-index",
            KeyConditionExpression = "RecurringSeriesId = :seriesId",
            ExpressionAttributeValues = new Dictionary<string, AttributeValue>
            {
                [":seriesId"] = new() { S = seriesId }
            }
        }, ct).ConfigureAwait(false);

        return response.Items.Select(MapItem).ToList().AsReadOnly();
    }

    public async Task UpsertAsync(CalendarLinkView view, CancellationToken ct = default)
    {
        var item = new Dictionary<string, AttributeValue>
        {
            ["CalendarEventId"] = new() { S = view.CalendarEventId },
            ["NoteId"] = new() { S = view.NoteId },
            ["StartTime"] = new() { S = view.StartTime.ToString("O") },
            ["EndTime"] = new() { S = view.EndTime.ToString("O") },
            ["CalendarEventTitle"] = new() { S = view.CalendarEventTitle },
            ["UserId"] = new() { S = view.UserId }
        };
        if (view.RecurringSeriesId is not null)
            item["RecurringSeriesId"] = new() { S = view.RecurringSeriesId };

        await dynamo.PutItemAsync(new PutItemRequest { TableName = tableName, Item = item }, ct)
            .ConfigureAwait(false);
    }

    public async Task<IReadOnlyList<CalendarLinkView>> GetAllAsync(CancellationToken ct = default)
    {
        var results = new List<CalendarLinkView>();
        Dictionary<string, AttributeValue>? lastKey = null;
        do
        {
            var scan = await dynamo.ScanAsync(
                new ScanRequest { TableName = tableName, ConsistentRead = true, ExclusiveStartKey = lastKey }, ct)
                .ConfigureAwait(false);
            results.AddRange(scan.Items.Select(MapItem));
            lastKey = scan.LastEvaluatedKey?.Count > 0 ? scan.LastEvaluatedKey : null;
        }
        while (lastKey is not null);
        return results.AsReadOnly();
    }

    public async Task DeleteAsync(string calendarEventId, CancellationToken ct = default)
    {
        await dynamo.DeleteItemAsync(new DeleteItemRequest
        {
            TableName = tableName,
            Key = new Dictionary<string, AttributeValue> { ["CalendarEventId"] = new() { S = calendarEventId } }
        }, ct).ConfigureAwait(false);
    }

    public async Task DeleteForNoteAsync(string calendarEventId, string noteId, CancellationToken ct = default)
    {
        try
        {
            await dynamo.DeleteItemAsync(new DeleteItemRequest
            {
                TableName = tableName,
                Key = new Dictionary<string, AttributeValue> { ["CalendarEventId"] = new() { S = calendarEventId } },
                ConditionExpression = "NoteId = :noteId",
                ExpressionAttributeValues = new Dictionary<string, AttributeValue> { [":noteId"] = new() { S = noteId } }
            }, ct).ConfigureAwait(false);
        }
        catch (ConditionalCheckFailedException)
        {
            // The row no longer belongs to this note — another note has since linked to this meeting,
            // or the row is already gone. A stale/replayed unlink; leave the current owner's link intact.
        }
    }

    public async Task DeleteByNoteIdAsync(string noteId, CancellationToken ct = default)
    {
        Dictionary<string, AttributeValue>? lastKey = null;
        do
        {
            var scan = await dynamo.ScanAsync(new ScanRequest
            {
                TableName = tableName,
                FilterExpression = "NoteId = :noteId",
                ExpressionAttributeValues = new Dictionary<string, AttributeValue>
                {
                    [":noteId"] = new() { S = noteId }
                },
                ProjectionExpression = "CalendarEventId",
                ExclusiveStartKey = lastKey
            }, ct).ConfigureAwait(false);

            foreach (var item in scan.Items)
                await dynamo.DeleteItemAsync(new DeleteItemRequest
                {
                    TableName = tableName,
                    Key = new Dictionary<string, AttributeValue> { ["CalendarEventId"] = item["CalendarEventId"] }
                }, ct).ConfigureAwait(false);

            lastKey = scan.LastEvaluatedKey?.Count > 0 ? scan.LastEvaluatedKey : null;
        }
        while (lastKey is not null);
    }

    public async Task DeleteAllAsync(CancellationToken ct = default)
    {
        Dictionary<string, AttributeValue>? lastKey = null;
        do
        {
            var scan = await dynamo.ScanAsync(new ScanRequest
            {
                TableName = tableName,
                ProjectionExpression = "CalendarEventId",
                ExclusiveStartKey = lastKey
            }, ct).ConfigureAwait(false);

            foreach (var item in scan.Items)
                await dynamo.DeleteItemAsync(new DeleteItemRequest
                {
                    TableName = tableName,
                    Key = new Dictionary<string, AttributeValue> { ["CalendarEventId"] = item["CalendarEventId"] }
                }, ct).ConfigureAwait(false);

            lastKey = scan.LastEvaluatedKey?.Count > 0 ? scan.LastEvaluatedKey : null;
        }
        while (lastKey is not null);
    }

    private static CalendarLinkView MapItem(Dictionary<string, AttributeValue> item) =>
        new(
            CalendarEventId: item["CalendarEventId"].S,
            NoteId: item["NoteId"].S,
            RecurringSeriesId: item.TryGetValue("RecurringSeriesId", out var rid) ? rid.S : null,
            StartTime: DateTimeOffset.Parse(item["StartTime"].S),
            EndTime: item.TryGetValue("EndTime", out var end) ? DateTimeOffset.Parse(end.S) : DateTimeOffset.Parse(item["StartTime"].S),
            CalendarEventTitle: item.TryGetValue("CalendarEventTitle", out var title) ? title.S : string.Empty,
            UserId: item.TryGetValue("UserId", out var uid) ? uid.S : string.Empty
        );
}
