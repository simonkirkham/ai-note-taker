using Domain.Workspaces;
using Domain.Specs.Harness;

namespace Domain.Specs.Workspaces;

public sealed class RenameWorkspaceSpec
{
    static readonly WorkspaceId Id = new("ws-aaaa");

    [Fact]
    public void RenamesWorkspace()
    {
        Spec
            .Given<Workspace>(new WorkspaceCreated(Id, "Work"))
            .When(new RenameWorkspace(Id, "Clients"))
            .Then(new WorkspaceRenamed(Id, "Clients"));
    }

    [Fact]
    public void NoOpWhenNameUnchanged()
    {
        Spec
            .Given<Workspace>(new WorkspaceCreated(Id, "Work"))
            .When(new RenameWorkspace(Id, "Work"))
            .Then();
    }

    [Fact]
    public void RejectsEmptyName()
    {
        Spec
            .Given<Workspace>(new WorkspaceCreated(Id, "Work"))
            .When(new RenameWorkspace(Id, ""))
            .ThenThrows<InvalidOperationException>();
    }

    [Fact]
    public void RejectsRenameOnNonExistentWorkspace()
    {
        Spec
            .Given<Workspace>()
            .When(new RenameWorkspace(Id, "Clients"))
            .ThenThrows<InvalidOperationException>();
    }
}
