using Domain.Notes;
using EventStore.Projections;

namespace Api.Integration;

internal sealed class InMemoryNoteSearchViewStore : INoteSearchViewStore
{
    private readonly Dictionary<NoteId, NoteSearchView> _items = new();

    public Task UpsertAsync(NoteSearchView view, CancellationToken ct = default)
    {
        if (string.IsNullOrEmpty(view.UserId)) return Task.CompletedTask;
        _items[view.NoteId] = view;
        return Task.CompletedTask;
    }

    public Task<NoteSearchView?> GetByNoteIdAsync(NoteId noteId, CancellationToken ct = default) =>
        Task.FromResult(_items.TryGetValue(noteId, out var view) ? view : null);

    public Task DeleteAsync(NoteId noteId, CancellationToken ct = default)
    {
        _items.Remove(noteId);
        return Task.CompletedTask;
    }

    public Task DeleteAllAsync(CancellationToken ct = default)
    {
        _items.Clear();
        return Task.CompletedTask;
    }

    public Task<IReadOnlyList<NoteSearchView>> QueryByUserIdAsync(string userId, CancellationToken ct = default)
    {
        IReadOnlyList<NoteSearchView> results = _items.Values
            .Where(v => v.UserId == userId)
            .ToList()
            .AsReadOnly();
        return Task.FromResult(results);
    }

    public Task<IReadOnlyList<NoteSearchView>> QueryAllAsync(CancellationToken ct = default) =>
        Task.FromResult<IReadOnlyList<NoteSearchView>>(_items.Values.ToList().AsReadOnly());
}
