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

// Pip 3-C: implement the fold and DynamoDbTodoListStore
public sealed class TodoListProjection
{
    public void Handle(EventEnvelope envelope) => throw new NotImplementedException();
    public IReadOnlyList<TodoItem> GetOpenItems() => throw new NotImplementedException();
}
