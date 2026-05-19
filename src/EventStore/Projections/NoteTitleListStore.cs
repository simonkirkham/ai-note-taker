using Amazon.DynamoDBv2;
using Amazon.DynamoDBv2.Model;
using Domain.Notes;

namespace EventStore.Projections;

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

            await DynamoDbBatchDelete.ByPrimaryKeyAsync(dynamo, tableName, scan.Items, ct).ConfigureAwait(false);

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
