using Amazon.DynamoDBv2;
using Amazon.DynamoDBv2.Model;
using Domain.ActionItems;
using Domain.Notes;

namespace EventStore.Projections;

public record TodoItem(
    ActionId ActionId,
    NoteId NoteId,
    string NoteTitle,
    string Description,
    DateTimeOffset AddedAt);

public record TodoListView(IReadOnlyList<TodoItem> Items);

public interface ITodoListStore
{
    Task PutAsync(TodoItem item, CancellationToken ct = default);
    Task DeleteAsync(ActionId actionId, CancellationToken ct = default);
    Task DeleteByNoteAsync(NoteId noteId, CancellationToken ct = default);
    Task UpdateNoteTitleAsync(NoteId noteId, string newTitle, CancellationToken ct = default);
    Task<TodoListView> QueryAllAsync(CancellationToken ct = default);
}

public sealed class TodoListProjection
{
    private readonly Dictionary<NoteId, string> _noteTitles = new();
    private readonly Dictionary<ActionId, (NoteId NoteId, string Description, DateTimeOffset AddedAt, bool Open)> _state = new();

    public void Handle(EventEnvelope envelope)
    {
        switch (EventDeserializer.Deserialize(envelope))
        {
            case NoteCreated e:
                _noteTitles[e.NoteId] = string.Empty;
                break;
            case NoteRenamed e:
                _noteTitles[e.NoteId] = e.NewTitle;
                break;
            case NoteDeleted e:
                _noteTitles.Remove(e.NoteId);
                foreach (var key in _state.Where(kvp => kvp.Value.NoteId == e.NoteId).Select(kvp => kvp.Key).ToList())
                    _state.Remove(key);
                break;
            case ActionItemAdded e:
                _state[e.ActionId] = (e.NoteId, e.Description, envelope.OccurredAt, Open: true);
                break;
            case ActionItemCompleted e when _state.TryGetValue(e.ActionId, out var comp):
                _state[e.ActionId] = comp with { Open = false };
                break;
            case ActionItemReopened e when _state.TryGetValue(e.ActionId, out var reopen):
                _state[e.ActionId] = reopen with { Open = true };
                break;
            default:
                break;
        }
    }

    public IReadOnlyList<TodoItem> GetOpenItems() =>
        _state
            .Where(kvp => kvp.Value.Open)
            .Select(kvp => new TodoItem(
                kvp.Key,
                kvp.Value.NoteId,
                _noteTitles.GetValueOrDefault(kvp.Value.NoteId, string.Empty),
                kvp.Value.Description,
                kvp.Value.AddedAt))
            .OrderBy(i => i.AddedAt)
            .ToList()
            .AsReadOnly();
}

public sealed class DynamoDbTodoListStore(IAmazonDynamoDB dynamo, string tableName) : ITodoListStore
{
    private const string NoteIdIndex = "NoteId-index";

    public async Task PutAsync(TodoItem item, CancellationToken ct = default)
    {
        await dynamo.PutItemAsync(new PutItemRequest
        {
            TableName = tableName,
            Item = new Dictionary<string, AttributeValue>
            {
                ["PK"]          = new() { S = item.ActionId.Value.ToString() },
                ["NoteId"]      = new() { S = item.NoteId.Value.ToString() },
                ["NoteTitle"]   = new() { S = item.NoteTitle },
                ["Description"] = new() { S = item.Description },
                ["AddedAt"]     = new() { S = item.AddedAt.ToString("O") }
            }
        }, ct).ConfigureAwait(false);
    }

    public async Task DeleteAsync(ActionId actionId, CancellationToken ct = default)
    {
        await dynamo.DeleteItemAsync(new DeleteItemRequest
        {
            TableName = tableName,
            Key = new Dictionary<string, AttributeValue>
            {
                ["PK"] = new() { S = actionId.Value.ToString() }
            }
        }, ct).ConfigureAwait(false);
    }

    public async Task DeleteByNoteAsync(NoteId noteId, CancellationToken ct = default)
    {
        var actionIds = await QueryActionIdsByNoteAsync(noteId, ct).ConfigureAwait(false);
        for (var i = 0; i < actionIds.Count; i += 25)
        {
            var batch = actionIds.Skip(i).Take(25)
                .Select(id => new WriteRequest
                {
                    DeleteRequest = new DeleteRequest
                    {
                        Key = new Dictionary<string, AttributeValue> { ["PK"] = new() { S = id } }
                    }
                }).ToList();
            await dynamo.BatchWriteItemAsync(new BatchWriteItemRequest
            {
                RequestItems = new Dictionary<string, List<WriteRequest>> { [tableName] = batch }
            }, ct).ConfigureAwait(false);
        }
    }

    public async Task UpdateNoteTitleAsync(NoteId noteId, string newTitle, CancellationToken ct = default)
    {
        var actionIds = await QueryActionIdsByNoteAsync(noteId, ct).ConfigureAwait(false);
        foreach (var id in actionIds)
        {
            await dynamo.UpdateItemAsync(new UpdateItemRequest
            {
                TableName = tableName,
                Key = new Dictionary<string, AttributeValue> { ["PK"] = new() { S = id } },
                UpdateExpression = "SET NoteTitle = :title",
                ExpressionAttributeValues = new Dictionary<string, AttributeValue>
                {
                    [":title"] = new() { S = newTitle }
                }
            }, ct).ConfigureAwait(false);
        }
    }

    public async Task<TodoListView> QueryAllAsync(CancellationToken ct = default)
    {
        var items = new List<TodoItem>();
        Dictionary<string, AttributeValue>? lastKey = null;
        do
        {
            var scan = await dynamo.ScanAsync(new ScanRequest
            {
                TableName = tableName,
                ExclusiveStartKey = lastKey
            }, ct).ConfigureAwait(false);

            items.AddRange(scan.Items.Select(row => new TodoItem(
                new ActionId(Guid.Parse(row["PK"].S)),
                new NoteId(Guid.Parse(row["NoteId"].S)),
                row["NoteTitle"].S,
                row["Description"].S,
                DateTimeOffset.Parse(row["AddedAt"].S))));

            lastKey = scan.LastEvaluatedKey?.Count > 0 ? scan.LastEvaluatedKey : null;
        }
        while (lastKey is not null);

        return new TodoListView(items.OrderBy(i => i.AddedAt).ToList().AsReadOnly());
    }

    private async Task<List<string>> QueryActionIdsByNoteAsync(NoteId noteId, CancellationToken ct)
    {
        var actionIds = new List<string>();
        Dictionary<string, AttributeValue>? lastKey = null;
        do
        {
            var resp = await dynamo.QueryAsync(new QueryRequest
            {
                TableName = tableName,
                IndexName = NoteIdIndex,
                KeyConditionExpression = "NoteId = :noteId",
                ProjectionExpression = "PK",
                ExpressionAttributeValues = new Dictionary<string, AttributeValue>
                {
                    [":noteId"] = new() { S = noteId.Value.ToString() }
                },
                ExclusiveStartKey = lastKey
            }, ct).ConfigureAwait(false);
            actionIds.AddRange(resp.Items.Select(row => row["PK"].S));
            lastKey = resp.LastEvaluatedKey?.Count > 0 ? resp.LastEvaluatedKey : null;
        }
        while (lastKey is not null);
        return actionIds;
    }
}
