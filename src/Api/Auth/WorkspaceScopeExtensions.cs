using DomainWorkspaceId = Domain.Workspaces.WorkspaceId;

namespace Api.Auth;

public static class WorkspaceScopeExtensions
{
    // A read-model row belongs to the request's workspace when its stored workspace
    // matches — treating a missing workspace (historical rows written before 23-B) as
    // the reserved default (decision #5).
    public static bool Includes(this ICurrentWorkspace currentWorkspace, string? rowWorkspaceId) =>
        (string.IsNullOrEmpty(rowWorkspaceId) ? DomainWorkspaceId.DefaultValue : rowWorkspaceId) == currentWorkspace.WorkspaceId;
}
