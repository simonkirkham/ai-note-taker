using Domain.Notes;

namespace EventStore.Projections;

public record NoteSearchView(
    NoteId NoteId,
    string UserId,
    string Title,
    string Body,
    string FinalNotesText,
    IReadOnlyList<string> Tags,
    string ActionItemsText,
    bool Deleted,
    DateTimeOffset LastModifiedAt,
    string? WorkspaceId = null);
