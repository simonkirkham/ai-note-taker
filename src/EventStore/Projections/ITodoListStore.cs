using Domain.Notes;

namespace EventStore.Projections;

public interface ITodoListStore
{
    Task PutAsync(TodoItem item, CancellationToken ct = default);
    Task UpdateCompletedAtAsync(string itemId, DateTimeOffset? completedAt, CancellationToken ct = default);
    Task DeleteAsync(string itemId, CancellationToken ct = default);
    Task DeleteByNoteAsync(NoteId noteId, CancellationToken ct = default);
    Task UpdateNoteTitleAsync(NoteId noteId, string newTitle, CancellationToken ct = default);
    Task UpdateNoteWorkspaceAsync(NoteId noteId, string workspaceId, CancellationToken ct = default);
    Task<TodoItem?> GetByIdAsync(string itemId, CancellationToken ct = default);
    Task<TodoListView> QueryAllAsync(CancellationToken ct = default);

    // Apply a reorder snapshot: set each listed item's Position to its index in the list.
    // Items not listed keep their existing position (the client always sends the full open-list order).
    Task UpdatePositionsAsync(IReadOnlyList<string> orderedItemIds, CancellationToken ct = default);
}
