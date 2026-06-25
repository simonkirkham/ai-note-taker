using Domain.Workspaces;

namespace Domain.Notes;

public record NoteAssignedToWorkspace(NoteId NoteId, WorkspaceId WorkspaceId) : NoteEvent;
