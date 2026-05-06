using Domain.Notes;
using EventStore.Projections;

namespace ApiIntegration;

internal sealed class InMemoryNoteTitleListStore : INoteTitleListStore
{
    private readonly Dictionary<NoteId, NoteTitleListItem> _items = new();

    public Task UpsertAsync(NoteTitleListItem item, CancellationToken ct = default)
    {
        _items[item.NoteId] = item;
        return Task.CompletedTask;
    }

    public Task DeleteAsync(NoteId noteId, CancellationToken ct = default)
    {
        _items.Remove(noteId);
        return Task.CompletedTask;
    }

    public Task<NoteTitleListView> QueryAllAsync(CancellationToken ct = default) =>
        Task.FromResult(new NoteTitleListView(new List<NoteTitleListItem>(_items.Values).AsReadOnly()));
}
