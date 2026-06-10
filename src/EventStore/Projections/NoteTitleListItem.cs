using Domain.Notes;

namespace EventStore.Projections;

public record NoteTitleListItem(NoteId NoteId, string Title, DateTimeOffset LastModifiedAt, string UserId = "", string? WorkspaceId = null);
