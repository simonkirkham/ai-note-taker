using Domain.Notes;
using EventStore.Projections;

namespace Api.Integration;

internal sealed class InMemoryTodoListStore : ITodoListStore
{
    private readonly Dictionary<string, TodoItem> _items = new();

    public Task PutAsync(TodoItem item, CancellationToken ct = default)
    {
        _items[item.ItemId] = item;
        return Task.CompletedTask;
    }

    public Task UpdateCompletedAtAsync(string itemId, DateTimeOffset? completedAt, CancellationToken ct = default)
    {
        if (_items.TryGetValue(itemId, out var item))
            _items[itemId] = item with { CompletedAt = completedAt };
        return Task.CompletedTask;
    }

    public Task DeleteAsync(string itemId, CancellationToken ct = default)
    {
        _items.Remove(itemId);
        return Task.CompletedTask;
    }

    public Task DeleteByNoteAsync(NoteId noteId, CancellationToken ct = default)
    {
        foreach (var key in _items.Where(kvp => kvp.Value.NoteId == noteId.Value.ToString()).Select(kvp => kvp.Key).ToList())
            _items.Remove(key);
        return Task.CompletedTask;
    }

    public Task UpdateNoteTitleAsync(NoteId noteId, string newTitle, CancellationToken ct = default)
    {
        foreach (var key in _items.Where(kvp => kvp.Value.NoteId == noteId.Value.ToString()).Select(kvp => kvp.Key).ToList())
            _items[key] = _items[key] with { NoteTitle = newTitle };
        return Task.CompletedTask;
    }

    public Task UpdateNoteWorkspaceAsync(NoteId noteId, string workspaceId, CancellationToken ct = default)
    {
        foreach (var key in _items.Where(kvp => kvp.Value.NoteId == noteId.Value.ToString()).Select(kvp => kvp.Key).ToList())
            _items[key] = _items[key] with { WorkspaceId = workspaceId };
        return Task.CompletedTask;
    }

    public Task<TodoItem?> GetByIdAsync(string itemId, CancellationToken ct = default) =>
        Task.FromResult(_items.GetValueOrDefault(itemId));

    public Task<TodoListView> QueryAllAsync(CancellationToken ct = default) =>
        Task.FromResult(new TodoListView(_items.Values
            .OrderBy(i => i.Position ?? int.MaxValue)
            .ThenBy(i => i.AddedAt)
            .ToList()
            .AsReadOnly()));

    public Task UpdatePositionsAsync(IReadOnlyList<string> orderedItemIds, CancellationToken ct = default)
    {
        for (var i = 0; i < orderedItemIds.Count; i++)
            if (_items.TryGetValue(orderedItemIds[i], out var item))
                _items[orderedItemIds[i]] = item with { Position = i };
        return Task.CompletedTask;
    }
}
