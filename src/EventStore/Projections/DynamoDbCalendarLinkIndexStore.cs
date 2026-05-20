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
            ["StartTime"] = new() { S = view.StartTime.ToString("O") }
        };
        if (view.RecurringSeriesId is not null)
            item["RecurringSeriesId"] = new() { S = view.RecurringSeriesId };

        await dynamo.PutItemAsync(new PutItemRequest { TableName = tableName, Item = item }, ct)
            .ConfigureAwait(false);
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

    private static CalendarLinkView MapItem(Dictionary<string, AttributeValue> item) =>
        new(
            CalendarEventId: item["CalendarEventId"].S,
            NoteId: item["NoteId"].S,
            RecurringSeriesId: item.TryGetValue("RecurringSeriesId", out var rid) ? rid.S : null,
            StartTime: DateTimeOffset.Parse(item["StartTime"].S)
        );
}
