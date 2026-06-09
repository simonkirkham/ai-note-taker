using Domain.Notes;
using EventStore.Projections;

namespace Api.Integration;

// Wraps an in-memory detail store but throws a NON-transient fault on the next Upsert when armed,
// to prove that a fault mid-rebuild leaves prior rows intact (the table is never wiped first).
public sealed class FaultInjectingNoteDetailStore : INoteDetailStore
{
    private readonly InMemoryNoteDetailStore _inner = new();

    public bool FailNextUpsert { get; set; }

    public Task UpsertAsync(NoteDetailView detail, CancellationToken ct = default)
    {
        if (FailNextUpsert)
        {
            FailNextUpsert = false;
            throw new InvalidOperationException("simulated permanent write failure");
        }
        return _inner.UpsertAsync(detail, ct);
    }

    public Task DeleteAsync(NoteId noteId, CancellationToken ct = default) => _inner.DeleteAsync(noteId, ct);
    public Task DeleteAllAsync(CancellationToken ct = default) => _inner.DeleteAllAsync(ct);
    public Task<NoteDetailView?> GetAsync(NoteId noteId, CancellationToken ct = default) => _inner.GetAsync(noteId, ct);
    public Task<IReadOnlyList<NoteDetailView>> QueryAllAsync(CancellationToken ct = default) => _inner.QueryAllAsync(ct);
}
