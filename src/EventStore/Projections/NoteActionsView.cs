using Domain.Notes;

namespace EventStore.Projections;

public record NoteActionsView(
    NoteId NoteId,
    IReadOnlyList<NoteAction> Actions);
