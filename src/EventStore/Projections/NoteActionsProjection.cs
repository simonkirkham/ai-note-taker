using Domain.ActionItems;
using Domain.Notes;

namespace EventStore.Projections;

public record NoteAction(
    ActionId ActionId,
    string Description,
    bool Completed,
    DateTimeOffset AddedAt,
    DateTimeOffset? CompletedAt);

public record NoteActionsView(
    NoteId NoteId,
    IReadOnlyList<NoteAction> Actions);

public sealed class NoteActionsProjection
{
    public void Handle(EventEnvelope envelope) =>
        throw new NotImplementedException();

    public NoteActionsView GetView(NoteId noteId) =>
        throw new NotImplementedException();
}
