using Domain.Workspaces;
using Domain.Specs.Harness;

namespace Domain.Specs.Workspaces;

// 36-A: the per-workspace UI theme is recorded on the Workspace aggregate (non-default workspaces
// only — the default has no stream).
public sealed class SetWorkspaceThemeSpec
{
    static readonly WorkspaceId Id = new("ws-aaaa");

    [Fact]
    public void SetsTheme()
    {
        Spec
            .Given<Workspace>(new WorkspaceCreated(Id, "Work"))
            .When(new SetWorkspaceTheme(Id, "midnight"))
            .Then(new WorkspaceThemeSet(Id, "midnight"));
    }

    [Fact]
    public void RethemingToADifferentValueReEmits()
    {
        Spec
            .Given<Workspace>(
                new WorkspaceCreated(Id, "Work"),
                new WorkspaceThemeSet(Id, "midnight"))
            .When(new SetWorkspaceTheme(Id, "sunrise"))
            .Then(new WorkspaceThemeSet(Id, "sunrise"));
    }

    [Fact]
    public void SettingTheSameThemeIsNoOp()
    {
        Spec
            .Given<Workspace>(
                new WorkspaceCreated(Id, "Work"),
                new WorkspaceThemeSet(Id, "midnight"))
            .When(new SetWorkspaceTheme(Id, "midnight"))
            .Then();
    }

    [Fact]
    public void RejectsEmptyTheme()
    {
        Spec
            .Given<Workspace>(new WorkspaceCreated(Id, "Work"))
            .When(new SetWorkspaceTheme(Id, ""))
            .ThenThrows<InvalidOperationException>();
    }

    [Fact]
    public void RejectsSetOnDeletedWorkspace()
    {
        Spec
            .Given<Workspace>(
                new WorkspaceCreated(Id, "Work"),
                new WorkspaceDeleted(Id))
            .When(new SetWorkspaceTheme(Id, "midnight"))
            .ThenThrows<InvalidOperationException>();
    }

    [Fact]
    public void RejectsSetOnNonExistentWorkspace()
    {
        Spec
            .Given<Workspace>()
            .When(new SetWorkspaceTheme(Id, "midnight"))
            .ThenThrows<InvalidOperationException>();
    }
}
