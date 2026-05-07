using Domain.Notes;
using EventStore.Projections;

namespace ApiIntegration;

internal sealed class InMemoryNoteDetailStore : INoteDetailStore
{
    private readonly Dictionary<NoteId, NoteDetailView> _items = new();

    public Task UpsertAsync(NoteDetailView detail, CancellationToken ct = default)
    {
        _items[detail.NoteId] = detail;
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

    public Task<NoteDetailView?> GetAsync(NoteId noteId, CancellationToken ct = default) =>
        Task.FromResult(_items.TryGetValue(noteId, out var detail) ? detail : null);
}
