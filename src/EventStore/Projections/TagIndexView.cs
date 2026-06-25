namespace EventStore.Projections;

public record TagIndexView(string Tag, string NoteId, string UserId = "", string? WorkspaceId = null);
