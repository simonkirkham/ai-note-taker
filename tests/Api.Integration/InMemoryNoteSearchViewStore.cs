using Domain.Notes;
using EventStore.Projections;

namespace Api.Integration;

internal sealed class InMemoryNoteSearchViewStore : INoteSearchViewStore
{
    private readonly Dictionary<NoteId, NoteSearchView> _items = new();

    public Task UpsertAsync(NoteSearchView view, CancellationToken ct = default)
    {
        _items[view.NoteId] = view;
        return Task.CompletedTask;
    }

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
}
