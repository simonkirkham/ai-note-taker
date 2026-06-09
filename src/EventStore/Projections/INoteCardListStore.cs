using Domain.Notes;

namespace EventStore.Projections;

public interface INoteCardListStore
{
    Task UpsertAsync(NoteCardView card, CancellationToken ct = default);
    Task<NoteCardView?> GetByNoteAsync(NoteId noteId, CancellationToken ct = default);
    Task<IReadOnlyList<NoteCardView>> QueryAllAsync(CancellationToken ct = default);
    Task DeleteAsync(NoteId noteId, CancellationToken ct = default);
}
