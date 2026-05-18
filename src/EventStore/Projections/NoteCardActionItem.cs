using Domain.ActionItems;

namespace EventStore.Projections;

public record NoteCardActionItem(
    ActionId ActionId,
    string Description,
    bool Completed);
