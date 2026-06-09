using Domain.Notes;

namespace EventStore.Projections;

public interface INoteDetailStore
{
    Task UpsertAsync(NoteDetailView detail, CancellationToken ct = default);
    Task DeleteAsync(NoteId noteId, CancellationToken ct = default);
    Task DeleteAllAsync(CancellationToken ct = default);
    Task<NoteDetailView?> GetAsync(NoteId noteId, CancellationToken ct = default);
    Task<IReadOnlyList<NoteDetailView>> QueryAllAsync(CancellationToken ct = default);
}
