using Domain.Workspaces;

namespace Domain.Notes;

public record MoveNoteToWorkspace(NoteId NoteId, WorkspaceId WorkspaceId) : NoteCommand;
