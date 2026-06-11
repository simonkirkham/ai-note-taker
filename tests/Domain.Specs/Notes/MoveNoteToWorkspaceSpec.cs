using Domain.Folders;
using Domain.Notes;
using Domain.Specs.Harness;
using Domain.Workspaces;

namespace Domain.Specs.Notes;

public sealed class MoveNoteToWorkspaceSpec
{
    static readonly NoteId NoteId = new(Guid.Parse("00000000-0000-0000-0000-000000000001"));
    static readonly FolderId FolderId = new(Guid.Parse("00000000-0000-0000-0000-000000000010"));
    static readonly WorkspaceId Target = new("ws-target");

    [Fact]
    public void AssignsNoteToTargetWorkspace()
    {
        Spec
            .Given<Note>(new NoteCreated(NoteId))
            .When(new MoveNoteToWorkspace(NoteId, Target))
            .Then(new NoteAssignedToWorkspace(NoteId, Target));
    }

    [Fact]
    public void AlsoUnfilesWhenNoteIsFiled()
    {
        // folderId is workspace-local, so moving workspace clears the folder.
        Spec
            .Given<Note>(new NoteCreated(NoteId), new NoteFiledInFolder(NoteId, FolderId))
            .When(new MoveNoteToWorkspace(NoteId, Target))
            .Then(new NoteAssignedToWorkspace(NoteId, Target), new NoteUnfiled(NoteId));
    }

    [Fact]
    public void NoOpWhenAlreadyInTargetWorkspace()
    {
        Spec
            .Given<Note>(new NoteCreated(NoteId), new NoteAssignedToWorkspace(NoteId, Target))
            .When(new MoveNoteToWorkspace(NoteId, Target))
            .Then();
    }

    [Fact]
    public void RejectsMoveOnNonExistentNote()
    {
        Spec
            .Given<Note>()
            .When(new MoveNoteToWorkspace(NoteId, Target))
            .ThenThrows<InvalidOperationException>();
    }

    [Fact]
    public void RejectsMoveOnDeletedNote()
    {
        Spec
            .Given<Note>(new NoteCreated(NoteId), new NoteDeleted(NoteId))
            .When(new MoveNoteToWorkspace(NoteId, Target))
            .ThenThrows<InvalidOperationException>();
    }
}
