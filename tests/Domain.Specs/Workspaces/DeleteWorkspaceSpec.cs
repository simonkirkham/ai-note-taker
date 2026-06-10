using Domain.Workspaces;
using Domain.Specs.Harness;

namespace Domain.Specs.Workspaces;

public sealed class DeleteWorkspaceSpec
{
    static readonly WorkspaceId Id = new("ws-aaaa");

    [Fact]
    public void DeletesWorkspace()
    {
        Spec
            .Given<Workspace>(new WorkspaceCreated(Id, "Work"))
            .When(new DeleteWorkspace(Id))
            .Then(new WorkspaceDeleted(Id));
    }

    [Fact]
    public void RejectsDeleteOnNonExistentWorkspace()
    {
        Spec
            .Given<Workspace>()
            .When(new DeleteWorkspace(Id))
            .ThenThrows<InvalidOperationException>();
    }

    [Fact]
    public void RejectsDeleteOnAlreadyDeletedWorkspace()
    {
        Spec
            .Given<Workspace>(new WorkspaceCreated(Id, "Work"), new WorkspaceDeleted(Id))
            .When(new DeleteWorkspace(Id))
            .ThenThrows<InvalidOperationException>();
    }

    [Fact]
    public void RejectsDeleteOfDefaultWorkspace()
    {
        Spec
            .Given<Workspace>()
            .When(new DeleteWorkspace(WorkspaceId.Default))
            .ThenThrows<DefaultWorkspaceUndeletableException>();
    }
}
