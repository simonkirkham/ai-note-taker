using Domain.Workspaces;
using Domain.Specs.Harness;

namespace Domain.Specs.Workspaces;

public sealed class CreateWorkspaceSpec
{
    static readonly WorkspaceId Id = new("ws-aaaa");
    static readonly DateTimeOffset Now = new(2026, 6, 10, 12, 0, 0, TimeSpan.Zero);

    [Fact]
    public void CreatesWorkspace()
    {
        Spec
            .Given<Workspace>()
            .When(new CreateWorkspace(Id, "Work", Now))
            .Then(new WorkspaceCreated(Id, "Work"));
    }

    [Fact]
    public void RejectsEmptyName()
    {
        Spec
            .Given<Workspace>()
            .When(new CreateWorkspace(Id, "", Now))
            .ThenThrows<InvalidOperationException>();
    }

    [Fact]
    public void RejectsWhitespaceName()
    {
        Spec
            .Given<Workspace>()
            .When(new CreateWorkspace(Id, "   ", Now))
            .ThenThrows<InvalidOperationException>();
    }

    [Fact]
    public void RejectsDuplicateCreate()
    {
        Spec
            .Given<Workspace>(new WorkspaceCreated(Id, "Work"))
            .When(new CreateWorkspace(Id, "Work", Now))
            .ThenThrows<InvalidOperationException>();
    }
}
