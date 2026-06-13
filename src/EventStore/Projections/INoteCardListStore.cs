using Domain.Notes;

namespace EventStore.Projections;

public interface INoteCardListStore
{
    // Full-item write — used by the rebuild path, where a single writer owns the whole card.
    Task UpsertAsync(NoteCardView card, CancellationToken ct = default);

    // Field-level writes (RYW-2). The card row is cross-aggregate: note events own the note
    // fields (title/content/date/tags/folder/workspace/deleted) and action events own the
    // ActionItems list. Once the note flows are async (projector) while action flows stay
    // inline, the two writers touch the same row concurrently — a full-item PutItem would
    // make them clobber each other. These write only their own attributes (via UpdateItem)
    // so the two writers commute.
    //
    // SET the note-owned fields; never touch ActionItems (defaulted to empty on first write).
    Task UpsertNoteFieldsAsync(NoteCardView card, CancellationToken ct = default);
    // SET only ActionItems + LastModifiedAt; never touch the note fields.
    Task UpdateActionItemsAsync(NoteId noteId, IReadOnlyList<NoteCardActionItem> actionItems, DateTimeOffset lastModifiedAt, CancellationToken ct = default);

    Task<NoteCardView?> GetByNoteAsync(NoteId noteId, CancellationToken ct = default);
    Task<IReadOnlyList<NoteCardView>> QueryAllAsync(CancellationToken ct = default);
    Task DeleteAsync(NoteId noteId, CancellationToken ct = default);
}
