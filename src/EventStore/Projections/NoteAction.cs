using Domain.ActionItems;

namespace EventStore.Projections;

public record NoteAction(
    ActionId ActionId,
    string Description,
    bool Completed,
    DateTimeOffset AddedAt,
    DateTimeOffset? CompletedAt);
