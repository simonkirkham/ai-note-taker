namespace EventStore.Projections;

public record TodoItem(
    string ItemId,
    string? NoteId,
    string? NoteTitle,
    string Type,
    string Description,
    DateTimeOffset AddedAt,
    DateTimeOffset? CompletedAt,
    string UserId);
