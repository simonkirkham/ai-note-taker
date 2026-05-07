using Amazon.DynamoDBv2;
using Amazon.DynamoDBv2.Model;
using Domain.ActionItems;
using Domain.Notes;

namespace EventStore.Projections;

public record NoteAction(
    ActionId ActionId,
    string Description,
    bool Completed,
    DateTimeOffset AddedAt,
    DateTimeOffset? CompletedAt);

public record NoteActionsView(
    NoteId NoteId,
    IReadOnlyList<NoteAction> Actions);

public sealed class NoteActionsProjection
{
    private readonly Dictionary<(NoteId, ActionId), NoteAction> _items = new();

    public void Handle(EventEnvelope envelope)
    {
        switch (EventDeserializer.Deserialize(envelope))
        {
            case ActionItemAdded e:
                _items[(e.NoteId, e.ActionId)] = new NoteAction(e.ActionId, e.Description, false, envelope.OccurredAt, null);
                break;
        }
    }

    public NoteActionsView GetView(NoteId noteId)
    {
        var actions = _items
            .Where(kvp => kvp.Key.Item1 == noteId)
            .OrderBy(kvp => kvp.Value.AddedAt)
            .Select(kvp => kvp.Value)
            .ToList()
            .AsReadOnly();
        return new NoteActionsView(noteId, actions);
    }
}

public interface INoteActionsStore
{
    Task UpsertAsync(NoteId noteId, NoteAction item, CancellationToken ct = default);
    Task<NoteActionsView> QueryByNoteAsync(NoteId noteId, CancellationToken ct = default);
}

public sealed class DynamoDbNoteActionsStore(IAmazonDynamoDB dynamo, string tableName) : INoteActionsStore
{
    public async Task UpsertAsync(NoteId noteId, NoteAction item, CancellationToken ct = default)
    {
        var attrs = new Dictionary<string, AttributeValue>
        {
            ["PK"]          = new() { S = noteId.Value.ToString() },
            ["SK"]          = new() { S = item.ActionId.Value.ToString() },
            ["ActionId"]    = new() { S = item.ActionId.Value.ToString() },
            ["NoteId"]      = new() { S = noteId.Value.ToString() },
            ["Description"] = new() { S = item.Description },
            ["Completed"]   = new() { BOOL = item.Completed },
            ["AddedAt"]     = new() { S = item.AddedAt.ToString("O") }
        };
        if (item.CompletedAt.HasValue)
            attrs["CompletedAt"] = new() { S = item.CompletedAt.Value.ToString("O") };

        await dynamo.PutItemAsync(new PutItemRequest
        {
            TableName = tableName,
            Item = attrs
        }, ct).ConfigureAwait(false);
    }

    public async Task<NoteActionsView> QueryByNoteAsync(NoteId noteId, CancellationToken ct = default)
    {
        var response = await dynamo.QueryAsync(new QueryRequest
        {
            TableName = tableName,
            KeyConditionExpression = "PK = :noteId",
            ExpressionAttributeValues = new Dictionary<string, AttributeValue>
            {
                [":noteId"] = new() { S = noteId.Value.ToString() }
            }
        }, ct).ConfigureAwait(false);

        var actions = response.Items
            .Select(row => new NoteAction(
                new ActionId(Guid.Parse(row["ActionId"].S)),
                row["Description"].S,
                row["Completed"].BOOL ?? false,
                DateTimeOffset.Parse(row["AddedAt"].S),
                row.TryGetValue("CompletedAt", out var completedAt) ? DateTimeOffset.Parse(completedAt.S) : null))
            .OrderBy(a => a.AddedAt)
            .ToList()
            .AsReadOnly();

        return new NoteActionsView(noteId, actions);
    }
}
