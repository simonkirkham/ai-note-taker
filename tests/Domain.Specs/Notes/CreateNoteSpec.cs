using Domain.Notes;
using Domain.Workspaces;
using Domain.Specs.Harness;

namespace Domain.Specs.Notes;

public sealed class CreateNoteSpec
{
    static readonly NoteId Id = new(Guid.Parse("00000000-0000-0000-0000-000000000001"));
    static readonly WorkspaceId Ws = new("ws-work");

    [Fact]
    public void CreatesNoteAndAssignsItToTheRequestWorkspace()
    {
        Spec
            .Given<Note>()
            .When(new CreateNote(Id, Ws))
            .Then(new NoteCreated(Id), new NoteAssignedToWorkspace(Id, Ws));
    }

    [Fact]
    public void CreatesNoteInDefaultWorkspace()
    {
        Spec
            .Given<Note>()
            .When(new CreateNote(Id, WorkspaceId.Default))
            .Then(new NoteCreated(Id), new NoteAssignedToWorkspace(Id, WorkspaceId.Default));
    }

    [Fact]
    public void RejectsCreateWhenNoteAlreadyExists()
    {
        Spec
            .Given<Note>(new NoteCreated(Id))
            .When(new CreateNote(Id, Ws))
            .ThenThrows<InvalidOperationException>();
    }
}
