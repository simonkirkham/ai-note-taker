using Domain.Workspaces;
using Domain.Specs.Harness;

namespace Domain.Specs.Workspaces;

// 34-B: a calendar account is connected/disconnected per workspace. The provider + account are
// recorded on the Workspace aggregate (non-default workspaces only — the default has no stream).
public sealed class ConnectWorkspaceCalendarSpec
{
    static readonly WorkspaceId Id = new("ws-aaaa");

    [Fact]
    public void ConnectsCalendar()
    {
        Spec
            .Given<Workspace>(new WorkspaceCreated(Id, "Work"))
            .When(new ConnectWorkspaceCalendar(Id, "google", "owner@example.com"))
            .Then(new WorkspaceCalendarConnected(Id, "google", "owner@example.com"));
    }

    [Fact]
    public void ConnectsCalendarWithoutEmail()
    {
        Spec
            .Given<Workspace>(new WorkspaceCreated(Id, "Work"))
            .When(new ConnectWorkspaceCalendar(Id, "google", null))
            .Then(new WorkspaceCalendarConnected(Id, "google", null));
    }

    [Fact]
    public void ReconnectingSameAccountIsNoOp()
    {
        Spec
            .Given<Workspace>(
                new WorkspaceCreated(Id, "Work"),
                new WorkspaceCalendarConnected(Id, "google", "owner@example.com"))
            .When(new ConnectWorkspaceCalendar(Id, "google", "owner@example.com"))
            .Then();
    }

    [Fact]
    public void ReconnectingDifferentAccountReEmits()
    {
        Spec
            .Given<Workspace>(
                new WorkspaceCreated(Id, "Work"),
                new WorkspaceCalendarConnected(Id, "google", "old@example.com"))
            .When(new ConnectWorkspaceCalendar(Id, "google", "new@example.com"))
            .Then(new WorkspaceCalendarConnected(Id, "google", "new@example.com"));
    }

    [Fact]
    public void RejectsEmptyProvider()
    {
        Spec
            .Given<Workspace>(new WorkspaceCreated(Id, "Work"))
            .When(new ConnectWorkspaceCalendar(Id, "", "owner@example.com"))
            .ThenThrows<InvalidOperationException>();
    }

    [Fact]
    public void RejectsConnectOnNonExistentWorkspace()
    {
        Spec
            .Given<Workspace>()
            .When(new ConnectWorkspaceCalendar(Id, "google", "owner@example.com"))
            .ThenThrows<InvalidOperationException>();
    }

    [Fact]
    public void RejectsConnectOnDeletedWorkspace()
    {
        Spec
            .Given<Workspace>(
                new WorkspaceCreated(Id, "Work"),
                new WorkspaceDeleted(Id))
            .When(new ConnectWorkspaceCalendar(Id, "google", "owner@example.com"))
            .ThenThrows<InvalidOperationException>();
    }

    [Fact]
    public void DisconnectsCalendar()
    {
        Spec
            .Given<Workspace>(
                new WorkspaceCreated(Id, "Work"),
                new WorkspaceCalendarConnected(Id, "google", "owner@example.com"))
            .When(new DisconnectWorkspaceCalendar(Id))
            .Then(new WorkspaceCalendarDisconnected(Id));
    }

    [Fact]
    public void DisconnectIsNoOpWhenNotConnected()
    {
        Spec
            .Given<Workspace>(new WorkspaceCreated(Id, "Work"))
            .When(new DisconnectWorkspaceCalendar(Id))
            .Then();
    }

    [Fact]
    public void DisconnectAfterReconnectClears()
    {
        Spec
            .Given<Workspace>(
                new WorkspaceCreated(Id, "Work"),
                new WorkspaceCalendarConnected(Id, "google", "owner@example.com"),
                new WorkspaceCalendarDisconnected(Id))
            .When(new DisconnectWorkspaceCalendar(Id))
            .Then();
    }
}
