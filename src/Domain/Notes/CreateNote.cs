using Domain.Workspaces;

namespace Domain.Notes;

public record CreateNote(NoteId NoteId, WorkspaceId WorkspaceId) : NoteCommand
{
    public override bool MustExist => false;
}
