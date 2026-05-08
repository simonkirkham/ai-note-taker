using Amazon.DynamoDBv2;
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
    Task DeleteAsync(NoteId noteId, CancellationToken ct = default);
    Task<IReadOnlyList<NoteCardView>> QueryAllAsync(CancellationToken ct = default);
}

public sealed class NoteCardListProjection
{
    private readonly Dictionary<NoteId, NoteCardView> _cards = new();
    private readonly Dictionary<ActionId, NoteId> _noteByAction = new();

    public void Handle(EventEnvelope envelope)
    {
        // Pip: implement all 9 event handlers
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

    public Task UpsertAsync(NoteCardView card, CancellationToken ct = default) =>
        Task.CompletedTask;

    public Task DeleteAsync(NoteId noteId, CancellationToken ct = default) =>
        Task.CompletedTask;

    public Task<IReadOnlyList<NoteCardView>> QueryAllAsync(CancellationToken ct = default) =>
        Task.FromResult<IReadOnlyList<NoteCardView>>(Array.Empty<NoteCardView>());
}
