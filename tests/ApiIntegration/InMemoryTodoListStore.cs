using Domain.ActionItems;
using Domain.Notes;
using EventStore.Projections;

namespace ApiIntegration;

internal sealed class InMemoryTodoListStore : ITodoListStore
{
    private readonly Dictionary<ActionId, TodoItem> _items = new();

    public Task PutAsync(TodoItem item, CancellationToken ct = default)
    {
        _items[item.ActionId] = item;
        return Task.CompletedTask;
    }

    public Task DeleteAsync(ActionId actionId, CancellationToken ct = default)
    {
        _items.Remove(actionId);
        return Task.CompletedTask;
    }

    public Task DeleteByNoteAsync(NoteId noteId, CancellationToken ct = default)
    {
        foreach (var key in _items.Where(kvp => kvp.Value.NoteId == noteId).Select(kvp => kvp.Key).ToList())
            _items.Remove(key);
        return Task.CompletedTask;
    }

    public Task UpdateNoteTitleAsync(NoteId noteId, string newTitle, CancellationToken ct = default)
    {
        foreach (var key in _items.Where(kvp => kvp.Value.NoteId == noteId).Select(kvp => kvp.Key).ToList())
            _items[key] = _items[key] with { NoteTitle = newTitle };
        return Task.CompletedTask;
    }

    public Task<TodoListView> QueryAllAsync(CancellationToken ct = default) =>
        Task.FromResult(new TodoListView(_items.Values.OrderBy(i => i.AddedAt).ToList().AsReadOnly()));
}
