using Amazon.DynamoDBv2;
using Amazon.DynamoDBv2.Model;
using Domain.ActionItems;
using Domain.Notes;

namespace EventStore.Projections;

public interface ITodoListStore
{
    Task PutAsync(TodoItem item, CancellationToken ct = default);
    Task DeleteAsync(ActionId actionId, CancellationToken ct = default);
    Task DeleteByNoteAsync(NoteId noteId, CancellationToken ct = default);
    Task UpdateNoteTitleAsync(NoteId noteId, string newTitle, CancellationToken ct = default);
    Task<TodoListView> QueryAllAsync(CancellationToken ct = default);
}
