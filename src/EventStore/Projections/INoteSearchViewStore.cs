using Domain.Notes;

namespace EventStore.Projections;

public interface INoteSearchViewStore
{
    Task UpsertAsync(NoteSearchView view, CancellationToken ct = default);
    Task<NoteSearchView?> GetByNoteIdAsync(NoteId noteId, CancellationToken ct = default);
    Task DeleteAsync(NoteId noteId, CancellationToken ct = default);
    Task DeleteAllAsync(CancellationToken ct = default);
    Task<IReadOnlyList<NoteSearchView>> QueryByUserIdAsync(string userId, CancellationToken ct = default);
}
