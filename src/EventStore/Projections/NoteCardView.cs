using Domain.ActionItems;
using Domain.Folders;
using Domain.Notes;

namespace EventStore.Projections;

public record NoteCardView(
    NoteId NoteId,
    string Title,
    string Content,
    IReadOnlyList<NoteCardActionItem> ActionItems,
    DateOnly? Date,
    DateTimeOffset CreatedAt,
    DateTimeOffset LastModifiedAt,
    bool Deleted,
    IReadOnlyList<string>? Tags = null,
    FolderId? FolderId = null);
